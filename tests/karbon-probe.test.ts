import { describe, expect, it } from 'vitest';
import { authScheme, isKarbonApi, isProbeEntry, MAX_ENTRIES, mergeEntry, pathTemplate, shape, type ProbeEntry } from '../src/integrations/karbon-probe';

const entry = (over: Partial<ProbeEntry> = {}): ProbeEntry => ({
  method: 'GET', origin: 'https://us3.karbonhq.com', path: '/time/api/{key}/stopwatches/{key}', query: [], status: 200,
  auth: 'Bearer (JWT)', headers: ['accept'], withCredentials: false, count: 1, lastUtc: '2026-11-19T10:00:00Z', ...over,
});

describe('Karbon session check records shapes, never values', () => {
  it('turns IDs, emails and free text in paths into placeholders, keeping route words', () => {
    expect(pathTemplate('/time/api/4mXk9TzQ2/stopwatches/8Hq2Lp0Za')).toBe('/time/api/{key}/stopwatches/{key}');
    expect(pathTemplate('/work/api/T1x2y3z4/workItems/12345')).toBe('/work/api/{key}/workItems/{n}');
    expect(pathTemplate('/u/pat%40firm.example/3f2b8c1e-1d2a-4b5c-9d8e-0f1a2b3c4d5e')).toBe('/u/{email}/{guid}');
    expect(pathTemplate('/search/Alder%20and%20Finch')).toBe('/search/{value}');
  });

  it('keeps field names and types; strings, numbers and ID-like keys never keep their content', () => {
    const reply = { value: [{ WorkItemKey: 'Wk9x7Abc', Title: 'VAT return Q3', Minutes: 95, Billable: true, DueDate: '2026-11-30T00:00:00Z', Note: null }], byId: { Ab12cd34: { x: 1 } }, 'pat@firm.example': 1 };
    expect(shape(reply)).toEqual({
      value: [{ WorkItemKey: 'string', Title: 'string', Minutes: 'number', Billable: 'boolean', DueDate: 'date-string', Note: 'null' }],
      byId: { '{key}': { x: 'number' } }, '{key}': 'number',
    });
    expect(JSON.stringify(shape(reply))).not.toMatch(/VAT|Wk9x7Abc|pat@firm|95|Ab12cd34/);
  });

  it('records only the auth scheme word, never the credential', () => {
    expect(authScheme('Bearer eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl')).toBe('Bearer (JWT)');
    expect(authScheme('Bearer opaque-token-123')).toBe('Bearer');
    expect(authScheme(undefined)).toBe('none');
  });

  it('only Karbon API traffic is recorded; static files and other sites are not', () => {
    expect(isKarbonApi(new URL('https://us3.karbonhq.com/time/api/T/stopwatches/U'))).toBe(true);
    expect(isKarbonApi(new URL('https://app2.karbonhq.com/_next/static/chunks/a.js'))).toBe(false);
    expect(isKarbonApi(new URL('https://karbonhq.com.evil.example/x'))).toBe(false);
    expect(isKarbonApi(new URL('https://karbonhqsusw.dataplane.rudderstack.com/v1'))).toBe(false);
  });

  it('the relay accepts only well-formed Karbon records and keeps a bounded, merged list', () => {
    expect(isProbeEntry(entry())).toBe(true);
    expect(isProbeEntry({ ...entry(), origin: 'https://evil.example' })).toBe(false);
    expect(isProbeEntry({ ...entry(), origin: 'not a url' })).toBe(false);
    expect(isProbeEntry({ ...entry(), method: 'X'.repeat(50) })).toBe(false);
    expect(isProbeEntry(null)).toBe(false);

    let m = mergeEntry({}, entry({ reply: { a: 'string' } }));
    m = mergeEntry(m, entry({ lastUtc: '2026-11-19T11:00:00Z' }));
    expect(Object.values(m)).toHaveLength(1);
    expect(Object.values(m)[0]).toMatchObject({ count: 2, reply: { a: 'string' } }); // a later reply-less sighting keeps the shape
    for (let i = 0; i < MAX_ENTRIES + 20; i++) m = mergeEntry(m, entry({ path: `/p${i}`, lastUtc: new Date(Date.UTC(2026, 10, 19, 12, 0, i)).toISOString() }));
    expect(Object.keys(m)).toHaveLength(MAX_ENTRIES);
  });
});
