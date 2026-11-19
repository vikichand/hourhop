// Connects, refreshes and loads budgets for the Karbon data mode. Only this module reads the stored keys.
// Rules: never replace good data with a partial result; one sync at a time across every open surface;
// budgets load lazily for the items on screen, so a firm's shared rate limit is not spent on every item.

import { APP } from '../app-meta';
import { DomainError } from '../domain/timer';
import type { Ledger } from '../storage/ledger';
import { budgetFromEstimates, KarbonClient, KarbonError, mapAssignedWork, validateCreds, type KarbonCreds } from './karbon';

export const REFRESH_AFTER_MS = 15 * 60_000;
const BUDGET_MAX_AGE_MS = 15 * 60_000;

type Fetch = ConstructorParameters<typeof KarbonClient>[1];

export interface SyncDeps { fetchImpl?: Fetch; now?: () => number; sleep?: (ms: number) => Promise<void> }

function client(creds: KarbonCreds, deps: SyncDeps) {
  return new KarbonClient(creds, deps.fetchImpl, deps.sleep);
}

/** Verifies the keys, finds the user, syncs their open work and switches to Karbon mode when possible. */
export async function connectKarbon(ledger: Ledger, input: KarbonCreds, deps: SyncDeps = {}): Promise<{ workCount: number; switched: boolean }> {
  const now = deps.now ?? Date.now;
  const creds = validateCreds(input);
  const k = client(creds, deps);
  const tenantKey = await k.tenantKey();
  const known = await ledger.karbonTenant();
  const status = await ledger.karbonStatus();
  if (known && known !== tenantKey && status.hasSessions) {
    throw new KarbonError('invalid-input', `These keys belong to a different Karbon firm. Export and delete the previous firm's ${APP.brand} data in Settings first.`);
  }
  const user = await k.findUser();
  const { clients, work } = mapAssignedWork(await client({ ...creds, email: user.email }, deps).assignedWork());
  const iso = new Date(now()).toISOString();
  // Catalog first, then the connection: if the catalog write fails nothing claims to be connected.
  await ledger.replaceCatalog('karbon', clients, work);
  await ledger.saveKarbonConn({
    key: 'karbon:conn', ...creds, email: user.email, tenantKey, userKey: user.key, userName: user.name,
    connectedUtc: iso, lastSyncUtc: iso, syncStartedUtc: null, lastError: null, workCount: work.length,
  });
  let switched = true;
  try {
    await ledger.setProfile('karbon');
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    switched = false; // a timer is running in another mode; the user can switch after stopping it
  }
  return { workCount: work.length, switched };
}

/**
 * Refreshes the assigned work if it is older than REFRESH_AFTER_MS (or `force`). Failures are recorded on the
 * connection and the last good catalog stays. Returns false when skipped (fresh, not connected, or locked).
 */
export async function refreshKarbon(ledger: Ledger, opts: { force?: boolean } = {}, deps: SyncDeps = {}): Promise<boolean> {
  const now = deps.now ?? Date.now;
  const conn = await ledger.karbonConn();
  if (!conn) return false;
  if (!opts.force && conn.lastSyncUtc && now() - Date.parse(conn.lastSyncUtc) < REFRESH_AFTER_MS) return false;
  if (!(await ledger.claimKarbonSync(now()))) return false;
  try {
    const { clients, work } = mapAssignedWork(await client(conn, deps).assignedWork());
    if (!(await ledger.replaceCatalog('karbon', clients, work, { requireKarbonConn: true }))) return false; // disconnected meanwhile
    await ledger.patchKarbonConn({ lastSyncUtc: new Date(now()).toISOString(), syncStartedUtc: null, lastError: null, workCount: work.length });
    return true;
  } catch (e) {
    await ledger.patchKarbonConn({ syncStartedUtc: null, lastError: e instanceof KarbonError ? e.message : 'Refreshing from Karbon failed.' });
    throw e;
  }
}

/** Loads budgets for the given work items when missing or stale, one request at a time. */
export async function loadKarbonBudgets(ledger: Ledger, workKeys: string[], deps: SyncDeps = {}): Promise<void> {
  const now = deps.now ?? Date.now;
  const conn = await ledger.karbonConn();
  if (!conn || !workKeys.length) return;
  const { work } = await ledger.catalog('karbon');
  const byKey = new Map(work.map((w) => [w.key, w]));
  const k = client(conn, deps);
  for (const key of [...new Set(workKeys)].slice(0, 12)) {
    const w = byKey.get(key);
    if (!w) continue;
    const b = w.budget;
    const fresh = b.kind !== 'unavailable' && now() - Date.parse(b.asOfUtc) < BUDGET_MAX_AGE_MS;
    if (fresh) continue;
    try {
      await ledger.setWorkBudget('karbon', key, budgetFromEstimates(await k.estimates(key), conn.userKey, new Date(now()).toISOString()));
    } catch (e) {
      if (e instanceof KarbonError && (e.code === 'auth' || e.code === 'forbidden' || e.code === 'rate-limited' || e.code === 'network')) throw e;
      await ledger.setWorkBudget('karbon', key, { kind: 'unavailable', reason: 'error' });
    }
  }
}

export async function disconnectKarbon(ledger: Ledger) {
  await ledger.disconnectKarbon();
  const st = await ledger.getState();
  if (st.profile === 'karbon') await ledger.setProfile('local');
}
