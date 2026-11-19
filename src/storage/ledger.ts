// Durable transactional ledger (ARCHITECTURE §3). Every surface (popup, side panel, review, settings)
// writes through here. Each timer command is ONE readwrite IndexedDB transaction over the global active
// pointer, the sessions and the operation journal, so concurrent commands from two windows serialize in
// IndexedDB itself; no in-memory mutex or long-lived service worker is involved.

import type { ConnectionReport } from '../integrations/karbon-mcp';
import { assertDiscardable, editTimes, splitAt, type SegmentEdit } from '../domain/edit';
import { DomainError, pause, resume, start, stop, type NewSessionInput, type Transition } from '../domain/timer';
import type { Client, LocalSession, ProfileId, WorkItem } from '../domain/types';

export const DB_NAME = 'hourhop';
export const DB_VERSION = 1;
const CHANNEL = 'hourhop-ledger';

export type Theme = 'system' | 'dark' | 'light';
export interface GlobalState {
  key: 'global';
  /** At most one running/paused session across ALL profiles. */
  activeSessionId: string | null;
  revision: number;
  profile: ProfileId | null; // null until onboarding picks a mode
  theme: Theme;
}
// Dark is the default theme (owner decision, 2026-11-19); System and Light are opt-in in Settings.
const INITIAL: GlobalState = { key: 'global', activeSessionId: null, revision: 0, profile: null, theme: 'dark' };

export interface AuditRecord {
  id?: number;
  sessionId: string;
  atUtc: string;
  action: 'edit-times' | 'split' | 'discard' | 'accept-review';
  reason: string;
  before: LocalSession;
  after: LocalSession[];
}

/** Stored Karbon connection. Holds the firm's keys: read only by src/integrations/karbon-sync.ts. */
export interface KarbonConn {
  key: 'karbon:conn';
  appId: string;
  accessKey: string;
  email: string;
  tenantKey: string;
  userKey: string;
  userName: string;
  connectedUtc: string;
  lastSyncUtc: string | null;
  /** Single-flight marker shared by every open surface, so only one sync hits Karbon's rate limit at a time. */
  syncStartedUtc: string | null;
  lastError: string | null;
  workCount: number;
}

/** What the UI may see about the connection. Never includes the keys. */
export interface KarbonStatus {
  connected: boolean;
  email?: string;
  userName?: string;
  lastSyncUtc?: string | null;
  lastError?: string | null;
  workCount?: number;
  /** Sessions recorded in Karbon mode exist, even if currently disconnected. */
  hasSessions: boolean;
  /** "Sign in with Karbon" (beta): the latest connection report, if any. No tokens are kept. */
  signIn?: { toolCount: number; reportUtc: string };
}

/** The last "Sign in with Karbon" connection report (tool list only: no token, no firm data). */
export interface KarbonSignIn { key: 'karbon:signin'; report: ConnectionReport }

const SYNC_LOCK_MS = 2 * 60_000;

export type Command =
  | { opId: string; type: 'start'; input: NewSessionInput }
  | { opId: string; type: 'pause'; sessionId: string }
  | { opId: string; type: 'resume'; sessionId: string }
  | { opId: string; type: 'stop'; sessionId: string };

export interface CommandResult { activeSessionId: string | null; currentId: string | null; revision: number; replayed?: boolean }

export class StorageError extends Error {
  code = 'STORAGE_FAILURE' as const;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function upgrade(db: IDBDatabase, oldVersion: number) {
  // Versioned, additive upgrades only. A future version adds `if (oldVersion < 2) {...}` and never drops data.
  if (oldVersion < 1) {
    db.createObjectStore('state', { keyPath: 'key' });
    const s = db.createObjectStore('sessions', { keyPath: 'id' });
    s.createIndex('byProfileDate', ['profileId', 'dateLocal']);
    s.createIndex('byProfileStart', ['profileId', 'startedAtUtc']);
    s.createIndex('byTarget', 'targetKey');
    db.createObjectStore('clients', { keyPath: ['profileId', 'key'] }).createIndex('byProfile', 'profileId');
    db.createObjectStore('work', { keyPath: ['profileId', 'key'] }).createIndex('byProfile', 'profileId');
    db.createObjectStore('operations', { keyPath: 'opId' });
    db.createObjectStore('audit', { keyPath: 'id', autoIncrement: true }).createIndex('bySession', 'sessionId');
  }
}

export function openDb(factory: IDBFactory = indexedDB, name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = factory.open(name, DB_VERSION);
    r.onupgradeneeded = (e) => upgrade(r.result, e.oldVersion);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(new StorageError(`Could not open local storage: ${r.error?.message ?? 'unknown error'}`));
    r.onblocked = () => rej(new StorageError('Local storage upgrade is blocked by another open window of this extension.'));
  });
}

