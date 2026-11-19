// Generates the README banner (animated GIF) and screenshots from the real built extension.
// Usage: pnpm build && node scripts/readme-assets.mjs   (needs ffmpeg on PATH for the GIF)
// Output: docs/images/. Synthetic sample data only.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const OUT = path.resolve('docs/images');
const EXT = path.resolve('.output/chrome-mv3');
mkdirSync(OUT, { recursive: true });

// ---------- 1. banner: the design system's own CSS, rendered frame by frame ----------
async function banner() {
  const work = mkdtempSync(path.join(tmpdir(), 'hourhop-banner-'));
  const fontCss = pathToFileURL(path.resolve('node_modules/@fontsource-variable/manrope/index.css')).href;
  writeFileSync(path.join(work, 'tokens.css'), readFileSync('src/ui/tokens.css', 'utf8').replace("@import '@fontsource-variable/manrope/index.css';", `@import url('${fontCss}');`));
  copyFileSync('src/ui/app.css', path.join(work, 'app.css'));
  copyFileSync('scripts/banner.html', path.join(work, 'banner.html'));
  const frames = path.join(work, 'frames');
  mkdirSync(frames);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 440 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.join(work, 'banner.html')).href);
  await page.evaluate(() => document.fonts.ready);
  const FPS = 12, LOOP = 6;
  for (let i = 0; i < FPS * LOOP; i++) {
    await page.evaluate(([t, loop]) => window.render(t, loop), [i / FPS, LOOP]);
    await page.screenshot({ path: path.join(frames, `f${String(i).padStart(3, '0')}.png`) });
  }
  await page.evaluate(() => window.render(1.5, 6));
  await page.setViewportSize({ width: 1280, height: 440 });
  const still = await browser.newPage({ viewport: { width: 1280, height: 440 }, deviceScaleFactor: 2 });
  await still.goto(pathToFileURL(path.join(work, 'banner.html')).href);
  await still.evaluate(() => document.fonts.ready);
  await still.evaluate(() => window.render(1.5, 6));
  await still.screenshot({ path: path.join(OUT, 'banner.png') });
  await browser.close();

  // Two-pass palette keeps the glass gradients smooth in 256 colours.
  const input = ['-y', '-framerate', String(FPS), '-i', path.join(frames, 'f%03d.png')];
  execFileSync('ffmpeg', [...input, '-vf', 'palettegen=max_colors=256:stats_mode=full', path.join(work, 'palette.png')], { stdio: 'ignore' });
  execFileSync('ffmpeg', [...input, '-i', path.join(work, 'palette.png'), '-lavfi', 'paletteuse=dither=sierra2_4a', '-loop', '0', path.join(OUT, 'banner.gif')], { stdio: 'ignore' });
  rmSync(work, { recursive: true, force: true });
}

// ---------- 2. screenshots from the real extension ----------
async function launch() {
  const profile = mkdtempSync(path.join(tmpdir(), 'hourhop-shots-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--remote-debugging-port=0'],
  });
  const port = Number(readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
  const mgmt = await ctx.newPage();
  await mgmt.goto('chrome://extensions');
  const id = await mgmt.evaluate(async () => (await chrome.management.getAll()).find((e) => e.name === 'HourHop').id);
  const close = async () => { await ctx.close(); rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); };
  return { ctx, port, url: (p) => `chrome-extension://${id}/${p}`, close };
}

