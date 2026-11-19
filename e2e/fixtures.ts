import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

declare const chrome: any;

export const EXT_PATH = path.resolve('.output/chrome-mv3');

/** DevTools port of the most recently launched test browser (the suite runs with one worker). */
let debugPort = 0;
export const targetList = async () =>
  (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()) as { url: string; webSocketDebuggerUrl: string }[];

export async function launch(profileDir: string): Promise<BrowserContext> {
  // BRANDED=1 runs installed Google Chrome. It ignores --load-extension, so the unpacked build is
  // loaded through the CDP Extensions domain instead (needs --enable-unsafe-extension-debugging).
  const branded = !!process.env.BRANDED;
  const ctx = await chromium.launchPersistentContext(profileDir, {
    channel: branded ? 'chrome' : 'chromium',
    headless: process.env.HEADED ? false : true,
    ignoreDefaultArgs: branded ? ['--disable-extensions'] : undefined,
    // A random loopback DevTools port lets tests reach the real toolbar popup, which Playwright does not
    // expose as a Page. Chrome writes the chosen port to DevToolsActivePort in the throwaway profile.
    args: branded
      ? ['--enable-unsafe-extension-debugging', '--remote-debugging-port=0']
      : [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`, '--remote-debugging-port=0'],
  });
  const [port, browserPath] = readFileSync(path.join(profileDir, 'DevToolsActivePort'), 'utf8').trim().split('\n');
  debugPort = Number(port);
  if (branded) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${browserPath}`);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    const res = await new Promise<any>((r) => { ws.onmessage = (m) => r(JSON.parse(String(m.data))); ws.send(JSON.stringify({ id: 1, method: 'Extensions.loadUnpacked', params: { path: EXT_PATH } })); });
    ws.close();
    if (!res.result?.id) throw new Error(`Extensions.loadUnpacked failed: ${JSON.stringify(res)}`);
  }
  return ctx;
}

/** Minimal CDP client for one target over its DevTools WebSocket. */
export async function attachTarget(urlSuffix: string, timeoutMs = 5000) {
  const until = Date.now() + timeoutMs;
  let target: { webSocketDebuggerUrl: string; url: string } | undefined;
  while (!target && Date.now() < until) {
    const list = await targetList();
    target = list.find((t) => t.url.endsWith(urlSuffix));
    if (!target) await new Promise((r) => setTimeout(r, 100));
  }
  if (!target) throw new Error(`No target ${urlSuffix}`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map<number, (v: any) => void>();
  ws.onmessage = (m) => { const d = JSON.parse(String(m.data)); pending.get(d.id)?.(d); pending.delete(d.id); };
  // Every command times out, so a target that closes mid-test fails with a reason instead of hanging.
  const send = (method: string, params: object = {}, ms = 5000) => new Promise<any>((r, j) => {
    const n = ++id;
    const timer = setTimeout(() => { pending.delete(n); j(new Error(`CDP ${method} on ${urlSuffix} timed out`)); }, ms);
    pending.set(n, (v) => { clearTimeout(timer); r(v); });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evaluate = async <T>(expression: string): Promise<T> => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result?.result?.value as T;
  };
  /** Real trusted mouse click (a user gesture) at the centre of the first element matching `selector`. */
  const click = async (selector: string) => {
    const rect = await evaluate<{ x: number; y: number }>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    try {
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    } catch (e) {
      // A click that closes its own page (the popup's "Open work switcher") can race the reply.
      // The click was delivered if the target is gone; callers assert the effect.
      if ((await targetList()).some((t) => t.url.endsWith(urlSuffix))) throw e;
    }
  };
  return { send, evaluate, click, close: () => ws.close() };
}

/** Extension ID, found from the chrome://extensions page data (no background worker exists to read it from). */
export async function extensionId(context: BrowserContext): Promise<string> {
  const page = await context.newPage();
  await page.goto('chrome://extensions');
  const id = await page.evaluate(async () => {
    const all = await (chrome as any).management.getAll();
    return all.find((e: any) => e.name === 'HourHop')?.id as string;
  });
  await page.close();
  if (!id) throw new Error('HourHop extension not loaded');
  return id;
}

type Fixtures = { profileDir: string; context: BrowserContext; extId: string; open: (p: string) => Promise<Page> };

export const test = base.extend<Fixtures>({
  profileDir: async ({}, use) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'hourhop-e2e-'));
    await use(dir);
    rmSync(dir, { recursive: true, force: true });
  },
  context: async ({ profileDir }, use) => {
    const ctx = await launch(profileDir);
    await use(ctx);
    await ctx.close();
  },
  extId: async ({ context }, use) => use(await extensionId(context)),
  open: async ({ context, extId }, use) =>
    use(async (p: string) => {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extId}/${p}`);
      return page;
    }),
});
export const expect = test.expect;

export const EVIDENCE = process.env.EVIDENCE_DIR ?? '.tmp/evidence';

/** Reads the ledger straight from IndexedDB in an extension page (same origin), independent of the UI. */
export async function dumpDb(page: Page): Promise<{ sessions: any[]; state: any }> {
  return page.evaluate(() => new Promise<any>((res, rej) => {
    const r = indexedDB.open('hourhop');
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const db = r.result;
      const t = db.transaction(['sessions', 'state']);
      const out: any = {};
      t.objectStore('sessions').getAll().onsuccess = (e: any) => (out.sessions = e.target.result);
      t.objectStore('state').get('global').onsuccess = (e: any) => (out.state = e.target.result);
      t.oncomplete = () => { db.close(); res(out); };
    };
  }));
}

/** At most one running/paused session, matching the global pointer, and no overlapping intervals. */
export function assertLedgerInvariants(db: { sessions: any[]; state: any }) {
  const live = db.sessions.filter((s) => s.status === 'running' || s.status === 'paused');
  if (live.length > 1) throw new Error(`${live.length} live sessions`);
  if ((live[0]?.id ?? null) !== (db.state?.activeSessionId ?? null)) throw new Error('active pointer mismatch');
  const segs = db.sessions.flatMap((s) => s.segments.map((g: any) => [Date.parse(g.startedAtUtc), Date.parse(g.endedAtUtc)]));
  segs.sort((a: number[], b: number[]) => a[0]! - b[0]!);
  for (let i = 1; i < segs.length; i++) if (segs[i][0] < segs[i - 1][1]) throw new Error('overlapping intervals');
}

/** Opens the side panel page as a tab, picks sample data. */
export async function sampleMode(open: (p: string) => Promise<Page>, width = 360): Promise<Page> {
  const p = await open('sidepanel.html');
  await p.setViewportSize({ width, height: 800 });
  await p.getByRole('button', { name: 'Try sample data' }).click();
  await p.getByRole('region', { name: 'Current timer' }).waitFor();
  return p;
}

/** Picks an option in the shared custom dropdown the way a person does: open it, click the option. */
export async function choose(p: Page, label: string, option: string) {
  await p.getByRole('combobox', { name: label }).click();
  await p.getByRole('listbox', { name: label }).getByRole('option', { name: option, exact: true }).click();
}

export function rowAction(p: Page, client: string, work: string) {
  return p.locator(`[data-row-action][aria-label$="${client}, ${work}"]`);
}

/**
 * Opens the real toolbar popup from an extension page and attaches to it. The page is brought to the
 * front first: openPopup() needs a focused browser window, which headless Linux CI does not guarantee.
 */
export async function openRealPopup(from: Page) {
  for (let attempt = 1; ; attempt++) {
    await from.bringToFront();
    await expect.poll(() => from.evaluate(() => chrome.action.openPopup().then(() => 'ok', (e: Error) => e.message)), { timeout: 10_000 }).toBe('ok');
    try {
      const popup = await attachTarget('/popup.html');
      await expect.poll(() => popup.evaluate<string>("document.body?.innerText ?? ''"), { timeout: 5000 }).toContain('Open work switcher');
      return popup;
    } catch (e) {
      if (attempt >= 3) throw e;
    }
  }
}

/**
 * Content wider or taller than its own box (overflow: visible), e.g. a duration spilling out of a highlighted day.
 * Intentional clipping (overflow hidden/auto, text-overflow: ellipsis) and SVG internals are not counted.
 */
export async function spills(p: Page) {
  return p.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      if (el.closest('svg') || el.closest('[hidden]')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.display === 'contents' || cs.visibility === 'hidden' || cs.position === 'fixed') continue;
      if (!el.offsetWidth || !el.offsetHeight) continue;
      const name = `${el.tagName.toLowerCase()}.${String(el.className).trim().replace(/\s+/g, '.')} "${(el.textContent ?? '').trim().slice(0, 24)}"`;
      if (cs.overflowX === 'visible' && el.scrollWidth > el.clientWidth + 1) out.push(`${name} wider by ${el.scrollWidth - el.clientWidth}px`);
      // Height: boxes only. Plain text with tight leading (the big timer) reports taller glyphs than its line box.
      // An open dropdown list overlays what is below it by design; the list itself is still checked above.
      if (cs.overflowY === 'visible' && el.firstElementChild && !el.querySelector('[role="listbox"]') && el.scrollHeight > el.clientHeight + 1 && el.tagName !== 'HTML' && el.tagName !== 'BODY') out.push(`${name} taller by ${el.scrollHeight - el.clientHeight}px`);
    }
    return [...new Set(out)];
  });
}
