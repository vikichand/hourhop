// Runs inside Karbon's web app (page world) to observe how the app calls Karbon. It never changes a request or a
// reply: the original fetch/XHR runs exactly as before, and only a copy of the reply is read. Records are shapes
// only (see src/integrations/karbon-probe.ts) and go to HourHop's isolated relay script via postMessage.

import { defineContentScript } from 'wxt/utils/define-content-script';
import { authScheme, isJsonType, isKarbonApi, MAX_REPLY_CHARS, pathTemplate, PROBE_SOURCE, safeName, shape, type ProbeEntry } from '../integrations/karbon-probe';

export default defineContentScript({
  matches: ['https://app2.karbonhq.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    install();
  },
});

/** `reply` is either JSON text or an already-parsed object (XHR responseType "json"); oversized text is skipped. */
function report(method: string, url: string, status: number, headers: Record<string, string>, withCredentials: boolean, bodyText: string | undefined, reply: string | object | undefined, contentType: string) {
  try {
    const u = new URL(url, location.href);
    if (!isKarbonApi(u)) return;
    const json = isJsonType(contentType);
    let body: ProbeEntry['body'], replyShape: ProbeEntry['reply'];
    try { if (bodyText && bodyText.length <= MAX_REPLY_CHARS) body = shape(JSON.parse(bodyText)); } catch { /* not JSON */ }
    try {
      if (json && typeof reply === 'string' && reply.length <= MAX_REPLY_CHARS) replyShape = shape(JSON.parse(reply));
      else if (json && reply && typeof reply === 'object') replyShape = shape(reply);
    } catch { /* not JSON */ }
    if (!json && body === undefined) return;
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    const entry: ProbeEntry = {
      method: method.toUpperCase().slice(0, 10), origin: u.origin, path: pathTemplate(u.pathname),
      query: [...new Set([...u.searchParams.keys()].map(safeName))].slice(0, 20), status,
      auth: authScheme(lower.authorization), headers: [...new Set(Object.keys(lower).filter((h) => h !== 'cookie' && h !== 'authorization').map(safeName))].sort().slice(0, 30),
      withCredentials, body, reply: replyShape, count: 1, lastUtc: new Date().toISOString(),
    };
    window.postMessage({ source: PROBE_SOURCE, entry }, location.origin);
  } catch {
    // Observation must never affect Karbon.
  }
}

function install() {
  const original = window.fetch;
  window.fetch = async function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    const res = await original.call(this, input, init);
    try {
      const req = input instanceof Request ? input : undefined;
      const url = req ? req.url : input instanceof URL ? input.href : String(input);
      const headers = Object.fromEntries(new Headers(init?.headers ?? req?.headers).entries());
      const method = init?.method ?? req?.method ?? 'GET';
      const creds = (init?.credentials ?? req?.credentials) === 'include';
      const bodyText = typeof init?.body === 'string' ? init.body : undefined;
      const ct = res.headers.get('content-type') ?? '';
      const size = Number(res.headers.get('content-length') ?? 0);
      if (isJsonType(ct) && size <= MAX_REPLY_CHARS && isKarbonApi(new URL(url, location.href))) res.clone().text().then((t) => report(method, url, res.status, headers, creds, bodyText, t, ct), () => undefined);
      else report(method, url, res.status, headers, creds, bodyText, undefined, ct);
    } catch {
      // Observation must never affect Karbon.
    }
    return res;
  };

  const P = XMLHttpRequest.prototype as any;
  const meta = new WeakMap<XMLHttpRequest, { method: string; url: string; headers: Record<string, string> }>();
  const open = P.open, setHeader = P.setRequestHeader, send = P.send;
  P.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    meta.set(this, { method: String(method), url: String(url), headers: {} });
    return open.call(this, method, url, ...rest);
  };
  P.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
    const m = meta.get(this);
    if (m) m.headers[name] = value;
    return setHeader.call(this, name, value);
  };
  P.send = function (this: XMLHttpRequest, body?: unknown) {
    const m = meta.get(this);
    if (m) {
      this.addEventListener('loadend', () => {
        let reply: string | object | undefined;
        try {
          reply = this.responseType === '' || this.responseType === 'text' ? this.responseText : this.responseType === 'json' ? (this.response as object) : undefined;
        } catch { /* unreadable */ }
        report(m.method, m.url, this.status, m.headers, this.withCredentials, typeof body === 'string' ? body : undefined, reply, this.getResponseHeader('content-type') ?? '');
      }, { once: true });
    }
    return send.call(this, body);
  };
}