async function screenshots() {
  const { ctx, port, url, close } = await launch();

  const p = await ctx.newPage();
  await p.setViewportSize({ width: 380, height: 1180 });
  await p.goto(url('sidepanel.html'));
  await p.getByRole('button', { name: 'Try sample data' }).click();
  await p.getByRole('region', { name: 'Current timer' }).waitFor();

  // A believable week of synthetic sessions, plus a running timer started 1h 24m ago.
  await p.evaluate(() => new Promise((res) => {
    const T = (clientKind, clientId, workItemId) => ({ kind: 'work-item', tenantId: 'sample', clientKind, clientId, workItemId });
    const jobs = [
      [T('Organization', 'org-alder', 'wi-1002'), 'Alder & Finch Joinery Ltd', 'VAT return Q3', 'Reconciled Q3 sales ledger'],
      [T('Organization', 'org-brightwater', 'wi-1004'), 'Brightwater Dental Group', 'Payroll run November', 'Checked P11D figures, emailed client'],
      [T('Organization', 'org-quarry', 'wi-1011'), 'Quarry Lane Bakery Cooperative (Northern Region Operations Division)', 'Management accounts Q3', 'Accruals and prepayments'],
      [T('Contact', 'con-okafor', 'wi-1005'), 'Ngozi Okafor', 'Personal tax return 2025/26', 'Gathered dividend vouchers'],
      [T('Organization', 'org-alder', 'wi-1001'), 'Alder & Finch Joinery Ltd', 'Monthly bookkeeping', 'Bank feeds and supplier bills'],
    ];
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const now = new Date();
    const dow = (now.getDay() + 6) % 7; // 0 = Monday
    const plan = [[0, 95], [1, 70], [4, 120], [2, 55], [3, 80], [1, 40], [0, 65], [2, 110], [4, 90], [3, 35], [1, 85], [0, 60]];
    const sessions = [];
    let n = 0;
    for (let d = dow; d >= 0; d--) {
      const day = new Date(now); day.setDate(now.getDate() - d); day.setHours(8, 40, 0, 0);
      let cursor = day.getTime();
      const count = d === 0 ? 2 : 4;
      for (let k = 0; k < count; k++) {
        const [ji, mins] = plan[(n++) % plan.length];
        const [target, client, work, note] = jobs[ji];
        const s = cursor, e = cursor + mins * 60_000;
        cursor = e + 10 * 60_000;
        if (d === 0 && e > now.getTime() - 90 * 60_000) break;
        const iso = new Date(s).toISOString();
        sessions.push({
          id: crypto.randomUUID(), profileId: 'sample', target,
          targetKey: `w:sample:${target.clientKind}:${target.clientId}:${target.workItemId}`,
          label: { client, work }, dateLocal: fmt.format(s), timeZone: tz, status: 'stopped', startedAtUtc: iso,
          segments: [{ startedAtUtc: iso, endedAtUtc: new Date(e).toISOString(), elapsedMs: e - s }],
          userNote: note, notesSchema: 1, roleName: k % 2 ? 'Senior' : undefined, billableIntent: 'billable',
          submissionStatus: 'local-only', lastEditedAtUtc: iso, version: 1,
        });
      }
    }
    const r = indexedDB.open('hourhop');
    r.onsuccess = () => {
      const db = r.result;
      const t = db.transaction(['sessions', 'state'], 'readwrite');
      for (const s of sessions) t.objectStore('sessions').put(s);
      t.objectStore('state').get('fav:sample').onsuccess = () => t.objectStore('state').put({ key: 'fav:sample', keys: [jobs[0][0], jobs[1][0]].map((x) => `w:sample:${x.clientKind}:${x.clientId}:${x.workItemId}`) });
      t.oncomplete = () => { db.close(); res(); };
    };
  }));
  await p.reload();
  await p.getByRole('button', { name: 'All work', exact: true }).click();
  await p.locator('[data-row-action][aria-label$="Alder & Finch Joinery Ltd, VAT return Q3"]').click();
  await p.getByRole('button', { name: 'Pause', exact: true }).waitFor();
  await p.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('hourhop');
    r.onsuccess = () => {
      const db = r.result;
      const t = db.transaction(['sessions', 'state'], 'readwrite');
      t.objectStore('state').get('global').onsuccess = (e) => {
        const st = e.target.result;
        t.objectStore('sessions').get(st.activeSessionId).onsuccess = (ev) => {
          const s = ev.target.result;
          const since = new Date(Date.now() - (84 * 60 + 7) * 1000).toISOString();
          t.objectStore('sessions').put({ ...s, startedAtUtc: since, runningSinceUtc: since, userNote: 'Reconciled Q3 sales ledger, queried 2 supplier invoices' });
          t.objectStore('state').put({ ...st, revision: st.revision + 1 });
        };
      };
      t.oncomplete = () => { db.close(); res(); };
    };
  }));
  await p.reload();
  await p.getByRole('button', { name: 'Recent', exact: true }).click();
  await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(OUT, 'side-panel-dark.png'), fullPage: true });

  const s = await ctx.newPage();
  await s.setViewportSize({ width: 1240, height: 760 });
  await s.goto(url('options.html'));
  await s.getByRole('heading', { name: 'Appearance' }).waitFor();

  const r = await ctx.newPage();
  await r.setViewportSize({ width: 1240, height: 1040 });
  await r.goto(url('review.html'));
  await r.getByText('VAT return Q3').first().waitFor();
  await r.waitForTimeout(500);
  await r.screenshot({ path: path.join(OUT, 'review.png') });

  // Real toolbar popup, captured through its own DevTools target.
  await s.bringToFront();
  await s.evaluate(() => chrome.action.openPopup());
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.url.endsWith('/popup.html'));
    if (!target) await new Promise((res) => setTimeout(res, 100));
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res) => (ws.onopen = res));
  await new Promise((res) => setTimeout(res, 900));
  const shot = await new Promise((res) => { ws.onmessage = (m) => res(JSON.parse(String(m.data))); ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } })); });
  writeFileSync(path.join(OUT, 'popup.png'), Buffer.from(shot.result.data, 'base64'));
  ws.close();

  // Light theme side panel.
  await s.getByRole('button', { name: 'Light', exact: true }).click();
  await p.bringToFront();
  await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(OUT, 'side-panel-light.png'), fullPage: true });

  await close();
}

