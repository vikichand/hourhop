import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { choose, EVIDENCE, openRealPopup, expect, rowAction, sampleMode, spills, test } from './fixtures';

declare const chrome: any;
declare const axe: any;
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const ALDER = 'Alder & Finch Joinery Ltd';
const QUARRY = 'Quarry Lane Bakery Cooperative (Northern Region Operations Division)';
mkdirSync(EVIDENCE, { recursive: true });

async function setTheme(p: Page, theme: 'dark' | 'light') {
  await p.bringToFront(); // background tabs freeze CSS transitions mid-flight
  await p.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
  await p.waitForTimeout(250); // let the 120ms colour transitions settle before measuring or capturing
}

/** axe-core on the rendered page; CDP evaluate bypasses the extension CSP, nothing ships in the bundle. */
async function axeViolations(p: Page) {
  await p.evaluate(AXE);
  return p.evaluate(async () => {
    const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
    return r.violations.map((v: any) => `${v.id}: ${v.nodes.slice(0, 3).map((n: any) => `${n.target.join(' ')} (${n.any.map((a: any) => a.message).join('; ')})`).join(' | ')}`);
  });
}

async function noHorizontalOverflow(p: Page) {
  return p.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const off = [...document.querySelectorAll('button, input, select, textarea, .timer, .work-title')]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 1 || r.left < -1); })
      .map((e) => e.textContent?.trim().slice(0, 30) || e.getAttribute('aria-label'));
    const scroll = document.documentElement.scrollWidth <= vw;
    const culprits = scroll ? [] : [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > vw + 1 && !e.firstElementChild).map((e) => `${e.tagName}.${e.className}`).slice(0, 5);
    return { scroll, off, ...(culprits.length ? { culprits } : {}) };
  });
}

const shot = (p: Page, name: string) => p.screenshot({ path: path.join(EVIDENCE, `${name}.png`), fullPage: true });

test('axe WCAG 2.2 AA: panel (onboarding, running, paused, search, dialog), review, settings in dark and light [KWS-031, KWS-036]', async ({ open }) => {
  const p = await open('sidepanel.html');
  await p.setViewportSize({ width: 360, height: 800 });
  const results: Record<string, string[]> = {};
  await p.getByRole('button', { name: 'Try sample data' }).waitFor();
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(p, theme);
    results[`onboarding-${theme}`] = await axeViolations(p);
  }
  await p.getByRole('button', { name: 'Try sample data' }).click();
  await rowAction(p, ALDER, 'VAT return Q3').click();
  await p.getByRole('button', { name: 'Budget details' }).click();
  await p.getByRole('button', { name: 'Add note' }).click();
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(p, theme);
    results[`running-${theme}`] = await axeViolations(p);
  }
  await p.getByRole('button', { name: 'Pause', exact: true }).click();
  await p.getByRole('searchbox').fill('a');
  await p.getByRole('combobox', { name: 'Status' }).waitFor();
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(p, theme);
    results[`paused-search-${theme}`] = await axeViolations(p);
  }
  await p.getByRole('button', { name: 'Stop', exact: true }).click();
  const r = await open('review.html');
  await r.getByText('VAT return Q3').first().waitFor();
  const s = await open('options.html');
  await s.getByRole('heading', { name: 'Appearance' }).waitFor();
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(r, theme);
    results[`review-${theme}`] = await axeViolations(r);
    await r.getByRole('button', { name: /^Edit session/ }).click();
    results[`review-edit-dialog-${theme}`] = await axeViolations(r);
    await r.keyboard.press('Escape');
    await setTheme(s, theme);
    results[`settings-${theme}`] = await axeViolations(s);
  }
  writeFileSync(path.join(EVIDENCE, 'axe-results.json'), JSON.stringify(results, null, 2));
  for (const [k, v] of Object.entries(results)) expect(v, k).toEqual([]);
});

test('Escape closes dialogs and focus returns to the opener [KWS-031]', async ({ open }) => {
  const p = await sampleMode(open);
  await rowAction(p, ALDER, 'VAT return Q3').click();
  await p.getByRole('button', { name: 'Stop', exact: true }).click();
  const r = await open('review.html');
  const edit = r.getByRole('button', { name: /^Edit session/ });
  await edit.focus();
  await r.keyboard.press('Enter');
  await expect(r.getByRole('dialog', { name: 'Edit session' })).toBeVisible();
  await r.keyboard.press('Escape');
  await expect(r.getByRole('dialog')).toHaveCount(0);
  await expect(edit).toBeFocused();
});

