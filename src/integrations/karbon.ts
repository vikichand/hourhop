// Read-only client for Karbon's official API v3 (https://github.com/karbonhq/karbon-api-reference).
// The ONLY module allowed to make network requests (enforced by tests/ui-guards.test.ts):
// GET only, to one fixed origin, with the firm's own keys. Keys never appear in errors or logs.
//
// Caveat (2026-11-19): written against Karbon's published OpenAPI spec; not yet verified against a live
// Karbon tenant. Karbon's API has no endpoint for creating time entries, so nothing here writes.

import { APP } from '../app-meta';
import type { BudgetInfo, BudgetLine, Client, ClientKind, WorkItem, WorkStatus } from '../domain/types';

export const KARBON_ORIGIN = 'https://api.karbonhq.com';
const MAX_PAGES = 20; // 100 items per page; 2,000 assigned work items is far beyond a normal workload
const MAX_RETRIES = 3;

export interface KarbonCreds {
  /** "Application ID" Karbon issues to the registered API application (sent as the Bearer token). */
  appId: string;
  /** The firm's AccessKey from Karbon Settings > Connected Apps > API Applications. */
  accessKey: string;
  /** The colleague's own Karbon login email: selects their assigned work. Identity, not access control. */
  email: string;
}

export type KarbonErrorCode = 'auth' | 'forbidden' | 'not-found' | 'email-not-found' | 'rate-limited' | 'network' | 'http' | 'bad-response' | 'invalid-input';

export class KarbonError extends Error {
  constructor(public code: KarbonErrorCode, message: string) {
    super(message);
  }
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** OData string literal: single quotes are doubled. The whole filter is URL-encoded by the caller. */
export function odataString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export function validateCreds(c: KarbonCreds): KarbonCreds {
  const out = { appId: c.appId.trim(), accessKey: c.accessKey.trim(), email: c.email.trim().toLowerCase() };
  if (!out.appId || !out.accessKey) throw new KarbonError('invalid-input', 'Enter both the Application ID and the AccessKey.');
  if (/\s/.test(out.appId) || /\s/.test(out.accessKey)) throw new KarbonError('invalid-input', 'The keys should not contain spaces. Paste them again exactly as Karbon shows them.');
  if (!EMAIL_RE.test(out.email)) throw new KarbonError('invalid-input', 'Enter the email address you sign in to Karbon with.');
  return out;
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export class KarbonClient {
  constructor(
    private creds: KarbonCreds,
    private fetchImpl: Fetch = (u, i) => fetch(u, i),
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** GET one resource. Follows only same-origin URLs; retries 429 a bounded number of times. */
  private async get<T>(pathOrUrl: string): Promise<T> {
    const url = new URL(pathOrUrl, KARBON_ORIGIN);
    if (url.origin !== KARBON_ORIGIN) throw new KarbonError('bad-response', `Karbon returned a link to another website, so ${APP.brand} stopped.`);
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url.href, {
          method: 'GET',
          headers: { Authorization: `Bearer ${this.creds.appId}`, AccessKey: this.creds.accessKey, Accept: 'application/json' },
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
        });
      } catch {
        throw new KarbonError('network', "Couldn't reach Karbon. Check your internet connection and try again.");
      }
      if (res.status === 429 && attempt < MAX_RETRIES) {
        const wait = Number(res.headers.get('Retry-After')) || 10;
        await this.sleep(Math.min(Math.max(wait, 1), 30) * 1000);
        continue;
      }
      if (res.status === 401) throw new KarbonError('auth', 'Karbon rejected the keys. Check the Application ID and AccessKey with your Karbon admin.');
      if (res.status === 403) throw new KarbonError('forbidden', "Karbon refused access. Your firm's Karbon admin may need to enable API access for this application.");
      if (res.status === 404) throw new KarbonError('not-found', 'Karbon could not find that record.');
      if (res.status === 429) throw new KarbonError('rate-limited', `Karbon is limiting requests right now. ${APP.brand} will try again later.`);
      if (!res.ok) throw new KarbonError('http', `Karbon returned an error (HTTP ${res.status}). Try again later.`);
      try {
        return (await res.json()) as T;
      } catch {
        throw new KarbonError('bad-response', `Karbon sent a response ${APP.brand} could not read.`);
      }
    }
  }

