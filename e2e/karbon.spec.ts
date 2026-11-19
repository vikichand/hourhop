import type { BrowserContext, Page } from '@playwright/test';
import { expect, spills, test } from './fixtures';

// Karbon mode against a mocked api.karbonhq.com (context.route), on extension tab pages only, so no test can
// ever reach the real Karbon. Shapes follow Karbon's published OpenAPI spec (karbonhq/karbon-api-reference).

const KEYS = { appId: 'test-app-id-0000', accessKey: 'eyJtest.access.key', email: 'pat@firm.example' };
const WORK = [
  { WorkItemKey: 'WK1', Title: 'VAT return Q3', ClientKey: 'CK1', ClientName: 'Synthetic Joinery Ltd', ClientType: 'Organization', DueDate: '2026-11-30T00:00:00Z', PrimaryStatus: 'In Progress' },
  { WorkItemKey: 'WK2', Title: 'Year-end accounts', ClientKey: 'CK2', ClientName: 'Synthetic Dental Group', ClientType: 'Organization', PrimaryStatus: 'Ready To Start' },
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
    if (u.pathname === '/v3/WorkItems') {
      // Like Karbon: the list returns spaced statuses, and a PrimaryStatus filter matches only that form.
      const st = /PrimaryStatus eq '([^']*)'/.exec(u.searchParams.get('$filter') ?? '')?.[1];
      return json({ value: st === undefined ? WORK : WORK.filter((w) => w.PrimaryStatus === st) });
    }
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
  for (const w of [320, 380, 600]) { // Karbon's sync bar and budget lines fit their boxes
    await p.setViewportSize({ width: w, height: 1000 });
    expect(await spills(p), `side panel @${w}px`).toEqual([]);
  }
  for (const w of [320, 1240]) {
    await s.setViewportSize({ width: w, height: 1000 });
    expect(await spills(s), `settings @${w}px`).toEqual([]);
  }

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

test('Sign in with Karbon: Karbon\'s login opens in a window, read-only scope, and a connection report with no data calls', async ({ context, open }) => {
  const seen: { method: string; url: string; body: string; auth?: string }[] = [];
  await context.route(/^https:\/\/(identity|mcp)\.karbonhq\.com\//, (route) => {
    const r = route.request();
    const u = new URL(r.url());
    seen.push({ method: r.method(), url: r.url(), body: r.postData() ?? '', auth: r.headers().authorization });
    const json = (body: unknown, headers: Record<string, string> = {}) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', ...headers }, body: JSON.stringify(body) });
    if (u.pathname === '/mcp/oauth/register') return json({ client_id: 'client-e2e', token_endpoint_auth_method: 'none' });
    // Karbon's login page, already signed in: straight back to the loopback redirect with a code and the same state.
    if (u.pathname === '/connect/authorize') return route.fulfill({ status: 302, headers: { location: `${u.searchParams.get('redirect_uri')}?code=code-e2e&state=${u.searchParams.get('state')}` } });
    if (u.pathname === '/connect/token') return json({ access_token: 'tok-e2e', scope: 'mcp:public:read', token_type: 'Bearer' });
    if (u.href === 'https://mcp.karbonhq.com/mcp') {
      const msg = JSON.parse(r.postData() ?? '{}');
      if (msg.id === undefined) return route.fulfill({ status: 202, headers: { 'access-control-allow-origin': '*' } });
      const result = msg.method === 'initialize'
        ? { protocolVersion: '2025-06-18', serverInfo: { name: 'karbon-mcp', version: '1' }, capabilities: { tools: {} } }
        : { tools: [{ name: 'search_work_items', description: 'Find work items', inputSchema: { type: 'object' } }, { name: 'get_client', description: 'One client', inputSchema: { type: 'object' } }] };
      return json({ jsonrpc: '2.0', id: msg.id, result }, { 'mcp-session-id': 'sess-e2e', 'access-control-expose-headers': 'mcp-session-id' });
    }
    return route.fulfill({ status: 404 });
  });
  // Nothing listens on the loopback port in real life either; the page reads the URL and closes the window.
  await context.route('http://127.0.0.1:53682/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Return to HourHop</p>' }));

  const s = await open('options.html');
  await s.setViewportSize({ width: 1100, height: 1000 });
  await s.getByRole('button', { name: 'Sign in with Karbon' }).click();
  await expect(s.getByText('Karbon offers 2 tools to HourHop.')).toBeVisible();
  await expect.poll(() => context.pages().some((p) => p.url().startsWith('http://127.0.0.1:53682'))).toBe(false); // window closed

  const authorize = new URL(seen.find((r) => r.url.includes('/connect/authorize'))!.url);
  expect(authorize.searchParams.get('scope')).toBe('mcp:public:read');
  expect(authorize.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:53682/callback'); // the only path Karbon accepts
  expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
  const mcp = seen.filter((r) => r.url === 'https://mcp.karbonhq.com/mcp');
  expect(mcp.map((r) => JSON.parse(r.body).method)).toEqual(['initialize', 'notifications/initialized', 'tools/list']);
  for (const r of mcp) expect(r.auth).toBe('Bearer tok-e2e');
  for (const r of seen) expect(r.url).not.toContain('tok-e2e');
  expect(seen.some((r) => /\/Error|cdn-cgi/.test(r.url)), 'the sign-in window reached the real Karbon').toBe(false);

  // Stored: the tool list only. No token, no client ID, no firm data.
  const stored = await s.evaluate(() => new Promise<any>((res) => {
    const req = indexedDB.open('hourhop');
    req.onsuccess = () => { const g = req.result.transaction('state').objectStore('state').get('karbon:signin'); g.onsuccess = () => { req.result.close(); res(g.result); }; };
  }));
  expect(stored.report.tools.map((t: any) => t.name)).toEqual(['search_work_items', 'get_client']);
  expect(JSON.stringify(stored)).not.toContain('tok-e2e');
  expect(await spills(s)).toEqual([]);
});

