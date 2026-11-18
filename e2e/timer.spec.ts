import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  assertLedgerInvariants, attachTarget, dumpDb, expect, extensionId, launch, rowAction, sampleMode, targetList, test,
} from './fixtures';

declare const chrome: any;
const ALDER = 'Alder & Finch Joinery Ltd';
const BODY_TEXT = "document.body?.innerText ?? ''";

test('real toolbar popup: "Open work switcher" opens the side panel from a user gesture [T-307, KWS-018]', async ({ open }) => {
  const settings = await open('options.html');
  await settings.evaluate(() => chrome.action.openPopup());
  const popup = await attachTarget('/popup.html');
  await expect.poll(() => popup.evaluate<string>(BODY_TEXT)).toContain('Open work switcher');
  const before = await targetList();
  expect(before.some((t) => t.url.endsWith('/sidepanel.html'))).toBe(false);
  await popup.click('button.btn'); // trusted mouse event through CDP Input, i.e. a real user gesture
  await expect.poll(async () => (await targetList())
    .some((t) => t.url.endsWith('/sidepanel.html'))).toBe(true);
  // The popup closes itself after opening the panel; nothing depends on it staying mounted.
  await expect.poll(async () => (await targetList())
    .some((t) => t.url.endsWith('/popup.html'))).toBe(false);
});

