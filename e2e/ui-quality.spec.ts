import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { EVIDENCE, openRealPopup, expect, rowAction, sampleMode, test } from './fixtures';

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
  await p.getByLabel('Status').waitFor();
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
    await p.getByRole('button', { name: 'All', exact: true }).click();
    await rowAction(p, QUARRY, 'Catch-up bookkeeping January to September with supplier statement reconciliation and fixed asset register rebuild').click();
  });
  await p.getByRole('button', { name: 'All', exact: true }).click();
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
  await p.getByRole('button', { name: 'All', exact: true }).click();
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
  await p.getByRole('button', { name: 'All', exact: true }).click();
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
    await expect(btn).toHaveText('Tracking');
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
  await p.getByRole('button', { name: 'All', exact: true }).click();
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

test('search has exactly one clear control and form fields add no stray height [KWS-036]', async ({ open }) => {
  const p = await sampleMode(open);
  await p.getByRole('button', { name: 'All', exact: true }).click();
  const search = p.getByRole('searchbox');
  await search.fill('book');
  await expect(p.getByRole('button', { name: 'Clear search' })).toHaveCount(1);
  expect(await search.getAttribute('type'), 'type=search would add a second, native clear button').toBe('text');
  const field = await p.getByLabel('Status').evaluate((el) => {
    const f = el.closest('.field')!;
    return f.getBoundingClientRect().height - (el.getBoundingClientRect().bottom - f.getBoundingClientRect().top);
  });
  expect(field, 'space below the Status select inside its field').toBeLessThan(4);
});
