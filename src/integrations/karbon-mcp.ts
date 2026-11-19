// "Sign in with Karbon": each colleague signs in on Karbon's own login page; no API keys, no email, no admin step.
// It uses Karbon's official MCP server (https://mcp.karbonhq.com/mcp) and the OAuth 2.1 flow it advertises at
// /.well-known/oauth-protected-resource/mcp: dynamic client registration, PKCE (S256), read-only scope.
//
// Verified 2026-11-19 against Karbon's live identity server: self-registered public clients are accepted with a
// loopback redirect whose path is exactly /callback (other paths register but fail at login; chromiumapp.org is
// refused, so chrome.identity.launchWebAuthFlow cannot be used), and `mcp:public:read` reaches Karbon's login page.
// Karbon does not publish its MCP tool list, so this build only lists the tools (a "connection report"); it calls no
// data tool, requests no write scope and keeps no token. Security rests on PKCE plus the state check: any local
// process could see the code at the loopback port, but cannot redeem it without this page's verifier.

import { browser } from 'wxt/browser';
import { APP } from '../app-meta';

export const IDENTITY = 'https://identity.karbonhq.com';
export const MCP_URL = 'https://mcp.karbonhq.com/mcp';
/** Loopback redirect Karbon accepts for native clients. Nothing listens there: the opener reads the URL and closes the window. */
export const REDIRECT_URI = 'http://127.0.0.1:53682/callback';
export const SCOPE = 'mcp:public:read';
const PROTOCOL_VERSION = '2025-06-18';
const MAX_TOOLS = 200;
const MAX_SCHEMA_CHARS = 20_000;

export class KarbonSignInError extends Error {
  constructor(public code: 'cancelled' | 'refused' | 'network' | 'bad-response' | 'state-mismatch' | 'scope', message: string) {
    super(message);
  }
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
const defaultFetch: Fetch = (u, i) => fetch(u, i);
const unreadable = () => new KarbonSignInError('bad-response', `Karbon sent a response ${APP.brand} could not read.`);

async function post(fetchImpl: Fetch, url: string, init: { headers: Record<string, string>; body: string }): Promise<Response> {
  try {
    return await fetchImpl(url, { method: 'POST', ...init, credentials: 'omit', cache: 'no-store', redirect: 'error' });
  } catch {
    throw new KarbonSignInError('network', "Couldn't reach Karbon. Check your internet connection and try again.");
  }
}

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new KarbonSignInError('refused', `Karbon refused ${what} (HTTP ${res.status}).`);
  try {
    const v = await res.json();
    if (!v || typeof v !== 'object') throw unreadable();
    return v as T;
  } catch {
    throw unreadable();
  }
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

/** Registers a public OAuth client for this sign-in (what every MCP client does when it connects). */
export async function registerClient(fetchImpl: Fetch = defaultFetch): Promise<string> {
  const res = await post(fetchImpl, `${IDENTITY}/mcp/oauth/register`, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_name: APP.brand, redirect_uris: [REDIRECT_URI], grant_types: ['authorization_code'],
      response_types: ['code'], token_endpoint_auth_method: 'none',
    }),
  });
  const r = await json<{ client_id?: unknown }>(res, 'the sign-in registration');
  if (typeof r.client_id !== 'string' || !r.client_id) throw new KarbonSignInError('bad-response', 'Karbon did not return a client ID.');
  return r.client_id;
}

export function authorizeUrl(clientId: string, challenge: string, state: string): string {
  const q = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: REDIRECT_URI, scope: SCOPE, state,
    code_challenge: challenge, code_challenge_method: 'S256', resource: MCP_URL,
  });
  return `${IDENTITY}/connect/authorize?${q}`;
}

/** True only for the exact loopback redirect carrying this request's state; anything else is ignored. */
export function isOurRedirect(url: string, state: string): boolean {
  try {
    const u = new URL(url);
    return u.origin + u.pathname === REDIRECT_URI && u.searchParams.get('state') === state;
  } catch {
    return false;
  }
}

