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
  const ctx = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    headless: process.env.HEADED ? false : true,
    // A random loopback DevTools port lets tests reach the real toolbar popup, which Playwright does not
    // expose as a Page. Chrome writes the chosen port to DevToolsActivePort in the throwaway profile.
    args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`, '--remote-debugging-port=0'],
  });
  debugPort = Number(readFileSync(path.join(profileDir, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
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
  const send = (method: string, params: object = {}) => new Promise<any>((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async <T>(expression: string): Promise<T> => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result?.result?.value as T;
  };
  /** Real trusted mouse click (a user gesture) at the centre of the first element matching `selector`. */
  const click = async (selector: string) => {
    const rect = await evaluate<{ x: number; y: number }>(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
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

export function rowAction(p: Page, client: string, work: string) {
  return p.locator(`[data-row-action][aria-label$="${client}, ${work}"]`);
}