test('responsive 320/360/400/480/600 px and real browser zoom 150%/200%: no horizontal overflow or clipped controls [KWS-031]', async ({ open }) => {
  const p = await sampleMode(open);
  await rowAction(p, QUARRY, 'Catch-up bookkeeping January to September with supplier statement reconciliation and fixed asset register rebuild').click({ trial: false }).catch(async () => {
    await p.getByRole('button', { name: 'All work', exact: true }).click();
    await rowAction(p, QUARRY, 'Catch-up bookkeeping January to September with supplier statement reconciliation and fixed asset register rebuild').click();
  });
  await p.getByRole('button', { name: 'All work', exact: true }).click();
  const report: Record<string, unknown> = {};
  for (const w of [320, 360, 400, 480, 600]) {
    await p.setViewportSize({ width: w, height: 900 });
    const r = await noHorizontalOverflow(p);
    report[`panel-${w}`] = r;
    expect(r, `panel ${w}px`).toEqual({ scroll: true, off: [] });
  }
  // Real Chrome zoom via chrome.tabs.setZoom on this extension tab.
  const zoom = (f: number) => p.evaluate(async (z) => { const t = await chrome.tabs.getCurrent(); await chrome.tabs.setZoom(t.id, z); }, f);
  for (const [w, z] of [[480, 1.5], [640, 2], [360, 1.5], [360, 2]] as const) {
    await p.setViewportSize({ width: w, height: 900 });
    await zoom(z);
    await p.waitForTimeout(300);
    const css = await p.evaluate(() => document.documentElement.clientWidth);
    const r = await noHorizontalOverflow(p);
    report[`panel-${w}px-zoom-${z * 100}%-(${css}css)`] = r;
    await shot(p, `zoom-${z * 100}-viewport-${w}`);
    // docs/design.md §3.1 targets 320-600 CSS px. 200% zoom in a 360px panel is 180 CSS px, outside that
    // range: it is measured and reported (see responsive-zoom.json), not asserted.
    if (css >= 240) expect(r, `zoom ${z} at ${w}px (${css} CSS px)`).toEqual({ scroll: true, off: [] });
  }
  await zoom(1);
  for (const page of ['review.html', 'options.html']) {
    const q = await open(page);
    for (const w of [320, 480]) {
      await q.setViewportSize({ width: w, height: 900 });
      await q.waitForTimeout(150);
      const r = await noHorizontalOverflow(q);
      report[`${page}-${w}`] = r;
      expect(r, `${page} ${w}px`).toEqual({ scroll: true, off: [] });
    }
  }
  writeFileSync(path.join(EVIDENCE, 'responsive-zoom.json'), JSON.stringify(report, null, 2));
});

test('forced colours keep control boundaries; reduced motion removes transitions [KWS-031]', async ({ open }) => {
  const p = await sampleMode(open);
  await rowAction(p, ALDER, 'VAT return Q3').click();
  await p.emulateMedia({ forcedColors: 'active' });
  const border = await p.getByRole('button', { name: 'Stop', exact: true }).evaluate((e) => getComputedStyle(e).borderTopStyle);
  expect(border).toBe('solid');
  await shot(p, 'forced-colors-running-360');
  await p.emulateMedia({ forcedColors: 'none', reducedMotion: 'reduce' });
  expect(await p.getByRole('button', { name: 'Stop', exact: true }).evaluate((e) => getComputedStyle(e).transitionDuration.split(', ').every((d) => d === '0s'))).toBe(true);
});

