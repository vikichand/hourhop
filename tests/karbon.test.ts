import { describe, expect, it } from 'vitest';
import { budgetFromEstimates, KarbonClient, KarbonError, mapAssignedWork, odataString, validateCreds } from '../src/integrations/karbon';
import { connectKarbon, loadKarbonBudgets, refreshKarbon } from '../src/integrations/karbon-sync';
import { ledgers, T0 } from './helpers';

const CREDS = { appId: 'app-123', accessKey: 'eyJ.secret.key', email: 'pat@firm.example' };

type Route = (url: URL) => { status?: number; body?: unknown; headers?: Record<string, string> };

/** A fake api.karbonhq.com: records every request, answers from `route`. */
function fakeKarbon(route: Route) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = route(new URL(url));
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers });
  };
  return { calls, fetchImpl, sleep: async () => {} };
}

const WORK = [
  { WorkItemKey: 'W1', Title: 'VAT return Q3', ClientKey: 'C1', ClientName: 'Alder Ltd', ClientType: 'Organization', DueDate: '2026-11-30T00:00:00Z', PrimaryStatus: 'In Progress' },
  { WorkItemKey: 'W2', Title: 'Payroll', ClientKey: 'C2', ClientName: 'Ngozi Okafor', ClientType: 'Contact', PrimaryStatus: 'Ready To Start' },
  { WorkItemKey: 'W3', Title: 'Old job', ClientKey: 'C1', ClientName: 'Alder Ltd', ClientType: 'Organization', PrimaryStatus: 'Completed' },
  { WorkItemKey: 'W4', Title: 'Monthly bookkeeping', ClientKey: 'C1', ClientName: 'Alder Ltd', ClientType: 'Organization', PrimaryStatus: 'Planned' },
];

function standardRoutes(extra: Partial<Record<string, Route>> = {}): Route {
  return (u) => {
    const r = extra[u.pathname];
    if (r) return r(u);
    if (u.pathname === '/v3/TenantSettings') return { body: { TenantKey: 'TENANT-A' } };
    if (u.pathname === '/v3/Users') return { body: { value: [{ Id: 'U1', Name: 'Pat Doe', EmailAddress: 'Pat@Firm.example' }] } };
    if (u.pathname === '/v3/WorkItems') {
      // Like Karbon: a PrimaryStatus filter matches only the spaced form; anything else silently matches nothing.
      const st = /PrimaryStatus eq '([^']*)'/.exec(u.searchParams.get('$filter') ?? '')?.[1];
      return { body: { value: st === undefined ? WORK : WORK.filter((w) => w.PrimaryStatus === st) } };
    }
    if (u.pathname.startsWith('/v3/EstimateSummaries/')) return { body: { value: [
      { UserKey: 'U1', EstimateMinutes: 120, ActualMinutes: 60 }, { UserKey: 'U2', EstimateMinutes: 60, ActualMinutes: 30 }, { UserKey: 'U1', EstimateMinutes: 0, ActualMinutes: 15 },
    ] } };
    return { status: 404 };
  };
}

describe('Karbon client [read-only, official API v3]', () => {
  it('sends GET with both auth headers, no cookies, and an escaped, encoded OData filter per open status', async () => {
    const f = fakeKarbon(standardRoutes());
    const k = new KarbonClient({ ...CREDS, email: "o'neil@firm.example" }, f.fetchImpl, f.sleep);
    await k.assignedWork();
    const { url, init } = f.calls[0]!;
    expect(new URL(url).origin).toBe('https://api.karbonhq.com');
    // Completed work is never requested, so years of finished jobs cannot fill the page limit.
    expect(f.calls.map((c) => new URL(c.url).searchParams.get('$filter'))).toEqual(
      ['Planned', 'Ready To Start', 'In Progress', 'Waiting'].map((s) => `AssigneeEmailAddress eq 'o''neil@firm.example' and PrimaryStatus eq '${s}'`),
    );
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('omit');
    expect(init.headers).toEqual({ Authorization: 'Bearer app-123', AccessKey: 'eyJ.secret.key', Accept: 'application/json' });
    expect(odataString("a'b")).toBe("'a''b'");
  });

  it('follows same-origin pagination and refuses a nextLink to another host', async () => {
    const pages = fakeKarbon((u) => (u.searchParams.get('$skip') === '100'
      ? { body: { value: [WORK[1]] } }
      : { body: { value: [WORK[0]], '@odata.nextLink': 'https://api.karbonhq.com/v3/WorkItems?$skip=100' } }));
    expect(await new KarbonClient(CREDS, pages.fetchImpl, pages.sleep).assignedWork()).toHaveLength(2); // deduplicated across status requests
    const evil = fakeKarbon(() => ({ body: { value: [WORK[0]], '@odata.nextLink': 'https://attacker.example/steal' } }));
    await expect(new KarbonClient(CREDS, evil.fetchImpl, evil.sleep).assignedWork()).rejects.toMatchObject({ code: 'bad-response' });
    expect(evil.calls).toHaveLength(1);
  });

  it('retries 429 a bounded number of times, then reports rate limiting', async () => {
    let n = 0;
    const f = fakeKarbon(() => (++n < 3 ? { status: 429, headers: { 'Retry-After': '1' } } : { body: { TenantKey: 'T' } }));
    expect(await new KarbonClient(CREDS, f.fetchImpl, f.sleep).tenantKey()).toBe('T');
    const always = fakeKarbon(() => ({ status: 429 }));
    await expect(new KarbonClient(CREDS, always.fetchImpl, always.sleep).tenantKey()).rejects.toMatchObject({ code: 'rate-limited' });
    expect(always.calls).toHaveLength(4);
  });

  it('turns failures into specific messages that never contain the keys', async () => {
    for (const [status, code] of [[401, 'auth'], [403, 'forbidden'], [500, 'http']] as const) {
      const f = fakeKarbon(() => ({ status }));
      const err = await new KarbonClient(CREDS, f.fetchImpl, f.sleep).tenantKey().catch((e) => e);
      expect(err).toBeInstanceOf(KarbonError);
      expect(err.code).toBe(code);
      expect(err.message).not.toContain('app-123');
      expect(err.message).not.toContain('secret');
    }
    const down = new KarbonClient(CREDS, async () => { throw new TypeError('Failed to fetch'); });
    await expect(down.tenantKey()).rejects.toMatchObject({ code: 'network' });
    expect(() => validateCreds({ ...CREDS, email: 'nope' })).toThrow(/email/);
    expect(() => validateCreds({ ...CREDS, accessKey: ' ' })).toThrow(/both/);
  });
});

