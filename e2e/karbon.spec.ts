import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Karbon mode against a mocked api.karbonhq.com (context.route), on extension tab pages only, so no test can
// ever reach the real Karbon. Shapes follow Karbon's published OpenAPI spec (karbonhq/karbon-api-reference).

const KEYS = { appId: 'test-app-id-0000', accessKey: 'eyJtest.access.key', email: 'pat@firm.example' };
const WORK = [
  { WorkItemKey: 'WK1', Title: 'VAT return Q3', ClientKey: 'CK1', ClientName: 'Synthetic Joinery Ltd', ClientType: 'Organization', DueDate: '2026-11-30T00:00:00Z', PrimaryStatus: 'InProgress' },
  { WorkItemKey: 'WK2', Title: 'Year-end accounts', ClientKey: 'CK2', ClientName: 'Synthetic Dental Group', ClientType: 'Organization', PrimaryStatus: 'ReadyToStart' },
  { WorkItemKey: 'WK3', Title: 'Archived job', ClientKey: 'CK1', ClientName: 'Synthetic Joinery Ltd', ClientType: 'Organization', PrimaryStatus: 'Completed' },
];

type Seen = { method: string; url: string; auth?: string; accessKey?: string };

async function mockKarbon(context: BrowserContext, opts: { status?: number; users?: unknown[] } = {}) {
  const seen: Seen[] = [];
  await context.route('https://api.karbonhq.com/**', (route) => {
    const r = route.request();
    const h = r.headers();
    seen.push({ method: r.method(), url: r.url(), auth: h.authorization, accessKey: h.accesskey });
    const u = new URL(r.url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (opts.status) return json({ error: 'nope' }, opts.status);
    if (u.pathname === '/v3/TenantSettings') return json({ TenantKey: 'TENANT-TEST' });
    if (u.pathname === '/v3/Users') return json({ value: opts.users ?? [{ Id: 'UK1', Name: 'Pat Example', EmailAddress: KEYS.email }] });
    if (u.pathname === '/v3/WorkItems') return json({ value: WORK });
    if (u.pathname === '/v3/EstimateSummaries/WK1') return json({ value: [{ UserKey: 'UK1', EstimateMinutes: 120, ActualMinutes: 45 }, { UserKey: 'UK2', EstimateMinutes: 60, ActualMinutes: 60 }] });
    if (u.pathname.startsWith('/v3/EstimateSummaries/')) return json({ value: [] });
    return json({}, 404);
  });
  return seen;
}

async function connect(open: (p: string) => Promise<Page>, keys = KEYS) {
  const s = await open('options.html');
  await s.setViewportSize({ width: 1100, height: 1000 });
  await s.getByLabel('Application ID').fill(keys.appId);
  await s.getByLabel('AccessKey').fill(keys.accessKey);
  await s.getByLabel('Your Karbon email').fill(keys.email);
  await s.getByRole('button', { name: 'Connect Karbon' }).click();
  return s;
}

test('connect Karbon: assigned open work and real budgets appear; read-only GETs to Karbon only, with the keys only in headers', async ({ context, open }) => {
  const seen = await mockKarbon(context);
  const s = await connect(open);
  await expect(s.getByText('Connected to Karbon. 2 open work items are assigned to you.')).toBeVisible();
  await expect(s.getByText('Connected as Pat Example')).toBeVisible();
  // The keys are never shown back once saved.
  expect(await s.content()).not.toContain(KEYS.accessKey);

  const p = await open('sidepanel.html');
  await p.setViewportSize({ width: 380, height: 1000 });
  await expect(p.getByText(/^Synced from Karbon at /)).toBeVisible();
  await expect(p.locator('.mode')).toContainText('Karbon');
  await p.getByRole('button', { name: 'All work', exact: true }).click();
  await expect(p.getByText('VAT return Q3')).toBeVisible();
  await expect(p.getByText('Year-end accounts')).toBeVisible();
  await expect(p.getByText('Archived job')).toHaveCount(0); // completed work is not offered
  await p.locator('[data-row-action][aria-label$="Synthetic Joinery Ltd, VAT return Q3"]').click();
  await expect(p.locator('.tracking .work-title')).toHaveText('VAT return Q3');
  await expect(p.locator('.dial-sub')).toHaveText('1h 45m of 3h budget'); // loaded lazily from EstimateSummaries
  await p.getByRole('button', { name: 'Budget details' }).click();
  await expect(p.getByText(/Your allocation: Karbon recorded 45m \/ 2h 00m/)).toBeVisible();

  expect(seen.length).toBeGreaterThan(0);
  for (const r of seen) {
    expect(r.method).toBe('GET');
    expect(new URL(r.url).origin).toBe('https://api.karbonhq.com');
    expect(r.auth).toBe(`Bearer ${KEYS.appId}`);
    expect(r.accessKey).toBe(KEYS.accessKey);
    expect(r.url).not.toContain(KEYS.accessKey);
  }
  expect(seen.filter((r) => r.url.includes('/EstimateSummaries/')).map((r) => new URL(r.url).pathname)).toEqual(['/v3/EstimateSummaries/WK1']);
});

test('Karbon mode: marking a session entered in Karbon; disconnect removes the keys but keeps recorded time', async ({ context, open }) => {
  await mockKarbon(context);
  const s = await connect(open);
  await expect(s.getByText('Connected as Pat Example')).toBeVisible();
  const p = await open('sidepanel.html');
  await p.getByRole('button', { name: 'All work', exact: true }).click();
  await p.locator('[data-row-action][aria-label$="Synthetic Joinery Ltd, VAT return Q3"]').click();
  await p.getByRole('button', { name: 'Stop', exact: true }).click();

  const r = await open('review.html');
  await r.getByRole('button', { name: 'Mark as entered in Karbon: VAT return Q3' }).click();
  await expect(r.getByText('Entered in Karbon (marked by you)')).toBeVisible();
  await expect(r.locator('.total').filter({ hasText: 'Confirmed in Karbon' })).toContainText('Not sent automatically');

  await s.bringToFront();
  await s.getByRole('button', { name: 'Disconnect…' }).click();
  await s.getByRole('dialog', { name: 'Disconnect Karbon?' }).getByRole('button', { name: 'Disconnect' }).click();
  await expect(s.getByText('Karbon disconnected. The keys were removed from this browser.')).toBeVisible();
  await expect(s.getByRole('button', { name: 'Connect Karbon' })).toBeVisible();
  const stored = await s.evaluate(() => new Promise<string>((res) => {
    const o = indexedDB.open('hourhop');
    o.onsuccess = () => { const t = o.result.transaction(['state', 'sessions']); const out: unknown[] = [];
      t.objectStore('state').getAll().onsuccess = (e: any) => out.push(e.target.result);
      t.objectStore('sessions').getAll().onsuccess = (e: any) => out.push(e.target.result);
      t.oncomplete = () => res(JSON.stringify(out)); };
  }));
  expect(stored).not.toContain(KEYS.accessKey);
  expect(stored).not.toContain(KEYS.appId);
  expect(stored).toContain('VAT return Q3'); // the recorded session is kept
});

test('Karbon connect failures are specific and nothing is stored', async ({ context, open }) => {
  await mockKarbon(context, { status: 401 });
  const s = await connect(open);
  await expect(s.getByRole('alert')).toContainText('Karbon rejected the keys');
  await context.unrouteAll();
  await mockKarbon(context, { users: [] });
  await s.getByRole('button', { name: 'Connect Karbon' }).click();
  await expect(s.getByRole('alert')).toContainText(`No Karbon user has the email ${KEYS.email}`);
  await s.getByLabel('Your Karbon email').fill('not-an-email');
  await s.getByRole('button', { name: 'Connect Karbon' }).click();
  await expect(s.getByRole('alert')).toContainText('Enter the email address you sign in to Karbon with');
  const stored = await s.evaluate(() => new Promise<string>((res) => {
    const o = indexedDB.open('hourhop');
    o.onsuccess = () => { const t = o.result.transaction('state'); t.objectStore('state').getAll().onsuccess = (e: any) => res(JSON.stringify(e.target.result)); };
  }));
  expect(stored).not.toContain('karbon:conn');
});