test('hostile catalog text renders as text, never markup [KWS-033]', async ({ open }) => {
  let dialogs = 0;
  const p = await sampleMode(open);
  p.on('dialog', (d) => { dialogs++; d.dismiss(); });
  // Hostile names are seeded here, not shipped in the sample data colleagues see.
  await p.evaluate(() => new Promise<void>((res) => {
    const r = indexedDB.open('hourhop');
    r.onsuccess = () => {
      const t = r.result.transaction(['clients', 'work'], 'readwrite');
      t.objectStore('clients').put({ key: 'org-xss', profileId: 'sample', kind: 'Organization', name: '<img src=x onerror="alert(1)"> Test Co' });
      t.objectStore('work').put({ key: 'wi-xss', profileId: 'sample', clientKey: 'org-xss', title: '<script>alert("x")</script> Onboarding', status: 'Ready To Start', budget: { kind: 'none', asOfUtc: new Date().toISOString() } });
      t.oncomplete = () => { r.result.close(); res(); };
    };
  }));
  await p.reload();
  await p.getByRole('button', { name: 'All work', exact: true }).click();
  await p.getByRole('searchbox').fill('test co');
  await expect(p.getByText('<img src=x onerror="alert(1)"> Test Co').first()).toBeVisible();
  await p.getByRole('button', { name: 'Start: <img src=x onerror="alert(1)"> Test Co, <script>alert("x")</script> Onboarding' }).click();
  await expect(p.locator('.tracking .work-title')).toHaveText('<script>alert("x")</script> Onboarding');
  expect(await p.locator('img, script:not([src])').count()).toBe(0);
  const r = await open('review.html');
  await expect(r.getByText('<script>alert("x")</script> Onboarding').first()).toBeVisible();
  expect(await r.locator('img').count()).toBe(0);
  expect(dialogs).toBe(0);
});

test('1,000 work items and 10,000 intervals: bounded DOM, fast search and switching [KWS-029]', async ({ open }) => {
  const p = await open('sidepanel.html');
  await p.setViewportSize({ width: 360, height: 900 });
  await p.getByRole('button', { name: 'Track locally' }).click();
  await p.getByText('No work items yet').waitFor();
  await p.evaluate(() => new Promise<void>((res, rej) => {
    const r = indexedDB.open('hourhop');
    r.onsuccess = () => {
      const db = r.result;
      const t = db.transaction(['clients', 'work', 'sessions', 'state'], 'readwrite');
      const now = Date.now();
      for (let c = 0; c < 100; c++) t.objectStore('clients').put({ key: `c${c}`, profileId: 'local', kind: 'Organization', name: `Synthetic Client ${c}` });
      for (let w = 0; w < 1000; w++) {
        t.objectStore('work').put({ key: `w${w}`, profileId: 'local', clientKey: `c${w % 100}`, title: `Engagement ${w} bookkeeping`, status: 'In Progress', budget: { kind: 'unavailable', reason: 'not-connected' } });
      }
      for (let i = 0; i < 10_000; i++) {
        const start = now - (10_001 - i) * 600_000;
        const w = i % 1000;
        const iso = new Date(start).toISOString();
        const end = new Date(start + 300_000).toISOString();
        t.objectStore('sessions').put({
          id: `s${i}`, profileId: 'local', target: { kind: 'work-item', tenantId: 'local', clientKind: 'Organization', clientId: `c${w % 100}`, workItemId: `w${w}` },
          targetKey: `w:local:Organization:c${w % 100}:w${w}`, label: { client: `Synthetic Client ${w % 100}`, work: `Engagement ${w} bookkeeping` },
          dateLocal: iso.slice(0, 10), timeZone: 'UTC', status: 'stopped', startedAtUtc: iso, segments: [{ startedAtUtc: iso, endedAtUtc: end, elapsedMs: 300_000 }],
          notesSchema: 1, billableIntent: 'unknown', submissionStatus: 'local-only', lastEditedAtUtc: iso, version: 1,
        });
      }
      t.objectStore('state').get('global').onsuccess = (e: any) => t.objectStore('state').put({ ...e.target.result, revision: e.target.result.revision + 1 });
      t.oncomplete = () => { db.close(); res(); };
      t.onerror = () => rej(t.error);
    };
  }));
  const tLoad = Date.now();
  await p.reload();
  await p.getByText('30 recent items').waitFor();
  const loadMs = Date.now() - tLoad;
  await p.getByRole('button', { name: 'All work', exact: true }).click();
  await p.getByText('1100 work items').waitFor(); // 1000 work items + 100 client-only rows
  expect(await p.locator('.work-row').count()).toBe(50);

  const search = p.getByRole('searchbox');
  const searchTimes: number[] = [];
  for (const q of ['engagement 99', 'client 42', 'engagement 512 bookkeeping', 'zzz']) {
    const t0 = Date.now();
    await search.fill(q);
    await p.locator('.list-group').filter({ hasText: /results?$/ }).waitFor();
    await expect(p.locator('.list-group')).not.toHaveText('1100 work items');
    searchTimes.push(Date.now() - t0);
  }
  await search.fill('');
  const switchTimes: number[] = [];
  for (let i = 0; i < 5; i++) {
    const btn = p.locator('[data-row-action]').nth(i * 2);
    const t0 = Date.now();
    await btn.click();
    await expect(btn).toHaveAttribute('aria-label', /^Pause: /);
    switchTimes.push(Date.now() - t0);
  }
  const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
  const perf = { loadMs, searchTimes, switchTimes, searchMedian: median(searchTimes), switchMedian: median(switchTimes), renderedRows: 50 };
  writeFileSync(path.join(EVIDENCE, 'performance.json'), JSON.stringify(perf, null, 2));
  expect(perf.switchMedian).toBeLessThan(3000);
  expect(perf.searchMedian).toBeLessThan(1000);
});