/** Reads the authorization code from the loopback redirect; refuses a mismatched state (CSRF) or an error reply. */
export function codeFromRedirect(url: string, state: string): string {
  const u = new URL(url);
  if (u.searchParams.get('state') !== state) throw new KarbonSignInError('state-mismatch', 'The sign-in reply did not match this request, so it was ignored. Try again.');
  if (u.searchParams.get('error')) throw new KarbonSignInError(u.searchParams.get('error') === 'access_denied' ? 'cancelled' : 'refused', 'Karbon did not complete the sign-in. Try again.');
  const code = u.searchParams.get('code');
  if (!code) throw new KarbonSignInError('bad-response', 'Karbon did not return a sign-in code.');
  return code;
}

export async function exchangeCode(clientId: string, code: string, verifier: string, fetchImpl: Fetch = defaultFetch) {
  const res = await post(fetchImpl, `${IDENTITY}/connect/token`, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, client_id: clientId, code_verifier: verifier, resource: MCP_URL }).toString(),
  });
  const t = await json<{ access_token?: unknown; scope?: unknown }>(res, 'the sign-in');
  if (typeof t.access_token !== 'string' || !t.access_token) throw new KarbonSignInError('bad-response', 'Karbon did not return an access token.');
  const scope = typeof t.scope === 'string' ? t.scope : 'unknown';
  // Read-only is a promise to the user: a token that can write is refused, not used.
  if (/write/i.test(scope)) throw new KarbonSignInError('scope', `Karbon granted more access than ${APP.brand} asked for, so ${APP.brand} did not use it.`);
  return { accessToken: t.access_token, scope };
}

type RpcMethod = 'initialize' | 'notifications/initialized' | 'tools/list';

/** One JSON-RPC exchange over MCP Streamable HTTP; the reply may be plain JSON or a server-sent event stream. */
async function rpc(fetchImpl: Fetch, token: string, session: string | undefined, method: RpcMethod, params: object, id?: number) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`, 'MCP-Protocol-Version': PROTOCOL_VERSION,
  };
  if (session) headers['Mcp-Session-Id'] = session;
  const res = await post(fetchImpl, MCP_URL, { headers, body: JSON.stringify({ jsonrpc: '2.0', method, params, ...(id === undefined ? {} : { id }) }) });
  if (id === undefined) return { session, result: {} as Record<string, unknown> }; // notifications get no reply
  if (!res.ok) throw new KarbonSignInError('refused', `Karbon's MCP server refused ${method} (HTTP ${res.status}).`);
  const text = await res.text();
  const candidates = (res.headers.get('Content-Type') ?? '').includes('text/event-stream')
    ? text.split(/\r?\n\r?\n/).map((ev) => ev.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n')).filter(Boolean)
    : [text];
  for (const c of candidates) {
    let m: unknown;
    try { m = JSON.parse(c); } catch { continue; }
    if (!m || typeof m !== 'object' || (m as { id?: unknown }).id !== id) continue;
    const msg = m as { result?: unknown; error?: unknown };
    if (msg.error || !msg.result || typeof msg.result !== 'object') throw new KarbonSignInError('refused', `Karbon's MCP server returned an error for ${method}.`);
    return { session: res.headers.get('Mcp-Session-Id') ?? session, result: msg.result as Record<string, unknown> };
  }
  throw unreadable();
}

export type ConnectionReport = {
  generatedUtc: string;
  app: string;
  grantedScope: string;
  server: { name?: string; version?: string };
  protocolVersion: string;
  tools: { name: string; title?: string; description?: string; inputSchema?: unknown; readOnly?: boolean }[];
};

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);

