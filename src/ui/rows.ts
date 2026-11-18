// Work-list row model and search (T-302). Identity is the typed target key, never a name, so
// recurring work with the same title stays distinct (KWS-007).

import { ACTIONABLE, targetKey, type Client, type Target, type WorkItem, type WorkStatus } from '../domain/types';

export interface Row {
  key: string;
  target: Target;
  client: Client;
  work?: WorkItem;
  title: string; // work title, or "Client time (no work item)"
  status?: WorkStatus;
  haystack: string;
}

export const CLIENT_ONLY_TITLE = 'Client time (no work item)';

export function buildRows(clients: Map<string, Client>, work: WorkItem[]): Row[] {
  const rows: Row[] = [];
  for (const w of work) {
    const c = clients.get(w.clientKey);
    if (!c) continue;
    const target: Target = { kind: 'work-item', tenantId: w.profileId, clientKind: c.kind, clientId: c.key, workItemId: w.key };
    rows.push({ key: targetKey(target), target, client: c, work: w, title: w.title, status: w.status, haystack: `${c.name} ${w.title}`.toLowerCase() });
  }
  for (const c of clients.values()) {
    const target: Target = { kind: 'client-only', tenantId: c.profileId, clientKind: c.kind, clientId: c.key };
    rows.push({ key: targetKey(target), target, client: c, title: CLIENT_ONLY_TITLE, haystack: `${c.name} client time`.toLowerCase() });
  }
  return rows.sort((a, b) =>
    a.client.name.localeCompare(b.client.name) || Number(!a.work) - Number(!b.work) || a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
}

export type StatusFilter = 'open' | 'actionable' | 'completed' | 'all';

export function matchesStatus(r: Row, f: StatusFilter): boolean {
  if (!r.status || f === 'all') return f !== 'completed' || r.status === 'Completed';
  if (f === 'open') return r.status !== 'Completed';
  if (f === 'actionable') return ACTIONABLE.includes(r.status);
  return r.status === 'Completed';
}

/** Every whitespace-separated term must appear in client name or work title (case-insensitive). */
export function search(rows: Row[], query: string): Row[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return rows;
  return rows.filter((r) => terms.every((t) => r.haystack.includes(t)));
}
