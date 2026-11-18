// Domain model (PRD §3). Pure data, no chrome.* or storage dependencies.

export type ClientKind = 'Contact' | 'Organization' | 'ClientGroup';
export type WorkStatus = 'Planned' | 'Ready To Start' | 'In Progress' | 'Waiting' | 'Completed';
export const WORK_STATUSES: WorkStatus[] = ['Ready To Start', 'In Progress', 'Waiting', 'Planned', 'Completed'];
export const ACTIONABLE: WorkStatus[] = ['Ready To Start', 'In Progress'];

/** Data namespace. `sample` is synthetic demo data, `local` is the user's own manual catalog. */
export type ProfileId = 'sample' | 'local';

export type Target =
  | { kind: 'work-item'; tenantId: ProfileId; clientKind: ClientKind; clientId: string; workItemId: string }
  | { kind: 'client-only'; tenantId: ProfileId; clientKind: ClientKind; clientId: string };

export function targetKey(t: Target): string {
  return t.kind === 'work-item'
    ? `w:${t.tenantId}:${t.clientKind}:${t.clientId}:${t.workItemId}`
    : `c:${t.tenantId}:${t.clientKind}:${t.clientId}`;
}

export interface Client {
  key: string; // unique within profile, typed by kind
  profileId: ProfileId;
  kind: ClientKind;
  name: string;
}

export type BudgetScope = 'work-total' | 'user-allocation';
export type BudgetLine =
  | { kind: 'time'; scope: BudgetScope; estimateMinutes: number; recordedMinutes: number }
  | { kind: 'amount'; scope: BudgetScope; estimateAmount: number; currency?: string; recordedAmount?: number };

export type BudgetInfo =
  | { kind: 'unavailable'; reason: 'not-connected' | 'denied' | 'error' }
  | { kind: 'none'; asOfUtc: string }
  | { kind: 'set'; lines: BudgetLine[]; asOfUtc: string };

export interface WorkItem {
  key: string; // WorkItemKey: recurring work with the same title has distinct keys
  profileId: ProfileId;
  clientKey: string;
  title: string;
  status: WorkStatus;
  dueDate?: string; // YYYY-MM-DD
  budget: BudgetInfo;
}

export interface Segment {
  startedAtUtc: string;
  endedAtUtc: string;
  elapsedMs: number;
}

export type SessionStatus = 'running' | 'paused' | 'stopped' | 'needs-review';
export type SubmissionStatus = 'local-only' | 'ready-for-review' | 'pending' | 'confirmed' | 'uncertain' | 'failed';
export type ReviewReason = 'clock-reversal' | 'long-interval';

export interface LocalSession {
  id: string;
  profileId: ProfileId;
  target: Target;
  targetKey: string;
  /** Display snapshot so renamed or deleted catalog entries never erase history. */
  label: { client: string; work: string };
  dateLocal: string;
  timeZone: string;
  status: SessionStatus;
  startedAtUtc: string;
  segments: Segment[];
  runningSinceUtc?: string;
  /** Plain manual text, stored verbatim (KWS-035). */
  userNote?: string;
  notesSchema: 1;
  roleName?: string;
  taskTypeName?: string;
  billableIntent: 'unknown' | 'billable' | 'nonbillable';
  submissionStatus: SubmissionStatus;
  reviewReasons?: ReviewReason[];
  lastEditedAtUtc: string;
  version: number;
  officialEntryId?: string; // only ever set by an approved integration; never in Phase A
}