describe('mapping and budgets', () => {
  it('keeps open work only, with real Karbon statuses, client kinds and typed keys', () => {
    const { clients, work } = mapAssignedWork(WORK);
    expect(work.map((w) => [w.key, w.status])).toEqual([['W1', 'In Progress'], ['W2', 'Ready To Start'], ['W4', 'Planned']]);
    // Single-item endpoints use the no-space form; both forms map the same.
    expect(mapAssignedWork([{ ...WORK[0]!, PrimaryStatus: 'InProgress' }, { ...WORK[1]!, PrimaryStatus: 'ReadyToStart' }]).work.map((w) => w.status)).toEqual(['In Progress', 'Ready To Start']);
    expect(clients.map((c) => [c.key, c.kind])).toEqual([['C1', 'Organization'], ['C2', 'Contact']]);
    expect(work[0]).toMatchObject({ profileId: 'karbon', dueDate: '2026-11-30', budget: { kind: 'unavailable', reason: 'not-loaded' } });
  });

  it('skips items whose Karbon keys are not plain identifiers, since keys are used in request paths', () => {
    const { clients, work } = mapAssignedWork([
      { ...WORK[0]!, WorkItemKey: '..' },
      { ...WORK[0]!, WorkItemKey: 'W9', ClientKey: '../x' },
      { ...WORK[0]!, WorkItemKey: 'a/b' },
      WORK[1]!,
    ]);
    expect(work.map((w) => w.key)).toEqual(['W2']);
    expect(clients.map((c) => c.key)).toEqual(['C2']);
  });

  it('builds work total and your allocation from estimates; no estimates is "none", never zero; rates ignored', () => {
    const rows = [{ UserKey: 'U1', EstimateMinutes: 120, ActualMinutes: 60 }, { UserKey: 'U2', EstimateMinutes: 60, ActualMinutes: 30 }, { UserKey: 'U1', EstimateMinutes: 0, ActualMinutes: 15 }];
    expect(budgetFromEstimates(rows, 'U1', 'now')).toEqual({ kind: 'set', asOfUtc: 'now', lines: [
      { kind: 'time', scope: 'work-total', estimateMinutes: 180, recordedMinutes: 105 },
      { kind: 'time', scope: 'user-allocation', estimateMinutes: 120, recordedMinutes: 75 },
    ] });
    expect(budgetFromEstimates([{ UserKey: 'U1', EstimateMinutes: 0, ActualMinutes: 40 }], 'U1', 'now')).toEqual({ kind: 'none', asOfUtc: 'now' });
    expect(budgetFromEstimates([], 'U1', 'now').kind).toBe('none');
  });
});