/** Tool names, descriptions and input schemas only: describes what Karbon offers, never the firm's data. */
export async function connectionReport(token: string, grantedScope: string, now: string, fetchImpl: Fetch = defaultFetch): Promise<ConnectionReport> {
  const init = await rpc(fetchImpl, token, undefined, 'initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: APP.brand, version: APP.version } }, 1);
  await rpc(fetchImpl, token, init.session, 'notifications/initialized', {});
  const tools: ConnectionReport['tools'] = [];
  let cursor: string | undefined;
  for (let page = 0, id = 2; page < 10 && tools.length < MAX_TOOLS; page++, id++) {
    const r = await rpc(fetchImpl, token, init.session, 'tools/list', cursor ? { cursor } : {}, id);
    if (!Array.isArray(r.result.tools)) throw unreadable();
    for (const t of r.result.tools as Record<string, unknown>[]) {
      const name = str(t?.name, 120);
      if (!name || tools.length >= MAX_TOOLS) continue;
      const schema = t.inputSchema && JSON.stringify(t.inputSchema).length <= MAX_SCHEMA_CHARS ? t.inputSchema : undefined;
      const ann = t.annotations as { readOnlyHint?: unknown } | undefined;
      tools.push({ name, title: str(t.title, 200), description: str(t.description, 1000), inputSchema: schema, readOnly: typeof ann?.readOnlyHint === 'boolean' ? ann.readOnlyHint : undefined });
    }
    cursor = str(r.result.nextCursor, 500);
    if (!cursor) break;
  }
  const ir = init.result ?? {};
  const si = (ir.serverInfo ?? {}) as Record<string, unknown>;
  return {
    generatedUtc: now, app: `${APP.brand} ${APP.version}`, grantedScope,
    server: { name: str(si.name, 120), version: str(si.version, 60) }, protocolVersion: str(ir.protocolVersion, 40) ?? 'unknown', tools,
  };
}

/**
 * Opens Karbon's login in a small window and resolves with the loopback redirect URL. Without a background worker
 * the calling page watches the window's tab; host access to the loopback URL lets it read that one URL. Redirects
 * with another path or state are ignored, so a stray navigation cannot cancel or hijack the sign-in.
 */
export function captureRedirect(url: string, timeoutMs = 10 * 60_000): Promise<string> {
  const state = new URL(url).searchParams.get('state') ?? '';
  return new Promise((resolve, reject) => {
    let tabId: number | undefined, windowId: number | undefined, finished = false;
    const done = (fn: () => void) => {
      if (finished) return;
      finished = true;
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.windows.onRemoved.removeListener(onRemoved);
      clearTimeout(timer);
      if (windowId !== undefined) browser.windows.remove(windowId).catch(() => undefined);
      fn();
    };
    const onUpdated = (id: number, info: { url?: string }) => {
      if (id === tabId && info.url && isOurRedirect(info.url, state)) { const u = info.url; done(() => resolve(u)); }
    };
    const onRemoved = (id: number) => {
      if (id === windowId) { windowId = undefined; done(() => reject(new KarbonSignInError('cancelled', 'Sign-in window closed before signing in.'))); }
    };
    const timer = setTimeout(() => done(() => reject(new KarbonSignInError('cancelled', 'Sign-in timed out. Try again.'))), timeoutMs);
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.windows.onRemoved.addListener(onRemoved);
    // Open empty, learn the tab, then navigate: an already-signed-in user is redirected back at once, and that
    // redirect must not arrive before tabId is known.
    browser.windows.create({ url: 'about:blank', type: 'popup', width: 520, height: 720 })
      .then((w) => {
        windowId = w?.id; tabId = w?.tabs?.[0]?.id;
        if (finished) { if (windowId !== undefined) browser.windows.remove(windowId).catch(() => undefined); return; }
        if (tabId === undefined) throw new KarbonSignInError('bad-response', 'Chrome did not open the sign-in window.');
        return browser.tabs.update(tabId, { url });
      })
      .catch((e) => done(() => reject(e)));
  });
}

/** The whole sign-in: register, log in on Karbon's page, exchange the code, then build the connection report. */
export async function signInWithKarbon(opts: { now: () => string; fetchImpl?: Fetch; capture?: (url: string) => Promise<string> }) {
  const fetchImpl = opts.fetchImpl ?? defaultFetch;
  // A fresh client per sign-in: a stored one Karbon has since forgotten would strand the user on an error page.
  const clientId = await registerClient(fetchImpl);
  const { verifier, challenge } = await pkce();
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const redirected = await (opts.capture ?? captureRedirect)(authorizeUrl(clientId, challenge, state));
  const code = codeFromRedirect(redirected, state);
  const { accessToken, scope } = await exchangeCode(clientId, code, verifier, fetchImpl);
  // ponytail: the token is used once for the report and not stored; storing it comes with the work-list sync.
  return connectionReport(accessToken, scope, opts.now(), fetchImpl);
}
