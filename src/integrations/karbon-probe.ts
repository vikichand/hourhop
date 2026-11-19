// Karbon session check: learns how Karbon's own web app talks to Karbon, so HourHop can connect through the
// colleague's existing Karbon login (the owner chose this route on 2026-11-19, knowing Karbon's web-app API is
// private and may change). Karbon's logged-in app code is not public, so the request and reply formats can only be
// observed inside a real session.
//
// Records the SHAPE of traffic only, by allowlist: path words that look like API names, identifier-like field,
// query and header names, value types. Everything else becomes a placeholder. Never values, tokens, cookies, names
// or amounts. The relay re-sanitizes every record, because any script on Karbon's page can post messages.

export const PROBE_SOURCE = 'hourhop-karbon-probe';
export const PROBE_STORAGE_KEY = 'karbonProbe';
export const MAX_ENTRIES = 200;
/** Total stored report size; older entries are dropped beyond it. */
export const MAX_TOTAL_CHARS = 256_000;
const MAX_ENTRY_CHARS = 32_000;
/** Replies larger than this are not parsed in Karbon's page. */
export const MAX_REPLY_CHARS = 512_000;

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

const PLACEHOLDER = /^\{(key|n|guid|email|value|word)\}$/;
/**
 * API words: lowercase route names ("time", "stopwatches") and camelCase ("workItems"). Capitalised words and slugs
 * may be names, so they become placeholders. Residual risk: a lowercase name used as a path segment; Karbon's app
 * addresses records by key, so that is not expected.
 */
const isApiWord = (s: string) => /^[a-z]{2,30}$/.test(s) || /^v\d{1,2}$/.test(s) || /^[a-z]+(?:[A-Z][a-z0-9]*)+$/.test(s);
/** Field, query and header names: identifier-like, no spaces or punctuation that free text would have. */
const NAME_RE = /^[$A-Za-z][A-Za-z0-9_.-]{0,40}$/;
const SAFE_LEAVES = new Set(['string', 'number', 'boolean', 'null', 'date-string', 'undefined', 'object', '…', '{…}', 'more fields', '{map}']);

/** Path segments become placeholders unless they are API words, so no record identifies anyone. */
export function pathTemplate(pathname: string): string {
  return pathname.split('/').map((s) => {
    if (!s || PLACEHOLDER.test(s)) return s;
    let d = s;
    try { d = decodeURIComponent(s); } catch { /* keep raw */ }
    if (d.includes('@')) return '{email}';
    if (/^\d+$/.test(d)) return '{n}';
    if (/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(d)) return '{guid}';
    if (/^(?=.*\d)[A-Za-z0-9_-]{6,}$/.test(d) && !isApiWord(d)) return '{key}';
    if (isApiWord(d)) return d;
    return /^[A-Za-z]+$/.test(d) && d.length <= 40 ? '{word}' : '{value}';
  }).join('/');
}

export const safeName = (k: string) => (NAME_RE.test(k) && !/^(?=.*\d)[A-Za-z0-9_-]{6,}$/.test(k) || /^\$[a-z]+$/.test(k) ? k : '{key}');

/**
 * Field names and types only. An object whose keys are not all identifier-like, or that has many keys, is a map
 * keyed by data (IDs, names) and is shown as {map} with the shape of one value.
 */
export function shape(v: unknown, depth = 0): Shape {
  if (v === null) return 'null';
  if (Array.isArray(v)) return depth >= 6 ? ['…'] : v.length ? [shape(v[0], depth + 1)] : [];
  if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(v) ? 'date-string' : 'string';
  if (typeof v !== 'object') return typeof v === 'number' || typeof v === 'boolean' ? typeof v : 'undefined';
  if (depth >= 6) return '{…}';
  const entries = Object.entries(v as Record<string, unknown>);
  const isMap = entries.length > 40 || entries.some(([k]) => safeName(k) === '{key}');
  if (isMap) return entries.length ? { '{map}': shape(entries[0]![1], depth + 1) } : {};
  const out: Record<string, Shape> = Object.create(null);
  for (const [k, val] of entries) out[k] = shape(val, depth + 1);
  return { ...out };
}