test('screenshot matrix for R0 design audit: states x themes x widths, including the real popup [KWS-036]', async ({ open }) => {
  const p = await open('sidepanel.html');
  for (const theme of ['dark', 'light'] as const) {
    await p.setViewportSize({ width: 360, height: 760 });
    await p.getByRole('button', { name: 'Try sample data' }).waitFor(); // snapshot loaded, so its theme won't override ours
    await setTheme(p, theme);
    await shot(p, `panel-onboarding-${theme}-360`);
  }
  await p.getByRole('button', { name: 'Try sample data' }).click();
  await p.getByRole('region', { name: 'Current timer' }).waitFor();
  await p.getByRole('button', { name: 'All work', exact: true }).click();
  for (const theme of ['dark', 'light'] as const) { await setTheme(p, theme); await shot(p, `panel-idle-all-${theme}-360`); }

  await rowAction(p, ALDER, 'VAT return Q3').click(); // near budget
  await p.getByRole('button', { name: 'Budget details' }).click();
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(p, theme);
    for (const w of [320, 360, 400, 480]) { await p.setViewportSize({ width: w, height: 900 }); await shot(p, `panel-running-near-budget-${theme}-${w}`); }
  }
  await p.setViewportSize({ width: 360, height: 900 });
  await rowAction(p, 'Brightwater Dental Group', 'Year-end accounts 2025/26').click(); // over budget + allocation
  await p.getByRole('button', { name: 'Pause', exact: true }).click();
  for (const theme of ['dark', 'light'] as const) { await setTheme(p, theme); await shot(p, `panel-paused-over-budget-${theme}-360`); }

  await rowAction(p, QUARRY, 'Catch-up bookkeeping January to September with supplier statement reconciliation and fixed asset register rebuild').click();
  await p.getByRole('searchbox').fill('bookkeeping');
  await p.getByRole('searchbox').focus();
  for (const theme of ['dark', 'light'] as const) { await setTheme(p, theme); await shot(p, `panel-long-title-search-focus-${theme}-360`); }
  await p.getByRole('searchbox').fill('');

  await p.evaluate(() => { (IDBObjectStore.prototype as any).put = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); }; });
  await rowAction(p, ALDER, 'VAT return Q3').click();
  await p.getByRole('alert').waitFor();
  for (const theme of ['dark', 'light'] as const) { await setTheme(p, theme); await shot(p, `panel-storage-error-${theme}-360`); }

  const r = await open('review.html');
  await r.setViewportSize({ width: 900, height: 1000 });
  await r.getByText('VAT return Q3').first().waitFor();
  for (const theme of ['dark', 'light'] as const) { await setTheme(r, theme); await shot(r, `review-${theme}-900`); }
  await r.setViewportSize({ width: 360, height: 1000 });
  await shot(r, 'review-light-360');
  await r.getByRole('button', { name: /^Edit session/ }).first().click().catch(() => undefined);
  const s = await open('options.html');
  await s.setViewportSize({ width: 600, height: 1100 });
  await s.getByRole('heading', { name: 'Appearance' }).waitFor();
  for (const theme of ['dark', 'light'] as const) { await setTheme(s, theme); await shot(s, `settings-${theme}-600`); }

  // The real toolbar popup, captured through its own DevTools target.
  for (const theme of ['dark', 'light'] as const) {
    await s.getByRole('button', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true }).click();
    const pop = await openRealPopup(s);
    await new Promise((res) => setTimeout(res, 300));
    const img = await pop.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(EVIDENCE, `popup-real-${theme}.png`), Buffer.from(img.result.data, 'base64'));
    await pop.evaluate('window.close()').catch(() => undefined);
    pop.close();
  }
});