test('popup and real side panel show one shared timer; pausing in one updates the other [KWS-001, KWS-018]', async ({ open }) => {
  const tab = await sampleMode(open);
  await rowAction(tab, ALDER, 'VAT return Q3').click();
  await expect(tab.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();

  const settings = await open('options.html');
  await settings.evaluate(() => chrome.action.openPopup());
  const popup = await attachTarget('/popup.html');
  await expect.poll(() => popup.evaluate<string>(BODY_TEXT)).toContain('VAT return Q3');
  await popup.click('.controls .btn-primary'); // Pause, inside the real popup
  await expect(tab.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await popup.click('.pad .btn'); // Open work switcher

  const panel = await attachTarget('/sidepanel.html');
  await expect.poll(() => panel.evaluate<string>(BODY_TEXT)).toContain('Paused');
  expect(await panel.evaluate<string>('document.querySelector(".tracking .work-title").textContent')).toBe('VAT return Q3');
  await panel.click('.tracking .btn-primary'); // Resume in the real side panel
  await expect(tab.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  const db = await dumpDb(tab);
  assertLedgerInvariants(db);
  expect(db.sessions).toHaveLength(1);
  expect(db.sessions[0].segments).toHaveLength(1);
});

test('competing starts from two windows leave exactly one running session, 15 rounds [KWS-001, KWS-004]', async ({ open }) => {
  const a = await sampleMode(open);
  const b = await open('sidepanel.html');
  await b.setViewportSize({ width: 360, height: 800 });
  await b.getByRole('button', { name: 'All', exact: true }).click();
  await a.getByRole('button', { name: 'All', exact: true }).click();
  const targets = [['VAT return Q3', 'Management accounts Q3'], ['Payroll run November', 'VAT return Q3']];
  for (let i = 0; i < 15; i++) {
    const [x, y] = targets[i % 2]!;
    const ra = a.locator(`[data-row-action][aria-label*=", ${x}"]`);
    const rb = b.locator(`[data-row-action][aria-label*=", ${y}"]`);
    await Promise.all([ra.dispatchEvent('click'), rb.dispatchEvent('click')]);
    await a.waitForTimeout(150);
    assertLedgerInvariants(await dumpDb(a));
  }
  const db = await dumpDb(a);
  expect(db.sessions.filter((s) => s.status === 'running')).toHaveLength(1);
  // Both surfaces converge on the same current target.
  await expect.poll(async () => (await a.locator('.tracking .work-title').textContent()) === (await b.locator('.tracking .work-title').textContent())).toBe(true);
});

test('browser restart keeps the running session and derives elapsed time from timestamps [KWS-005]', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hourhop-restart-'));
  try {
    let ctx = await launch(dir);
    let id = await extensionId(ctx);
    let p = await ctx.newPage();
    await p.goto(`chrome-extension://${id}/sidepanel.html`);
    await p.getByRole('button', { name: 'Try sample data' }).click();
    await rowAction(p, ALDER, 'VAT return Q3').click();
    await expect(p.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    const before = await dumpDb(p);
    await ctx.close(); // every extension page and the browser process end

    await new Promise((r) => setTimeout(r, 2500));
    ctx = await launch(dir);
    id = await extensionId(ctx);
    p = await ctx.newPage();
    await p.goto(`chrome-extension://${id}/sidepanel.html`);
    await expect(p.locator('.tracking .work-title')).toHaveText('VAT return Q3');
    await expect(p.getByText('Running', { exact: true })).toBeVisible();
    const t = await p.locator('.timer').textContent();
    const secs = t!.split(':').map(Number).reduce((a, n) => a * 60 + n, 0);
    expect(secs).toBeGreaterThanOrEqual(2);
    const after = await dumpDb(p);
    expect(after.sessions).toEqual(before.sessions);
    expect(ctx.serviceWorkers()).toEqual([]);
    await ctx.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('storage write failure is shown and the previous timer stays truthful [KWS-005, T-204]', async ({ open }) => {
  const p = await sampleMode(open);
  await rowAction(p, ALDER, 'VAT return Q3').click();
  await expect(p.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await p.evaluate(() => {
    (IDBObjectStore.prototype as any).put = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
  });
  await p.getByRole('button', { name: 'All', exact: true }).click();
  await rowAction(p, 'Quarry Lane Bakery Cooperative (Northern Region Operations Division)', 'Management accounts Q3').click();
  await expect(p.getByRole('alert')).toContainText('Not saved');
  await expect(p.locator('.tracking .work-title')).toHaveText('VAT return Q3');
  const db = await dumpDb(p);
  assertLedgerInvariants(db);
  expect(db.sessions).toHaveLength(1);
});

test('search keeps focus and caret while the timer ticks; keyboard-only start/switch/pause/stop [KWS-018, KWS-031]', async ({ open }) => {
  const p = await sampleMode(open);
  await rowAction(p, ALDER, 'VAT return Q3').click();
  const search = p.getByRole('searchbox', { name: 'Search clients and work items' });
  await search.focus();
  await p.keyboard.type('bookkeeping alder');
  await search.evaluate((el: HTMLInputElement) => el.setSelectionRange(4, 4));
  const t0 = await p.locator('.timer').textContent();
  await p.waitForTimeout(3200); // three ticks
  expect(await p.locator('.timer').textContent()).not.toBe(t0);
  expect(await p.evaluate(() => (document.activeElement as HTMLInputElement).getAttribute('type'))).toBe('search');
  expect(await search.evaluate((el: HTMLInputElement) => [el.value, el.selectionStart])).toEqual(['bookkeeping alder', 4]);

  // Keyboard-only: ArrowDown to the first result, Enter switches, focus stays on that row.
  await p.keyboard.press('ArrowDown');
  const focused = await p.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  expect(focused).toMatch(/^Switch: Alder & Finch Joinery Ltd, Monthly bookkeeping/);
  await p.keyboard.press('Enter');
  await expect(p.locator('.tracking .work-title')).toHaveText('Monthly bookkeeping');
  expect(await p.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toMatch(/^Tracking: /);
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('ArrowUp');
  await p.keyboard.press('ArrowUp');
  expect(await p.evaluate(() => (document.activeElement as HTMLElement).getAttribute('type'))).toBe('search');
  await p.keyboard.press('Escape');
  await expect(search).toHaveValue('');
  await p.getByRole('button', { name: 'Pause', exact: true }).focus();
  await p.keyboard.press('Enter');
  await expect(p.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await p.getByRole('button', { name: 'Stop', exact: true }).focus();
  await p.keyboard.press('Space');
  await expect(p.locator('.tracking-idle')).toContainText('No timer running');
  const db = await dumpDb(p);
  assertLedgerInvariants(db);
  expect(db.sessions.map((s) => s.status).sort()).toEqual(['stopped', 'stopped']);
});

test('same-target select is a no-op; completed work asks before starting [KWS-009]', async ({ open }) => {
  const p = await sampleMode(open);
  await rowAction(p, ALDER, 'VAT return Q3').click();
  await expect(rowAction(p, ALDER, 'VAT return Q3')).toHaveText('Tracking');
  await rowAction(p, ALDER, 'VAT return Q3').click({ force: true }); // aria-disabled, still focusable
  expect((await dumpDb(p)).sessions).toHaveLength(1);
  await p.getByRole('button', { name: 'All', exact: true }).click();
  await p.getByLabel('Status').selectOption('completed');
  await rowAction(p, ALDER, 'Monthly bookkeeping').click();
  await expect(p.getByRole('dialog', { name: 'Start completed work?' })).toBeVisible();
  await p.getByRole('button', { name: 'Cancel' }).click();
  expect((await dumpDb(p)).sessions).toHaveLength(1);
  await rowAction(p, ALDER, 'Monthly bookkeeping').click();
  await p.getByRole('button', { name: 'Start anyway' }).click();
  await expect(p.locator('.tracking .work-title')).toHaveText('Monthly bookkeeping');
});