/** Re-checks a shape received from the page: only safe names and type words survive, with bounded depth and size. */
export function sanitizeShape(s: unknown, depth = 0): Shape | undefined {
  if (typeof s === 'string') return SAFE_LEAVES.has(s) ? s : undefined;
  if (depth >= 7) return undefined;
  if (Array.isArray(s)) return s.length ? [sanitizeShape(s[0], depth + 1) ?? 'undefined'] : [];
  if (!s || typeof s !== 'object') return undefined;
  const out: Record<string, Shape> = Object.create(null);
  let n = 0;
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
    if (++n > 80) break;
    const key = k === '{map}' ? k : safeName(k);
    if (key === '{key}') return { '{map}': sanitizeShape(v, depth + 1) ?? 'undefined' };
    out[key] = sanitizeShape(v, depth + 1) ?? 'undefined';
  }
  return { ...out };
}

/** "Bearer", "Bearer (JWT)", "other", "none": a known scheme word only, never any part of the credential. */
export function authScheme(headerValue: string | null | undefined): string {
  if (!headerValue) return 'none';
  const [scheme = '', token = ''] = headerValue.trim().split(/\s+/, 2);
  const known = ['Bearer', 'Basic', 'Token', 'Digest', 'Negotiate'].find((w) => w.toLowerCase() === scheme.toLowerCase());
  return known ? `${known}${token.split('.').length === 3 ? ' (JWT)' : ''}` : 'other';
}

export function isKarbonHost(url: URL): boolean {
  return url.protocol === 'https:' && (url.hostname === 'karbonhq.com' || url.hostname.endsWith('.karbonhq.com'));
}

/** Only JSON API traffic is interesting; static files and analytics are skipped. */
export function isKarbonApi(url: URL): boolean {
  return isKarbonHost(url) && !url.pathname.startsWith('/_next/') && !/\.(js|css|png|svg|woff2?|ico|map)$/i.test(url.pathname);
}

/** Plain JSON only: streaming types (ndjson, event streams) would never finish reading. */
export function isJsonType(contentType: string): boolean {
  return /^application\/(?:[\w.+-]+\+)?json\b/i.test(contentType.trim()) && !/ndjson|stream/i.test(contentType);
}

export function entryKey(e: Pick<ProbeEntry, 'method' | 'origin' | 'path'>): string {
  return `${e.method} ${e.origin}${e.path}`;
}

/**
 * Builds a fresh record from an untrusted message: allowlisted fields only, every string re-templated or checked,
 * the relay's own timestamp. Returns null for anything that is not a well-formed Karbon record.
 */
export function sanitizeEntry(x: unknown, nowIso: string): ProbeEntry | null {
  const e = x as Record<string, unknown> | null;
  if (!e || typeof e !== 'object') return null;
  let origin: URL;
  try { origin = new URL(String(e.origin)); } catch { return null; }
  if (!isKarbonHost(origin) || origin.origin !== e.origin) return null;
  const method = String(e.method ?? '').toUpperCase();
  if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(method) || typeof e.path !== 'string' || e.path.length > 300) return null;
  const names = (v: unknown) => (Array.isArray(v) ? [...new Set(v.slice(0, 30).map((k) => safeName(String(k))))] : []);
  const status = typeof e.status === 'number' && Number.isInteger(e.status) && e.status >= 0 && e.status < 1000 ? e.status : 0;
  const auth = ['none', 'other', 'Bearer', 'Basic', 'Token', 'Digest', 'Negotiate'].flatMap((w) => [w, `${w} (JWT)`]).includes(String(e.auth)) ? String(e.auth) : 'other';
  const out: ProbeEntry = {
    method, origin: origin.origin, path: pathTemplate(e.path), query: names(e.query), status, auth, headers: names(e.headers),
    withCredentials: e.withCredentials === true, body: sanitizeShape(e.body), reply: sanitizeShape(e.reply), count: 1, lastUtc: nowIso,
  };
  if (JSON.stringify(out).length > MAX_ENTRY_CHARS) { out.body = undefined; out.reply = '{…}'; }
  return out;
}

/** Merges a new observation, keeping the newest shapes and bounded entry count and total size. */
export function mergeEntry(map: Record<string, ProbeEntry>, e: ProbeEntry): Record<string, ProbeEntry> {
  const k = entryKey(e);
  const prev = map[k];
  const next = { ...map, [k]: { ...e, body: e.body ?? prev?.body, reply: e.reply ?? prev?.reply, count: (prev?.count ?? 0) + 1 } };
  const keys = Object.keys(next).sort((a, b) => next[a]!.lastUtc.localeCompare(next[b]!.lastUtc));
  let size = JSON.stringify(next).length;
  while (keys.length && (keys.length > MAX_ENTRIES || size > MAX_TOTAL_CHARS)) {
    const old = keys.shift()!;
    size -= JSON.stringify(next[old]).length;
    delete next[old];
  }
  return next;
}