describe('sync rules', () => {
  it('connect stores the connection, syncs open work and switches to Karbon mode; the UI status never holds keys', async () => {
    const { l } = await ledgers(1, 'local');
    const f = fakeKarbon(standardRoutes());
    const r = await connectKarbon(l, CREDS, { fetchImpl: f.fetchImpl, sleep: f.sleep, now: () => T0 });
    expect(r).toEqual({ workCount: 3, switched: true });
    expect((await l.getState()).profile).toBe('karbon');
    expect((await l.catalog('karbon')).work.map((w) => w.key)).toEqual(['W1', 'W2', 'W4']);
    const status = await l.karbonStatus();
    // Karbon's own spelling of the address is kept and used for the work filter from then on.
    expect(status).toMatchObject({ connected: true, email: 'Pat@Firm.example', userName: 'Pat Doe', workCount: 3 });
    expect(f.calls.filter((c) => c.url.includes('/v3/WorkItems')).every((c) => new URL(c.url).searchParams.get('$filter')!.startsWith("AssigneeEmailAddress eq 'Pat@Firm.example'"))).toBe(true);
    expect(JSON.stringify(status)).not.toMatch(/app-123|secret/);
    expect(f.calls.every((c) => c.init.method === 'GET')).toBe(true);
  });

  it('a failed refresh keeps the last good catalog and records a specific error', async () => {
    const { l, clock } = await ledgers(1, 'local');
    await connectKarbon(l, CREDS, { ...fakeKarbon(standardRoutes()), now: () => clock.now });
    clock.now += 20 * 60_000;
    const broken = fakeKarbon(standardRoutes({ '/v3/WorkItems': () => ({ status: 500 }) }));
    await expect(refreshKarbon(l, {}, { ...broken, now: () => clock.now })).rejects.toMatchObject({ code: 'http' });
    expect((await l.catalog('karbon')).work).toHaveLength(3);
    expect((await l.karbonStatus()).lastError).toMatch(/HTTP 500/);
  });

  it('refresh is skipped when fresh and single-flight across surfaces', async () => {
    const { list, clock } = await ledgers(2, 'local');
    const [a, b] = list;
    await connectKarbon(a!, CREDS, { ...fakeKarbon(standardRoutes()), now: () => clock.now });
    const f = fakeKarbon(standardRoutes());
    expect(await refreshKarbon(a!, {}, { ...f, now: () => clock.now })).toBe(false); // fresh
    clock.now += 20 * 60_000;
    const results = await Promise.all([refreshKarbon(a!, {}, { ...f, now: () => clock.now }), refreshKarbon(b!, {}, { ...f, now: () => clock.now })]);
    expect(results.sort()).toEqual([false, true]);
    expect(f.calls.filter((c) => c.url.includes('/v3/WorkItems'))).toHaveLength(4); // one sync: one request per open status
  });

  it('a refresh that finishes after disconnect does not bring the work list back', async () => {
    const { l, clock } = await ledgers(1, 'local');
    await connectKarbon(l, CREDS, { ...fakeKarbon(standardRoutes()), now: () => clock.now });
    clock.now += 20 * 60_000;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = fakeKarbon(standardRoutes());
    let inFlight!: () => void;
    const started = new Promise<void>((r) => (inFlight = r));
    const pending = refreshKarbon(l, {}, { fetchImpl: async (u, i) => { inFlight(); await gate; return slow.fetchImpl(u, i); }, sleep: slow.sleep, now: () => clock.now });
    await started; // the refresh has claimed the sync and is waiting on Karbon
    await l.disconnectKarbon();
    release();
    await pending.catch(() => undefined);
    expect((await l.catalog('karbon')).work).toHaveLength(0);
    expect((await l.karbonStatus()).connected).toBe(false);
  });

  it('refuses keys from a different firm while the previous firm\'s sessions exist', async () => {
    const { l } = await ledgers(1, 'local');
    await connectKarbon(l, CREDS, fakeKarbon(standardRoutes()));
    const [w] = (await l.catalog('karbon')).work;
    await l.command({ opId: 'o1', type: 'start', input: { id: 's1', target: { kind: 'work-item', tenantId: 'karbon', clientKind: 'Organization', clientId: w!.clientKey, workItemId: w!.key }, label: { client: 'A', work: 'B' }, timeZone: 'UTC' } });
    await l.command({ opId: 'o2', type: 'stop', sessionId: 's1' });
    const other = fakeKarbon(standardRoutes({ '/v3/TenantSettings': () => ({ body: { TenantKey: 'TENANT-B' } }) }));
    await expect(connectKarbon(l, CREDS, other)).rejects.toThrow(/different Karbon firm/);
  });

  it('loads budgets lazily, only for the requested items, and keeps them across refreshes', async () => {
    const { l, clock } = await ledgers(1, 'local');
    await connectKarbon(l, CREDS, { ...fakeKarbon(standardRoutes()), now: () => clock.now });
    const f = fakeKarbon(standardRoutes());
    await loadKarbonBudgets(l, ['W1'], { ...f, now: () => clock.now });
    expect(f.calls.map((c) => new URL(c.url).pathname)).toEqual(['/v3/EstimateSummaries/W1']);
    clock.now += 20 * 60_000;
    await refreshKarbon(l, {}, { ...fakeKarbon(standardRoutes()), now: () => clock.now });
    const w1 = (await l.catalog('karbon')).work.find((w) => w.key === 'W1')!;
    expect(w1.budget.kind).toBe('set');
  });
});