// ---------- 3. Karbon mode, against a simulated api.karbonhq.com with made-up data (never the real Karbon) ----------
async function karbonShots() {
  const { ctx, url, close } = await launch();
  const work = [
    ['WK1', 'VAT return Q3', 'CK1', 'Alder & Finch Joinery Ltd', 'In Progress', '2026-11-30'],
    ['WK2', 'Year-end accounts 2026', 'CK2', 'Brightwater Dental Group', 'Ready To Start', '2026-12-15'],
    ['WK3', 'Payroll run November', 'CK2', 'Brightwater Dental Group', 'In Progress', '2026-11-28'],
    ['WK4', 'Monthly bookkeeping', 'CK1', 'Alder & Finch Joinery Ltd', 'Planned', undefined],
    ['WK5', 'Personal tax return 2025/26', 'CK3', 'Ngozi Okafor', 'Waiting', '2027-01-31'],
  ].map(([WorkItemKey, Title, ClientKey, ClientName, PrimaryStatus, DueDate]) => ({ WorkItemKey, Title, ClientKey, ClientName, ClientType: ClientKey === 'CK3' ? 'Contact' : 'Organization', PrimaryStatus, DueDate }));
  await ctx.route('https://api.karbonhq.com/**', (route) => {
    const u = new URL(route.request().url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (u.pathname === '/v3/TenantSettings') return json({ TenantKey: 'DEMO-FIRM' });
    if (u.pathname === '/v3/Users') return json({ value: [{ Id: 'UK1', Name: 'Pat Example', EmailAddress: 'pat@firm.example' }] });
    if (u.pathname === '/v3/WorkItems') {
      const st = /PrimaryStatus eq '([^']*)'/.exec(u.searchParams.get('$filter') ?? '')?.[1];
      return json({ value: work.filter((w) => w.PrimaryStatus === st) });
    }
    if (u.pathname === '/v3/EstimateSummaries/WK1') return json({ value: [{ UserKey: 'UK1', EstimateMinutes: 240, ActualMinutes: 95 }, { UserKey: 'UK2', EstimateMinutes: 120, ActualMinutes: 60 }] });
    if (u.pathname.startsWith('/v3/EstimateSummaries/')) return json({ value: [{ UserKey: 'UK1', EstimateMinutes: 180, ActualMinutes: 30 }] });
    return json({}, 404);
  });

  const p = await ctx.newPage();
  await p.setViewportSize({ width: 380, height: 900 });
  await p.goto(url('sidepanel.html'));
  await p.getByRole('button', { name: 'Try sample data' }).waitFor();
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(OUT, 'first-run.png') });

  const s = await ctx.newPage();
  await s.setViewportSize({ width: 1240, height: 900 });
  await s.goto(url('options.html'));
  await s.getByLabel('Application ID').fill('demo-application-id');
  await s.getByLabel('AccessKey').fill('eyJdemo.access.key');
  await s.getByLabel('Your Karbon email').fill('pat@firm.example');
  await s.getByRole('button', { name: 'Connect Karbon' }).scrollIntoViewIfNeeded();
  await s.screenshot({ path: path.join(OUT, 'karbon-connect.png') });
  await s.getByRole('button', { name: 'Connect Karbon' }).click();
  await s.getByText('Connected as Pat Example').waitFor();
  await s.screenshot({ path: path.join(OUT, 'karbon-settings.png') });

  await p.setViewportSize({ width: 380, height: 1100 });
  await p.reload();
  await p.getByText(/^Synced from Karbon at /).waitFor();
  await p.getByRole('button', { name: 'All work', exact: true }).click();
  await p.locator('[data-row-action][aria-label$="Alder & Finch Joinery Ltd, VAT return Q3"]').click();
  await p.locator('.dial-sub').filter({ hasText: 'budget' }).waitFor();
  await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(OUT, 'karbon-side-panel.png'), fullPage: true });
  await close();
}

await banner();
await screenshots();
await karbonShots();
console.log(`Wrote README assets to ${OUT}`);