type Store = 'state' | 'sessions' | 'clients' | 'work' | 'operations' | 'audit';

export class Ledger {
  private channel: BroadcastChannel | null = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);

  constructor(private db: IDBDatabase, private now: () => number = Date.now) {}

  /** Runs `fn` inside one transaction and resolves only after the transaction has durably committed. */
  private async tx<T>(stores: Store[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T>): Promise<T> {
    let t: IDBTransaction;
    try {
      t = this.db.transaction(stores, mode, { durability: 'strict' });
    } catch (e) {
      throw new StorageError(`Could not start a storage transaction: ${(e as Error).message}`);
    }
    const done = new Promise<void>((res, rej) => {
      t.oncomplete = () => res();
      t.onabort = () => rej(t.error ?? new Error('Transaction aborted'));
    });
    let out: T;
    try {
      out = await fn(t);
    } catch (e) {
      try { t.abort(); } catch { /* already finished */ }
      await done.catch(() => undefined);
      if (e instanceof DomainError) throw e;
      throw new StorageError(`Not saved: ${(e as Error)?.message ?? e}`);
    }
    try {
      await done;
    } catch (e) {
      // Quota exceeded, disk failure, etc. The change did not happen; callers must not report success.
      throw new StorageError(`Not saved: ${(e as Error)?.message ?? e}`);
    }
    if (mode === 'readwrite') this.channel?.postMessage({ type: 'changed' });
    return out;
  }

  onChange(cb: () => void): () => void {
    const ch = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
    if (ch) ch.onmessage = () => cb();
    return () => ch?.close();
  }

  close() {
    this.channel?.close();
    this.db.close();
  }

  private async readState(t: IDBTransaction): Promise<GlobalState> {
    return ((await req(t.objectStore('state').get('global'))) as GlobalState | undefined) ?? { ...INITIAL };
  }

  getState(): Promise<GlobalState> {
    return this.tx(['state'], 'readonly', (t) => this.readState(t));
  }

  // ---------- timer commands ----------

  async command(cmd: Command): Promise<CommandResult> {
    // One timestamp per command, taken at reception, before any storage work.
    const nowMs = this.now();
    return this.tx(['state', 'sessions', 'operations'], 'readwrite', async (t) => {
      const ops = t.objectStore('operations');
      const prior = (await req(ops.get(cmd.opId))) as { result: CommandResult } | undefined;
      if (prior) return { ...prior.result, replayed: true };

      const state = await this.readState(t);
      const sessions = t.objectStore('sessions');
      const active = state.activeSessionId ? ((await req(sessions.get(state.activeSessionId))) as LocalSession | undefined) ?? null : null;

      let tr: Transition;
      switch (cmd.type) {
        case 'start':
          if (cmd.input.target.tenantId !== state.profile) throw new DomainError('INVALID_TARGET', 'That work item belongs to a different data mode.');
          tr = start(active, cmd.input, nowMs);
          break;
        case 'pause': tr = pause(active, cmd.sessionId, nowMs); break;
        case 'resume': tr = resume(active, nowMs, cmd.sessionId); break;
        case 'stop': tr = stop(active, cmd.sessionId, nowMs); break;
      }
      for (const s of tr.writes) sessions.put(s);
      const revision = state.revision + (tr.noop ? 0 : 1);
      t.objectStore('state').put({ ...state, activeSessionId: tr.activeSessionId, revision });
      const result: CommandResult = { activeSessionId: tr.activeSessionId, currentId: tr.current?.id ?? null, revision };
      ops.put({ opId: cmd.opId, atUtc: new Date(nowMs).toISOString(), result });
      // ponytail: the operation journal is never pruned; ~100 bytes per command. Prune by age if it ever matters.
      return result;
    });
  }

  // ---------- preferences / mode ----------

  async setTheme(theme: Theme) {
    await this.tx(['state'], 'readwrite', async (t) => {
      const s = await this.readState(t);
      t.objectStore('state').put({ ...s, theme, revision: s.revision + 1 });
    });
  }

  /** Switching data mode is refused while a timer is active so two namespaces can never both run one. */
  async setProfile(profile: ProfileId | null) {
    await this.tx(['state'], 'readwrite', async (t) => {
      const s = await this.readState(t);
      if (s.activeSessionId && s.profile !== profile) throw new DomainError('CONFLICT', 'Stop the running timer before switching data mode.');
      t.objectStore('state').put({ ...s, profile, revision: s.revision + 1 });
    });
  }

  // ---------- catalog ----------

  async seedCatalog(clients: Client[], work: WorkItem[]) {
    await this.tx(['clients', 'work', 'state'], 'readwrite', async (t) => {
      for (const c of clients) t.objectStore('clients').put(c);
      for (const w of work) t.objectStore('work').put(w);
      const s = await this.readState(t);
      t.objectStore('state').put({ ...s, revision: s.revision + 1 });
    });
  }

  async catalog(profile: ProfileId): Promise<{ clients: Client[]; work: WorkItem[] }> {
    return this.tx(['clients', 'work'], 'readonly', async (t) => ({
      clients: (await req(t.objectStore('clients').index('byProfile').getAll(profile))) as Client[],
      work: (await req(t.objectStore('work').index('byProfile').getAll(profile))) as WorkItem[],
    }));
  }

  async favorites(profile: ProfileId): Promise<string[]> {
    return this.tx(['state'], 'readonly', async (t) => ((await req(t.objectStore('state').get(`fav:${profile}`))) as { keys: string[] } | undefined)?.keys ?? []);
  }

  async toggleFavorite(profile: ProfileId, key: string) {
    await this.tx(['state'], 'readwrite', async (t) => {
      const st = t.objectStore('state');
      const keys: string[] = ((await req(st.get(`fav:${profile}`))) as { keys: string[] } | undefined)?.keys ?? [];
      const next = keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key];
      st.put({ key: `fav:${profile}`, keys: next });
      const s = await this.readState(t);
      st.put({ ...s, revision: s.revision + 1 });
    });
  }

  // ---------- Karbon connection and synced catalog ----------

  async karbonConn(): Promise<KarbonConn | undefined> {
    return this.tx(['state'], 'readonly', async (t) => (await req(t.objectStore('state').get('karbon:conn'))) as KarbonConn | undefined);
  }

  async karbonStatus(): Promise<KarbonStatus> {
    return this.tx(['state', 'sessions'], 'readonly', async (t) => {
      const c = (await req(t.objectStore('state').get('karbon:conn'))) as KarbonConn | undefined;
      const si = (await req(t.objectStore('state').get('karbon:signin'))) as KarbonSignIn | undefined;
      const n = await req(t.objectStore('sessions').index('byProfileStart').count(IDBKeyRange.bound(['karbon', ''], ['karbon', '\uffff'])));
      const signIn = Array.isArray(si?.report?.tools) ? { toolCount: si.report.tools.length, reportUtc: si.report.generatedUtc } : undefined;
      return c
        ? { connected: true, email: c.email, userName: c.userName, lastSyncUtc: c.lastSyncUtc, lastError: c.lastError, workCount: c.workCount, hasSessions: n > 0, signIn }
        : { connected: false, hasSessions: n > 0, signIn };
    });
  }

  async karbonSignIn(): Promise<KarbonSignIn | undefined> {
    return this.tx(['state'], 'readonly', async (t) => (await req(t.objectStore('state').get('karbon:signin'))) as KarbonSignIn | undefined);
  }

  async saveKarbonSignIn(v: KarbonSignIn) {
    await this.tx(['state'], 'readwrite', async (t) => {
      t.objectStore('state').put(v);
      const s = await this.readState(t);
      t.objectStore('state').put({ ...s, revision: s.revision + 1 });
    });
  }

  /** The firm (Karbon tenant) whose data is held locally; survives disconnect so another firm can't mix in. */
  async karbonTenant(): Promise<string | undefined> {
    return this.tx(['state'], 'readonly', async (t) => ((await req(t.objectStore('state').get('karbon:tenant'))) as { tenantKey: string } | undefined)?.tenantKey);
  }

  async saveKarbonConn(conn: KarbonConn) {
    await this.tx(['state'], 'readwrite', async (t) => {
      const st = t.objectStore('state');
      st.put(conn);
      st.put({ key: 'karbon:tenant', tenantKey: conn.tenantKey });
      const s = await this.readState(t);
      st.put({ ...s, revision: s.revision + 1 });
    });
  }

  async patchKarbonConn(patch: Partial<Pick<KarbonConn, 'lastSyncUtc' | 'syncStartedUtc' | 'lastError' | 'workCount'>>) {
    await this.tx(['state'], 'readwrite', async (t) => {
      const st = t.objectStore('state');
      const c = (await req(st.get('karbon:conn'))) as KarbonConn | undefined;
      if (!c) return;
      st.put({ ...c, ...patch });
      const s = await this.readState(t);
      st.put({ ...s, revision: s.revision + 1 });
    });
  }

  /** Atomically claims the sync slot unless another surface started one within the lock window. */
  async claimKarbonSync(nowMs: number): Promise<boolean> {
    return this.tx(['state'], 'readwrite', async (t) => {
      const st = t.objectStore('state');
      const c = (await req(st.get('karbon:conn'))) as KarbonConn | undefined;
      if (!c) return false;
      if (c.syncStartedUtc && nowMs - Date.parse(c.syncStartedUtc) < SYNC_LOCK_MS) return false;
      st.put({ ...c, syncStartedUtc: new Date(nowMs).toISOString() });
      return true;
    });
  }

  /** Removes the keys. Local sessions stay; the synced catalog is cleared. Refused while a Karbon timer runs. */
  async disconnectKarbon() {
    await this.tx(['state', 'clients', 'work', 'sessions'], 'readwrite', async (t) => {
      const s = await this.readState(t);
      if (s.activeSessionId) {
        const a = (await req(t.objectStore('sessions').get(s.activeSessionId))) as LocalSession | undefined;
        if (a?.profileId === 'karbon') throw new DomainError('CONFLICT', 'Stop the running Karbon timer before disconnecting.');
      }
      t.objectStore('state').delete('karbon:conn');
      await this.clearCatalog(t, 'karbon');
      t.objectStore('state').put({ ...s, revision: s.revision + 1 });
    });
  }

  private async clearCatalog(t: IDBTransaction, profile: ProfileId) {
    for (const name of ['clients', 'work'] as const) {
      const keys = await req(t.objectStore(name).index('byProfile').getAllKeys(profile));
      for (const k of keys) t.objectStore(name).delete(k);
    }
  }

  /** Replaces a profile's whole catalog in one transaction; budgets already loaded for kept items are preserved. */
  async replaceCatalog(profile: ProfileId, clients: Client[], work: WorkItem[], opts: { requireKarbonConn?: boolean } = {}): Promise<boolean> {
    return this.tx(['clients', 'work', 'state'], 'readwrite', async (t) => {
      // A refresh that outlives a disconnect must not bring the firm's work list back.
      if (opts.requireKarbonConn && !(await req(t.objectStore('state').get('karbon:conn')))) return false;
      const old = (await req(t.objectStore('work').index('byProfile').getAll(profile))) as WorkItem[];
      const budgets = new Map(old.map((w) => [w.key, w.budget]));
      await this.clearCatalog(t, profile);
      for (const c of clients) t.objectStore('clients').put(c);
      for (const w of work) t.objectStore('work').put({ ...w, budget: w.budget.kind === 'unavailable' && w.budget.reason === 'not-loaded' ? budgets.get(w.key) ?? w.budget : w.budget });
      const s = await this.readState(t);
      t.objectStore('state').put({ ...s, revision: s.revision + 1 });
      return true;
    });
  }

  async setWorkBudget(profile: ProfileId, key: string, budget: WorkItem['budget']) {
    await this.tx(['work', 'state'], 'readwrite', async (t) => {
      const w = (await req(t.objectStore('work').get([profile, key]))) as WorkItem | undefined;
      if (!w) return;
      t.objectStore('work').put({ ...w, budget });
      const s = await this.readState(t);
      t.objectStore('state').put({ ...s, revision: s.revision + 1 });
    });
  }

  // ---------- reads ----------

  async session(id: string): Promise<LocalSession | undefined> {
    return this.tx(['sessions'], 'readonly', async (t) => (await req(t.objectStore('sessions').get(id))) as LocalSession | undefined);
  }

  async active(): Promise<{ state: GlobalState; active: LocalSession | null }> {
    return this.tx(['state', 'sessions'], 'readonly', async (t) => {
      const state = await this.readState(t);
      const active = state.activeSessionId ? ((await req(t.objectStore('sessions').get(state.activeSessionId))) as LocalSession) ?? null : null;
      return { state, active };
    });
  }

  async sessionsByDate(profile: ProfileId, fromDate: string, toDate: string): Promise<LocalSession[]> {
    return this.tx(['sessions'], 'readonly', async (t) =>
      (await req(t.objectStore('sessions').index('byProfileDate').getAll(IDBKeyRange.bound([profile, fromDate], [profile, toDate])))) as LocalSession[]);
  }

  async sessionsForTarget(key: string): Promise<LocalSession[]> {
    return this.tx(['sessions'], 'readonly', async (t) => (await req(t.objectStore('sessions').index('byTarget').getAll(key))) as LocalSession[]);
  }

  async allSessions(profile: ProfileId): Promise<LocalSession[]> {
    return this.tx(['sessions'], 'readonly', async (t) =>
      (await req(t.objectStore('sessions').index('byProfileStart').getAll(IDBKeyRange.bound([profile, ''], [profile, '￿'])))) as LocalSession[]);
  }

  /** Most recently used distinct target keys, newest first. Stops early, so cost does not grow with history. */
  async recentTargets(profile: ProfileId, limit = 30): Promise<string[]> {
    return this.tx(['sessions'], 'readonly', (t) => new Promise<string[]>((res, rej) => {
      const keys: string[] = [];
      const r = t.objectStore('sessions').index('byProfileStart').openCursor(IDBKeyRange.bound([profile, ''], [profile, '￿']), 'prev');
      r.onerror = () => rej(r.error);
      r.onsuccess = () => {
        const c = r.result;
        if (!c || keys.length >= limit) return res(keys);
        const k = (c.value as LocalSession).targetKey;
        if (!keys.includes(k)) keys.push(k);
        c.continue();
      };
    }));
  }

  async audit(sessionId: string): Promise<AuditRecord[]> {
    return this.tx(['audit'], 'readonly', async (t) => (await req(t.objectStore('audit').index('bySession').getAll(sessionId))) as AuditRecord[]);
  }

  // ---------- session details and audited corrections ----------

  /** Notes and metadata are user text, not time; they may be edited on any unconfirmed session, including the active one. */
  async updateDetails(id: string, patch: Partial<Pick<LocalSession, 'userNote' | 'roleName' | 'taskTypeName' | 'billableIntent' | 'enteredInKarbonAtUtc'>>) {
    await this.tx(['sessions', 'state'], 'readwrite', async (t) => {
      const s = (await req(t.objectStore('sessions').get(id))) as LocalSession | undefined;
      if (!s) throw new DomainError('CONFLICT', 'That session no longer exists.');
      if (s.submissionStatus === 'confirmed') throw new DomainError('CONFIRMED_LOCKED', 'Confirmed entries cannot be changed locally.');
      t.objectStore('sessions').put({ ...s, ...patch, lastEditedAtUtc: new Date(this.now()).toISOString(), version: s.version + 1 });
      const st = await this.readState(t);
      t.objectStore('state').put({ ...st, revision: st.revision + 1 });
    });
  }

  private async withOthers(t: IDBTransaction, profile: ProfileId): Promise<LocalSession[]> {
    const all = (await req(t.objectStore('sessions').index('byProfileStart').getAll(IDBKeyRange.bound([profile, ''], [profile, '￿'])))) as LocalSession[];
    // The open segment of a running session counts as occupied time up to now.
    const nowIso = new Date(this.now()).toISOString();
    return all.map((s) => s.status === 'running' && s.runningSinceUtc
      ? { ...s, segments: [...s.segments, { startedAtUtc: s.runningSinceUtc, endedAtUtc: nowIso, elapsedMs: 0 }] }
      : s);
  }

  private requireReason(reason: string) {
    if (!reason.trim()) throw new DomainError('INVALID_EDIT', 'Enter a reason for this correction.');
  }

  async editTimes(id: string, edits: SegmentEdit[], reason: string) {
    this.requireReason(reason);
    const nowIso = new Date(this.now()).toISOString();
    await this.tx(['sessions', 'audit', 'state'], 'readwrite', async (t) => {
      const s = (await req(t.objectStore('sessions').get(id))) as LocalSession | undefined;
      if (!s) throw new DomainError('CONFLICT', 'That session no longer exists.');
      const next = editTimes(s, edits, await this.withOthers(t, s.profileId), nowIso);
      t.objectStore('sessions').put(next);
      t.objectStore('audit').add({ sessionId: id, atUtc: nowIso, action: 'edit-times', reason: reason.trim(), before: s, after: [next] } satisfies AuditRecord);
      const st = await this.readState(t);
      t.objectStore('state').put({ ...st, revision: st.revision + 1 });
    });
  }

  async split(id: string, atMs: number, newId: string, reason: string) {
    this.requireReason(reason);
    const nowIso = new Date(this.now()).toISOString();
    await this.tx(['sessions', 'audit', 'state'], 'readwrite', async (t) => {
      const s = (await req(t.objectStore('sessions').get(id))) as LocalSession | undefined;
      if (!s) throw new DomainError('CONFLICT', 'That session no longer exists.');
      const [a, b] = splitAt(s, atMs, newId, nowIso);
      t.objectStore('sessions').put(a);
      t.objectStore('sessions').put(b);
      const rec: AuditRecord = { sessionId: id, atUtc: nowIso, action: 'split', reason: reason.trim(), before: s, after: [a, b] };
      t.objectStore('audit').add(rec);
      t.objectStore('audit').add({ ...rec, sessionId: newId });
      const st = await this.readState(t);
      t.objectStore('state').put({ ...st, revision: st.revision + 1 });
    });
  }

  /** Keeps a flagged interval exactly as recorded (the "keep" choice for sleep or clock flags). */
  async acceptReview(id: string, reason: string) {
    this.requireReason(reason);
    const nowIso = new Date(this.now()).toISOString();
    await this.tx(['sessions', 'audit', 'state'], 'readwrite', async (t) => {
      const s = (await req(t.objectStore('sessions').get(id))) as LocalSession | undefined;
      if (!s) throw new DomainError('CONFLICT', 'That session no longer exists.');
      if (s.status !== 'needs-review') return;
      const next: LocalSession = { ...s, status: 'stopped', reviewReasons: undefined, lastEditedAtUtc: nowIso, version: s.version + 1 };
      t.objectStore('sessions').put(next);
      t.objectStore('audit').add({ sessionId: id, atUtc: nowIso, action: 'accept-review', reason: reason.trim(), before: s, after: [next] } satisfies AuditRecord);
      const st = await this.readState(t);
      t.objectStore('state').put({ ...st, revision: st.revision + 1 });
    });
  }

  /** Removes a local session; the full prior record stays in the audit log. */
  async discard(id: string, reason: string) {
    this.requireReason(reason);
    const nowIso = new Date(this.now()).toISOString();
    await this.tx(['sessions', 'audit', 'state'], 'readwrite', async (t) => {
      const s = (await req(t.objectStore('sessions').get(id))) as LocalSession | undefined;
      if (!s) return;
      assertDiscardable(s);
      t.objectStore('sessions').delete(id);
      t.objectStore('audit').add({ sessionId: id, atUtc: nowIso, action: 'discard', reason: reason.trim(), before: s, after: [] } satisfies AuditRecord);
      const st = await this.readState(t);
      t.objectStore('state').put({ ...st, revision: st.revision + 1 });
    });
  }

  /** Deletes every HourHop record in this browser profile. Unrelated Chrome and Karbon data are untouched. */
  async deleteAll() {
    await this.tx(['state', 'sessions', 'clients', 'work', 'operations', 'audit'], 'readwrite', async (t) => {
      const st = await this.readState(t);
      for (const n of ['state', 'sessions', 'clients', 'work', 'operations', 'audit'] as const) t.objectStore(n).clear();
      t.objectStore('state').put({ ...INITIAL, theme: st.theme, revision: st.revision + 1 });
    });
  }
}

export async function openLedger(factory?: IDBFactory, now?: () => number, name?: string): Promise<Ledger> {
  return new Ledger(await openDb(factory, name), now);
}