  /** Every page of an OData collection; fails as a whole rather than returning a partial list. */
  private async all<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = path;
    for (let i = 0; next && i < MAX_PAGES; i++) {
      const page: { value?: T[]; '@odata.nextLink'?: string } = await this.get(next);
      if (!Array.isArray(page.value)) throw new KarbonError('bad-response', `Karbon sent a response ${APP.brand} could not read.`);
      out.push(...page.value);
      next = page['@odata.nextLink'];
    }
    if (next) throw new KarbonError('bad-response', `Karbon returned more results than ${APP.brand} can load at once.`);
    return out;
  }

  async tenantKey(): Promise<string> {
    const t = await this.get<{ TenantKey?: string }>('/v3/TenantSettings');
    if (!t.TenantKey) throw new KarbonError('bad-response', 'Karbon did not say which firm these keys belong to.');
    return t.TenantKey;
  }

  async findUser(): Promise<{ key: string; name: string; email: string }> {
    const filter = encodeURIComponent(`EmailAddress eq ${odataString(this.creds.email)}`);
    const users = await this.all<{ Id: string; Name?: string; EmailAddress?: string }>(`/v3/Users?$filter=${filter}`);
    const me = users.find((u) => (u.EmailAddress ?? '').toLowerCase() === this.creds.email);
    if (!me) throw new KarbonError('email-not-found', `No Karbon user has the email ${this.creds.email}. Use the email you sign in to Karbon with.`);
    return { key: me.Id, name: me.Name ?? this.creds.email, email: this.creds.email };
  }

  async assignedWork(): Promise<KarbonWorkItem[]> {
    const filter = encodeURIComponent(`AssigneeEmailAddress eq ${odataString(this.creds.email)}`);
    return this.all<KarbonWorkItem>(`/v3/WorkItems?$filter=${filter}`);
  }

  async estimates(workItemKey: string): Promise<KarbonEstimate[]> {
    const page = await this.get<{ value?: KarbonEstimate[] }>(`/v3/EstimateSummaries/${encodeURIComponent(workItemKey)}`);
    return Array.isArray(page.value) ? page.value : [];
  }
}

// ---------- mapping Karbon DTOs to HourHop's domain ----------

export interface KarbonWorkItem {
  WorkItemKey: string;
  Title?: string;
  ClientKey?: string;
  ClientName?: string;
  ClientType?: string;
  DueDate?: string;
  PrimaryStatus?: string;
}

export interface KarbonEstimate {
  UserKey?: string;
  RoleName?: string;
  TaskTypeName?: string;
  EstimateMinutes?: number;
  ActualMinutes?: number;
}

const STATUS: Record<string, WorkStatus> = {
  Planned: 'Planned', ReadyToStart: 'Ready To Start', InProgress: 'In Progress', Waiting: 'Waiting', Completed: 'Completed',
};
const KINDS: ClientKind[] = ['Contact', 'Organization', 'ClientGroup'];
/** Karbon keys are short alphanumeric identifiers; anything else is refused because keys end up in URL paths. */
const KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Open (not completed) assigned work and its clients. Items without a key or client are skipped, not guessed. */
export function mapAssignedWork(items: KarbonWorkItem[]): { clients: Client[]; work: WorkItem[] } {
  const clients = new Map<string, Client>();
  const work: WorkItem[] = [];
  for (const w of items) {
    const status = STATUS[w.PrimaryStatus ?? ''];
    const key = w.WorkItemKey, clientKey = w.ClientKey;
    if (!key || !clientKey || !KEY_RE.test(key) || !KEY_RE.test(clientKey) || status === 'Completed') continue;
    const kind = KINDS.includes(w.ClientType as ClientKind) ? (w.ClientType as ClientKind) : 'Organization';
    if (!clients.has(clientKey)) clients.set(clientKey, { key: clientKey, profileId: 'karbon', kind, name: w.ClientName?.trim() || 'Unnamed client' });
    work.push({
      key,
      profileId: 'karbon',
      clientKey,
      title: w.Title?.trim() || 'Untitled work item',
      status: status ?? 'Planned',
      dueDate: w.DueDate ? w.DueDate.slice(0, 10) : undefined,
      budget: { kind: 'unavailable', reason: 'not-loaded' },
    });
  }
  return { clients: [...clients.values()], work };
}

/**
 * Time budget from Karbon estimate summaries. Rows with no estimate never become a budget; no estimate at all
 * is "none", not zero. Hourly rates and amounts are ignored on purpose (not every colleague may see rates).
 */
export function budgetFromEstimates(rows: KarbonEstimate[], userKey: string, asOfUtc: string): BudgetInfo {
  const est = (r: KarbonEstimate) => Math.max(0, r.EstimateMinutes ?? 0);
  const act = (r: KarbonEstimate) => Math.max(0, r.ActualMinutes ?? 0);
  const estimated = rows.filter((r) => est(r) > 0);
  if (!estimated.length) return { kind: 'none', asOfUtc };
  const lines: BudgetLine[] = [{
    kind: 'time', scope: 'work-total',
    estimateMinutes: estimated.reduce((t, r) => t + est(r), 0),
    recordedMinutes: rows.reduce((t, r) => t + act(r), 0),
  }];
  const mine = rows.filter((r) => r.UserKey === userKey);
  const mineEst = mine.reduce((t, r) => t + est(r), 0);
  if (mineEst > 0) lines.push({ kind: 'time', scope: 'user-allocation', estimateMinutes: mineEst, recordedMinutes: mine.reduce((t, r) => t + act(r), 0) });
  return { kind: 'set', asOfUtc, lines };
}
