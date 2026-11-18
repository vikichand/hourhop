import { readFileSync } from 'node:fs';
import { assertLedgerInvariants, dumpDb, expect, rowAction, sampleMode, test } from './fixtures';

const ALDER = 'Alder & Finch Joinery Ltd';

/** Writes two stopped sessions with fixed times directly, so review tests are deterministic. */
async function seedStopped(p: import('@playwright/test').Page) {
  await rowAction(p, ALDER, 'VAT return Q3').click();
  await p.getByRole('button', { name: 'Stop', exact: true }).click();
  await p.evaluate(() => new Promise<void>((res) => {
    const r = indexedDB.open('hourhop');
    r.onsuccess = () => {
      const db = r.result;
      const t = db.transaction('sessions', 'readwrite');
      const st = t.objectStore('sessions');
      st.getAll().onsuccess = (e: any) => {
        const s = e.target.result[0];
        const day = s.dateLocal;
        const at = (h: number, m: number) => { const d = new Date(`${day}T00:00:00`); d.setHours(h, m, 0, 0); return d.toISOString(); };
        st.put({ ...s, startedAtUtc: at(9, 0), segments: [{ startedAtUtc: at(9, 0), endedAtUtc: at(10, 0), elapsedMs: 3_600_000 }],
          userNote: '=SUM(A1) reconciled\nsecond line <b>bold?</b>' });
      };
      t.oncomplete = () => { db.close(); res(); };
    };
  }));
}

test('review: audited edit, split and discard; CSV/JSON export keep IDs and verbatim notes [KWS-013, KWS-014, KWS-032, KWS-035]', async ({ open }) => {
  const p = await sampleMode(open);
  await seedStopped(p);
  const r = await open('review.html');
  await r.setViewportSize({ width: 900, height: 1000 });
  await expect(r.getByText('1h 00m').first()).toBeVisible();
  await expect(r.locator('.note')).toHaveText('=SUM(A1) reconciled\nsecond line <b>bold?</b>');
  await expect(r.locator('.note b')).toHaveCount(0);

  // Edit times: reason required, then audited.
  await r.getByRole('button', { name: /^Edit session/ }).click();
  const dlg = r.getByRole('dialog', { name: 'Edit session' });
  const end = dlg.getByLabel('Interval 1 end');
  const endVal = await end.inputValue();
  await end.fill(endVal.replace(/T10:00/, 'T09:45'));
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(dlg.getByRole('alert')).toContainText('Enter a reason');
  await dlg.getByLabel('Reason for time change, split or discard').fill('Left early for a client call');
  await dlg.getByLabel('Role').fill('Senior');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(dlg).toBeHidden();
  await expect(r.getByText('45m').first()).toBeVisible();
  await expect(r.getByText('Role: Senior')).toBeVisible();

  // Split at 09:15 into two sessions, then discard the second.
  await r.getByRole('button', { name: /^Edit session/ }).click();
  await dlg.getByLabel('Split into two sessions at').fill(endVal.replace(/T10:00(:00)?/, 'T09:15:00'));
  await dlg.getByLabel('Reason for time change, split or discard').fill('Two different tasks');
  await dlg.getByRole('button', { name: 'Split' }).click();
  await expect(dlg).toBeHidden();
  await expect(r.getByRole('button', { name: /^Edit session/ })).toHaveCount(2);
  await r.getByRole('button', { name: /^Edit session/ }).nth(1).click();
  await expect(dlg.getByText('Edit history (1)')).toBeVisible();
  await dlg.getByLabel('Reason for time change, split or discard').fill('Personal errand');
  await dlg.getByRole('button', { name: 'Discard…' }).click();
  await r.getByRole('button', { name: 'Discard session' }).click();
  await expect(r.getByRole('button', { name: /^Edit session/ })).toHaveCount(1);
  assertLedgerInvariants(await dumpDb(r));

  // Exports.
  const [csvDl] = await Promise.all([r.waitForEvent('download'), r.getByRole('button', { name: 'Export all as CSV' }).click()]);
  const csv = readFileSync(await csvDl.path(), 'utf8');
  expect(csv.split('\r\n')[0]).toContain('session_id,profile,target_kind,client_kind,client_id,work_item_id');
  expect(csv).toContain(',sample,work-item,Organization,org-alder,wi-1002,');
  expect(csv).toContain(`"'=SUM(A1) reconciled\nsecond line <b>bold?</b>"`);
  expect(csv).toContain(',900000,15.00,');
  const [jsonDl] = await Promise.all([r.waitForEvent('download'), r.getByRole('button', { name: 'Export all as JSON' }).click()]);
  const json = JSON.parse(readFileSync(await jsonDl.path(), 'utf8'));
  expect(json.sessions[0].userNote).toBe('=SUM(A1) reconciled\nsecond line <b>bold?</b>');
  expect(json.sessions[0].submissionStatus).toBe('local-only');
  expect(JSON.stringify(json)).not.toMatch(/token|cookie|password|apikey/i);
});

