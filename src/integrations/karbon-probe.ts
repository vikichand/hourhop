// Karbon session check: learns how Karbon's own web app talks to Karbon, so HourHop can connect through the
// colleague's existing Karbon login (the owner chose this route on 2026-11-19, knowing Karbon's web-app API is
// private and may change). Karbon's logged-in app code is not public, so the request and reply formats can only be
// observed inside a real session.
//
// Records the SHAPE of traffic only: address patterns with IDs replaced, header names, the auth scheme word, and
// the field names and types of request and reply bodies. Never values, tokens, cookies, names or amounts.

export const PROBE_SOURCE = 'hourhop-karbon-probe';
export const PROBE_STORAGE_KEY = 'karbonProbe';
export const MAX_ENTRIES = 200;

export type Shape = string | Shape[] | { [k: string]: Shape };

export interface ProbeEntry {
  method: string;
  origin: string;
  path: string;
  query: string[];
  status: number;
  auth: string;
  headers: string[];
  withCredentials: boolean;
  body?: Shape;
  reply?: Shape;
  count: number;
  lastUtc: string;
}

/** Path segments that look like IDs, emails or long values become placeholders, so no record identifies anyone. */
export function pathTemplate(pathname: string): string {
  return pathname.split('/').map((s) => {
    if (!s) return s;
    let d = s;
    try { d = decodeURIComponent(s); } catch { /* keep raw */ }
    if (d.includes('@')) return '{email}';
    if (/^\d+$/.test(d)) return '{n}';
    if (/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(d)) return '{guid}';
    if (d.length > 40 || /\s/.test(d)) return '{value}';
    if (/^(?=.*\d)[A-Za-z0-9_-]{6,}$/.test(d)) return '{key}';
    return /^[A-Za-z][A-Za-z_-]*$/.test(d) ? d : '{value}';
  }).join('/');
}

const KEYLIKE = /^(?=.*\d)[A-Za-z0-9_-]{6,}$|^[0-9a-f-]{32,36}$|@/i;

/** Field names and types only. Object keys that look like IDs collapse to "{key}"; strings never keep their text. */
export function shape(v: unknown, depth = 0): Shape {
  if (v === null) return 'null';
  if (Array.isArray(v)) return depth >= 6 ? ['…'] : v.length ? [shape(v[0], depth + 1)] : [];
  if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(v) ? 'date-string' : 'string';
  if (typeof v !== 'object') return typeof v;
  if (depth >= 6) return '{…}';
  const out: Record<string, Shape> = {};
  let n = 0;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const key = KEYLIKE.test(k) ? '{key}' : k.slice(0, 60);
    if (key in out) continue;
    if (++n > 80) { out['…'] = 'more fields'; break; }
    out[key] = shape(val, depth + 1);
  }
  return out;
}

/** "Bearer", "Bearer (JWT)", "none": the scheme word only, never the credential. */
export function authScheme(headerValue: string | null | undefined): string {
  if (!headerValue) return 'none';
  const [scheme, token = ''] = headerValue.trim().split(/\s+/, 2);
  return `${scheme!.slice(0, 20)}${token.split('.').length === 3 ? ' (JWT)' : ''}`;
}

export function isKarbonHost(url: URL): boolean {
  return url.protocol === 'https:' && (url.hostname === 'karbonhq.com' || url.hostname.endsWith('.karbonhq.com'));
}

/** Only JSON API traffic is interesting; static files and analytics are skipped. */
export function isKarbonApi(url: URL): boolean {
  return isKarbonHost(url) && !url.pathname.startsWith('/_next/') && !/\.(js|css|png|svg|woff2?|ico|map)$/i.test(url.pathname);
}

export function entryKey(e: Pick<ProbeEntry, 'method' | 'origin' | 'path'>): string {
  return `${e.method} ${e.origin}${e.path}`;
}

/** Merges a new observation into the stored map, keeping the newest shapes and a bounded number of entries. */
export function mergeEntry(map: Record<string, ProbeEntry>, e: ProbeEntry): Record<string, ProbeEntry> {
  const k = entryKey(e);
  const prev = map[k];
  const next = { ...map, [k]: { ...e, body: e.body ?? prev?.body, reply: e.reply ?? prev?.reply, count: (prev?.count ?? 0) + 1 } };
  const keys = Object.keys(next);
  if (keys.length > MAX_ENTRIES) {
    keys.sort((a, b) => next[a]!.lastUtc.localeCompare(next[b]!.lastUtc));
    for (const old of keys.slice(0, keys.length - MAX_ENTRIES)) delete next[old];
  }
  return next;
}

/** A message from the page script is accepted only if it has exactly the expected, harmless shape. */
export function isProbeEntry(x: unknown): x is ProbeEntry {
  const e = x as ProbeEntry;
  let karbon = false;
  try { karbon = typeof e?.origin === 'string' && isKarbonHost(new URL(e.origin)); } catch { /* not a URL */ }
  return !!e && typeof e === 'object' && typeof e.method === 'string' && e.method.length <= 10 && karbon && typeof e.path === 'string' && e.path.length <= 300 && Array.isArray(e.query)
    && typeof e.status === 'number' && typeof e.auth === 'string' && Array.isArray(e.headers) && typeof e.lastUtc === 'string';
}