/** Long days on every past day of this week (widest durations, e.g. "23h 59m"), in sample mode. */
async function seedLongWeek(p: Page) {
  await p.evaluate(() => new Promise<void>((res) => {
    const target = { kind: 'work-item', tenantId: 'sample', clientKind: 'Organization', clientId: 'org-alder', workItemId: 'wi-1002' };
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const now = new Date();
    const dow = (now.getDay() + 6) % 7;
    const sessions: any[] = [];
    for (let d = dow; d >= 1; d--) {
      const day = new Date(now); day.setDate(now.getDate() - d); day.setHours(0, 0, 30, 0);
      const mins = d === 1 ? 23 * 60 + 59 : 10 * 60 + 48 + d * 7;
      const s = day.getTime(), e = s + mins * 60_000, iso = new Date(s).toISOString();
      sessions.push({
        id: crypto.randomUUID(), profileId: 'sample', target, targetKey: 'w:sample:Organization:org-alder:wi-1002',
        label: { client: 'Alder & Finch Joinery Ltd', work: 'VAT return Q3' }, dateLocal: fmt.format(s), timeZone: tz, status: 'stopped',
        startedAtUtc: iso, segments: [{ startedAtUtc: iso, endedAtUtc: new Date(e).toISOString(), elapsedMs: e - s }],
        userNote: 'Long day', notesSchema: 1, billableIntent: 'billable', submissionStatus: 'local-only', lastEditedAtUtc: iso, version: 1,
      });
    }
    const r = indexedDB.open('hourhop');
    r.onsuccess = () => {
      const t = r.result.transaction(['sessions'], 'readwrite');
      for (const s of sessions) t.objectStore('sessions').put(s);
      t.oncomplete = () => { r.result.close(); res(); };
    };
  }));
}

test('no text or control spills out of its box on any surface, at any supported width [KWS-036]', async ({ open }) => {
  const found: string[] = [];
  const check = async (p: Page, where: string, widths: number[]) => {
    for (const w of widths) {
      await p.setViewportSize({ width: w, height: 1000 });
      await p.waitForTimeout(150);
      for (const s of await spills(p)) found.push(`${where} @${w}px: ${s}`);
      if (pageWidthsSet.has(w)) await p.screenshot({ path: path.join(EVIDENCE, `fit-${where.replace(/[^a-z0-9]+/gi, '-')}-${w}.png`), fullPage: true });
    }
  };
  const panelWidths = [320, 360, 400, 480, 600];
  const pageWidths = [320, 360, 480, 600, 768, 900, 1024, 1240, 1440];
  const pageWidthsSet = new Set([...panelWidths, ...pageWidths, 300]);

  const p = await open('sidepanel.html');
  await p.getByRole('button', { name: 'Try sample data' }).waitFor();
  await check(p, 'panel onboarding', panelWidths);
  await p.getByRole('button', { name: 'Try sample data' }).click();
  await p.getByRole('region', { name: 'Current timer' }).waitFor();
  await seedLongWeek(p);
  await p.reload();
  await p.getByRole('button', { name: 'All work', exact: true }).click();
  await check(p, 'panel idle, all work', panelWidths);
  await rowAction(p, ALDER, 'VAT return Q3').click();
  await p.getByRole('button', { name: 'Budget details' }).click();
  await check(p, 'panel running, budget details', panelWidths);
  await p.getByRole('button', { name: 'Recent', exact: true }).click();
  await check(p, 'panel recent', panelWidths);

  const pop = await open('popup.html');
  await check(pop, 'popup page', [300, 360]);

  const r = await open('review.html');
  await r.getByText('VAT return Q3').first().waitFor();
  // Every 16px: the day strip switches layout by its card's width, so no width between the breakpoints may break.
  await check(r, 'review today', Array.from({ length: 71 }, (_, i) => 320 + i * 16));
  await r.getByRole('button', { name: 'Last 7 days', exact: true }).click();
  await check(r, 'review last 7 days', pageWidths);

  await r.getByRole('button', { name: /^Edit session/ }).first().click();
  await r.getByRole('dialog', { name: 'Edit session' }).waitFor();
  await check(r, 'review edit dialog', [320, 360, 600, 1240]);
  await r.keyboard.press('Escape');

  const s = await open('options.html');
  await s.getByRole('heading', { name: 'Appearance' }).waitFor();
  await check(s, 'settings', pageWidths);
  await s.getByRole('button', { name: 'Delete all HourHop data…' }).click();
  await s.getByRole('dialog', { name: 'Delete all HourHop data?' }).waitFor();
  await check(s, 'settings delete dialog', [320, 600, 1240]);

  expect(found, found.join('\n')).toEqual([]);
});