test('review never claims Karbon confirmation; active session cannot be edited [KWS-026, KWS-027]', async ({ open }) => {
  const p = await sampleMode(open);
  await rowAction(p, ALDER, 'VAT return Q3').click();
  const r = await open('review.html');
  await expect(r.getByText('This is local time only. Nothing here has been sent to Karbon.', { exact: false })).toBeVisible();
  await expect(r.locator('.total').filter({ hasText: 'Confirmed in Karbon' })).toContainText('Not connected');
  await expect(r.getByText('Local only').first()).toBeVisible();
  await expect(r.getByRole('button', { name: 'Stop the timer to edit this session' })).toHaveAttribute('aria-disabled', 'true');
  expect(await r.content()).not.toMatch(/Synced|Confirmed in Karbon:\s*\d/);
});

test('settings: theme applies across surfaces; mode switch blocked while running; delete needs typed confirmation [KWS-016, KWS-034]', async ({ open }) => {
  const p = await sampleMode(open);
  await rowAction(p, ALDER, 'VAT return Q3').click();
  const s = await open('options.html');
  await s.getByRole('button', { name: 'Light', exact: true }).click();
  await expect.poll(() => p.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
  await s.getByRole('button', { name: 'Local only', exact: true }).click();
  await expect(s.getByRole('alert')).toContainText('Stop the running timer before switching data mode.');
  await p.getByRole('button', { name: 'Stop', exact: true }).click();
  await s.getByRole('button', { name: 'Local only', exact: true }).click();
  // The other namespace's client names never appear in local mode.
  await expect(p.getByText('No work items yet')).toBeVisible();
  await expect(p.getByText(ALDER)).toHaveCount(0);

  // Local catalog: add a client and work item, track it.
  await p.getByRole('button', { name: 'Add work item' }).click();
  const dlg = p.getByRole('dialog', { name: 'Add work item' });
  await dlg.getByLabel('Client name').fill('Synthetic Client One');
  await dlg.getByLabel('Work item title').fill('Bank reconciliation');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await rowAction(p, 'Synthetic Client One', 'Bank reconciliation').click();
  await expect(p.locator('.tracking .work-title')).toHaveText('Bank reconciliation');
  await expect(p.getByText('Budget unavailable: not connected to Karbon')).toBeVisible();

  await s.getByRole('button', { name: 'Delete all HourHop data…' }).click();
  const del = s.getByRole('dialog', { name: 'Delete all HourHop data?' });
  await del.getByRole('button', { name: 'Delete everything' }).click({ force: true });
  expect((await dumpDb(s)).sessions.length).toBeGreaterThan(0); // not deleted without typing
  await del.getByLabel('Type DELETE to confirm').fill('DELETE');
  await del.getByRole('button', { name: 'Delete everything' }).click();
  await expect(s.getByText('All HourHop data was deleted.')).toBeVisible();
  const db = await dumpDb(s);
  expect(db.sessions).toEqual([]);
  expect(db.state.activeSessionId).toBeNull();
  await expect(p.getByRole('button', { name: 'Try sample data' })).toBeVisible();
});