test('Karbon session check: observes Karbon\'s app without changing it and stores shapes only, no values or tokens', async ({ context, open }) => {
  // A simulated Karbon web app that calls a simulated regional Karbon API with fetch and XHR, like the real app.
  const cors = { 'access-control-allow-origin': 'https://app2.karbonhq.com', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST' };
  await context.route('https://us3.karbonhq.com/**', (route) => {
    const r = route.request();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = r.url().includes('/stopwatches/')
      ? { StopwatchKey: 'Sw9k8j7h6', WorkItemTitle: 'VAT return Q3', ElapsedSeconds: 5400, StartedAt: '2026-11-19T09:00:00Z' }
      : { value: [{ WorkItemKey: 'Wk1a2b3c4', Title: 'Year-end accounts', ClientName: 'Synthetic Dental Group' }] };
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
  });
  await context.route('https://app2.karbonhq.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>Karbon</title><script>
    fetch('https://us3.karbonhq.com/time/api/T1x2y3z4/stopwatches/U9k8j7h6', { method: 'POST', headers: { Authorization: 'Bearer secret.jwt.token', 'Content-Type': 'application/json' }, body: JSON.stringify({ WorkItemKey: 'Wk1a2b3c4', Note: 'private note' }) })
      .then((r) => r.json()).then((j) => { document.body.dataset.timer = j.WorkItemTitle; });
    const x = new XMLHttpRequest(); x.open('GET', 'https://us3.karbonhq.com/work/api/T1x2y3z4/workItems?$filter=x'); x.setRequestHeader('Authorization', 'Bearer secret.jwt.token');
    x.onload = () => { document.body.dataset.work = JSON.parse(x.responseText).value[0].Title; }; x.send();
  </script>` }));

  const k = await context.newPage();
  await k.goto('https://app2.karbonhq.com/work/my-work');
  // Karbon's own page got its data, untouched.
  await expect(k.locator('body')).toHaveAttribute('data-timer', 'VAT return Q3');
  await expect(k.locator('body')).toHaveAttribute('data-work', 'Year-end accounts');

  const s = await open('options.html');
  await s.setViewportSize({ width: 1100, height: 1000 });
  await expect(s.getByText('2 Karbon requests recorded.')).toBeVisible();
  await expect(s.getByText("Karbon's timer was seen.")).toBeVisible();
  const stored = await s.evaluate(() => (globalThis as any).chrome.storage.session.get('karbonProbe').then((r: any) => r.karbonProbe));
  const list = Object.values(stored) as any[];
  expect(list.map((e) => `${e.method} ${e.origin}${e.path}`).sort()).toEqual([
    'GET https://us3.karbonhq.com/work/api/{key}/workItems', 'POST https://us3.karbonhq.com/time/api/{key}/stopwatches/{key}',
  ]);
  const sw = list.find((e) => e.method === 'POST');
  expect(sw).toMatchObject({ auth: 'Bearer (JWT)', body: { WorkItemKey: 'string', Note: 'string' }, reply: { StopwatchKey: 'string', WorkItemTitle: 'string', ElapsedSeconds: 'number', StartedAt: 'date-string' } });
  expect(list.find((e) => e.method === 'GET')).toMatchObject({ query: ['$filter'], reply: { value: [{ WorkItemKey: 'string', Title: 'string', ClientName: 'string' }] } });
  expect(JSON.stringify(stored)).not.toMatch(/secret|jwt\.token|VAT|Year-end|Synthetic|private note|T1x2y3z4|U9k8j7h6|Wk1a2b3c4|5400/);
  expect(await spills(s)).toEqual([]);
});