test('search has exactly one clear control and form fields add no stray height [KWS-036]', async ({ open }) => {
  const p = await sampleMode(open);
  await p.getByRole('button', { name: 'All work', exact: true }).click();
  const search = p.getByRole('searchbox');
  await search.fill('book');
  await expect(p.getByRole('button', { name: 'Clear search' })).toHaveCount(1);
  expect(await search.getAttribute('type'), 'type=search would add a second, native clear button').toBe('text');
  const field = await p.getByRole('combobox', { name: 'Status' }).evaluate((el) => {
    const f = el.closest('.field')!;
    return f.getBoundingClientRect().height - (el.getBoundingClientRect().bottom - f.getBoundingClientRect().top);
  });
  expect(field, 'space below the Status select inside its field').toBeLessThan(4);
});

test('the shared dropdown: mouse, keyboard, type-to-jump, Escape inside a dialog, outside click, accessible when open [KWS-031, KWS-036]', async ({ open }) => {
  const p = await sampleMode(open, 320);
  await p.getByRole('button', { name: 'All work', exact: true }).click();
  const status = p.getByRole('combobox', { name: 'Status' });
  const list = p.getByRole('listbox', { name: 'Status' });
  await expect(status).toHaveAttribute('aria-expanded', 'false');
  expect(await p.locator('select').count(), 'no native select anywhere').toBe(0);

  // Mouse: open, the current option is marked, pick another; clicking outside closes without a change.
  await status.click();
  await expect(list.getByRole('option', { selected: true })).toHaveText(/Open \(not completed\)/);
  await p.screenshot({ path: path.join(EVIDENCE, 'dropdown-open-dark-320.png') });
  expect(await axeViolations(p)).toEqual([]);
  for (const w of [320, 400]) { await p.setViewportSize({ width: w, height: 900 }); expect(await spills(p), `open list @${w}px`).toEqual([]); }
  await list.getByRole('option', { name: 'All statuses' }).click();
  await expect(list).toHaveCount(0);
  await expect(status).toHaveText('All statuses');
  await status.click();
  await p.locator('.page-title, h1, .brand').first().click({ force: true });
  await expect(list).toHaveCount(0);
  await expect(status).toHaveText('All statuses');

  // Keyboard: arrows open and move, Home/End, typing jumps, Enter picks and returns focus.
  await status.focus();
  await p.keyboard.press('ArrowDown');
  await expect(list).toBeVisible();
  await p.keyboard.press('Home');
  await expect(status).toHaveAttribute('aria-activedescendant', /o0$/);
  await p.keyboard.press('End');
  await p.keyboard.type('c');
  await p.keyboard.press('Enter');
  await expect(status).toHaveText('Completed');
  await expect(status).toBeFocused();

  // Inside a dialog, Escape closes the list and leaves the dialog open.
  await choose(p, 'Status', 'Open (not completed)');
  await rowAction(p, ALDER, 'VAT return Q3').click();
  await p.getByRole('button', { name: 'Stop', exact: true }).click();
  const r = await open('review.html');
  await r.getByRole('button', { name: /^Edit session/ }).first().click();
  const dlg = r.getByRole('dialog', { name: 'Edit session' });
  const billable = dlg.getByRole('combobox', { name: 'Billable' });
  await billable.click();
  await expect(dlg.getByRole('listbox', { name: 'Billable' })).toBeVisible();
  await r.keyboard.press('Escape');
  await expect(dlg.getByRole('listbox', { name: 'Billable' })).toHaveCount(0);
  await expect(dlg).toBeVisible();
  await r.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
});
