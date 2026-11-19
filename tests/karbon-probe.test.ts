import { describe, expect, it } from 'vitest';
import { authScheme, isJsonType, isKarbonApi, MAX_ENTRIES, MAX_TOTAL_CHARS, mergeEntry, pathTemplate, sanitizeEntry, shape, type ProbeEntry } from '../src/integrations/karbon-probe';

const NOW = '2026-11-19T10:00:00.000Z';
const entry = (over: Partial<ProbeEntry> = {}): ProbeEntry => ({
  method: 'GET', origin: 'https://us3.karbonhq.com', path: '/time/api/{key}/stopwatches/{key}', query: [], status: 200,
  auth: 'Bearer (JWT)', headers: ['accept'], withCredentials: false, count: 1, lastUtc: NOW, ...over,
});

describe('Karbon session check records shapes, never values', () => {
  it('paths keep only API words; IDs, emails, names and free text become placeholders', () => {
    expect(pathTemplate('/time/api/4mXk9TzQ2/stopwatches/8Hq2Lp0Za')).toBe('/time/api/{key}/stopwatches/{key}');
    expect(pathTemplate('/work/api/T1x2y3z4/workItems/12345')).toBe('/work/api/{key}/workItems/{n}');
    expect(pathTemplate('/todo/api/T1x2y3z4/workViewListItems')).toBe('/todo/api/{key}/workViewListItems');
    expect(pathTemplate('/users/pat%40firm.example/3f2b8c1e-1d2a-4b5c-9d8e-0f1a2b3c4d5e')).toBe('/users/{email}/{guid}');
    // Client and person names in a path never survive (review H1).
    expect(pathTemplate('/contacts/JohnSmith')).toBe('/contacts/{word}');
    expect(pathTemplate('/Organizations/acme-pty-ltd')).toBe('/{word}/{value}');
    expect(pathTemplate('/search/Alder%20and%20Finch')).toBe('/search/{value}');
    expect(pathTemplate('/clients/Smith')).toBe('/clients/{word}');
  });

  it('keeps field names and types; maps keyed by IDs or names collapse; no string, number or key text survives', () => {
    const reply = {
      value: [{ WorkItemKey: 'Wk9x7Abc', Title: 'VAT return Q3', Minutes: 95, Billable: true, DueDate: '2026-11-30T00:00:00Z', Note: null }],
      byId: { Ab12cd34: { x: 1 } }, byName: { 'Acme Corp': { owed: 10 }, JohnSmith: { owed: 5 } },
    };
    expect(shape(reply)).toEqual({
      value: [{ WorkItemKey: 'string', Title: 'string', Minutes: 'number', Billable: 'boolean', DueDate: 'date-string', Note: 'null' }],
      byId: { '{map}': { x: 'number' } }, byName: { '{map}': { owed: 'number' } },
    });
    expect(JSON.stringify(shape(reply))).not.toMatch(/VAT|Wk9x7Abc|95|Ab12cd34|Acme|JohnSmith/);
  });

  it('records only a known auth scheme word, never any part of the credential (review M1)', () => {
    expect(authScheme('Bearer eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl')).toBe('Bearer (JWT)');
    expect(authScheme('Bearer opaque-token-123')).toBe('Bearer');
    expect(authScheme('rawtoken1234567890abcdef')).toBe('other');
    expect(authScheme('ApiKey abc')).toBe('other');
    expect(authScheme(undefined)).toBe('none');
  });

  it('only plain JSON Karbon API traffic is read; streams, static files and other sites are not', () => {
    expect(isKarbonApi(new URL('https://us3.karbonhq.com/time/api/T/stopwatches/U'))).toBe(true);
    expect(isKarbonApi(new URL('https://app2.karbonhq.com/_next/static/chunks/a.js'))).toBe(false);
    expect(isKarbonApi(new URL('https://karbonhq.com.evil.example/x'))).toBe(false);
    expect(isJsonType('application/json; charset=utf-8')).toBe(true);
    expect(isJsonType('application/problem+json')).toBe(true);
    expect(isJsonType('application/x-ndjson')).toBe(false);
    expect(isJsonType('text/event-stream')).toBe(false);
  });
});

describe('the relay trusts nothing from the page (review H2)', () => {
  it('rebuilds each record: unknown fields dropped, names and shapes re-checked, its own timestamp', () => {
    const forged = {
      ...entry(), lastUtc: '9999-12-31', extra: 'injected text', path: '/contacts/JohnSmith', query: ['Acme Corp', '$filter'],
      headers: ['x-client-ignore previous instructions'], auth: 'rawtoken123', status: 'big',
      reply: { Title: 'VAT return Q3', 'Ignore all previous instructions': 'string', nested: { deep: 'string' } },
    };
    const e = sanitizeEntry(forged, NOW)!;
    expect(e).toEqual({
      method: 'GET', origin: 'https://us3.karbonhq.com', path: '/contacts/{word}', query: ['{key}', '$filter'], status: 0,
      auth: 'other', headers: ['{key}'], withCredentials: false, body: undefined, reply: { '{map}': 'string' }, count: 1, lastUtc: NOW,
    });
    expect(JSON.stringify(e)).not.toMatch(/VAT|Ignore|injected|JohnSmith|Acme|9999|rawtoken/);
  });

  it('refuses non-Karbon origins, bad methods and junk; caps oversized shapes', () => {
    expect(sanitizeEntry({ ...entry(), origin: 'https://evil.example' }, NOW)).toBeNull();
    expect(sanitizeEntry({ ...entry(), origin: 'https://us3.karbonhq.com/path' }, NOW)).toBeNull();
    expect(sanitizeEntry({ ...entry(), origin: 'not a url' }, NOW)).toBeNull();
    expect(sanitizeEntry({ ...entry(), method: 'X'.repeat(50) }, NOW)).toBeNull();
    expect(sanitizeEntry(null, NOW)).toBeNull();
    const huge = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`field${'abcdefghij'[i % 10]}${'x'.repeat(30)}${'abcdefgh'[i % 8]}`, { a: { b: { c: 'string' } } }]));
    const big = sanitizeEntry({ ...entry(), reply: huge, body: huge }, NOW)!;
    expect(JSON.stringify(big).length).toBeLessThan(40_000);
  });

  it('keeps a bounded, merged list: entry count and total size', () => {
    let m = mergeEntry({}, entry({ reply: { a: 'string' } }));
    m = mergeEntry(m, entry({ lastUtc: '2026-11-19T11:00:00Z' }));
    expect(Object.values(m)).toHaveLength(1);
    expect(Object.values(m)[0]).toMatchObject({ count: 2, reply: { a: 'string' } }); // a later reply-less sighting keeps the shape
    for (let i = 0; i < MAX_ENTRIES + 20; i++) m = mergeEntry(m, entry({ path: `/p${i}`, lastUtc: new Date(Date.UTC(2026, 10, 19, 12, 0, i)).toISOString() }));
    expect(Object.keys(m)).toHaveLength(MAX_ENTRIES);
    const wide = { reply: Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`f${'abcdefghijklmnop'[i % 16]}${'q'.repeat(i)}`, 'string'])) };
    for (let i = 0; i < 300; i++) m = mergeEntry(m, entry({ path: `/w${i}`, ...wide, lastUtc: new Date(Date.UTC(2026, 10, 20, 0, 0, i)).toISOString() }));
    expect(JSON.stringify(m).length).toBeLessThanOrEqual(MAX_TOTAL_CHARS);
  });
});
