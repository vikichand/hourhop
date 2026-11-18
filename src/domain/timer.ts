// Pure timer transitions (PRD §6). Input: the current active session (or none) and one timestamp
// taken once at command reception. Output: the session records to write and the new active id.
// No setInterval: elapsed time is always derived from timestamp segments.

import { LONG_SEGMENT_MS, localDate } from './time';
import { targetKey, type LocalSession, type ReviewReason, type Target } from './types';

export interface Transition {
  writes: LocalSession[];
  activeSessionId: string | null;
  /** Session the caller should consider "current" after the transition. */
  current: LocalSession | null;
  noop?: boolean;
}

export class DomainError extends Error {
  constructor(public code: 'CONFLICT' | 'INVALID_TARGET' | 'CONFIRMED_LOCKED' | 'INVALID_EDIT', message: string) {
    super(message);
  }
}

export function elapsedMs(s: LocalSession, nowMs: number): number {
  const closed = s.segments.reduce((a, g) => a + g.elapsedMs, 0);
  if (s.status !== 'running' || !s.runningSinceUtc) return closed;
  return closed + Math.max(0, nowMs - Date.parse(s.runningSinceUtc));
}

/** Closes the open segment. A negative or very long interval is kept honest and flagged, never invented. */
function closeSegment(s: LocalSession, nowMs: number): LocalSession {
  if (s.status !== 'running' || !s.runningSinceUtc) return s;
  const startMs = Date.parse(s.runningSinceUtc);
  const reasons = new Set<ReviewReason>(s.reviewReasons ?? []);
  let elapsed = nowMs - startMs;
  let endMs = nowMs;
  if (elapsed < 0) {
    // Wall clock moved backwards while running: record nothing for this interval and ask the user.
    reasons.add('clock-reversal');
    elapsed = 0;
    endMs = startMs;
  } else if (elapsed > LONG_SEGMENT_MS) {
    reasons.add('long-interval');
  }
  const seg = { startedAtUtc: s.runningSinceUtc, endedAtUtc: new Date(endMs).toISOString(), elapsedMs: elapsed };
  const next: LocalSession = { ...s, segments: [...s.segments, seg], runningSinceUtc: undefined };
  if (reasons.size) next.reviewReasons = [...reasons];
  return next;
}

function bump(s: LocalSession, nowIso: string): LocalSession {
  return { ...s, lastEditedAtUtc: nowIso, version: s.version + 1 };
}

export interface NewSessionInput {
  id: string;
  target: Target;
  label: { client: string; work: string };
  timeZone: string;
}

export function newSession(input: NewSessionInput, nowMs: number): LocalSession {
  const iso = new Date(nowMs).toISOString();
  return {
    id: input.id,
    profileId: input.target.tenantId,
    target: input.target,
    targetKey: targetKey(input.target),
    label: input.label,
    dateLocal: localDate(nowMs, input.timeZone),
    timeZone: input.timeZone,
    status: 'running',
    startedAtUtc: iso,
    segments: [],
    runningSinceUtc: iso,
    notesSchema: 1,
    billableIntent: 'unknown',
    submissionStatus: 'local-only',
    lastEditedAtUtc: iso,
    version: 1,
  };
}

function finish(active: LocalSession, nowMs: number): LocalSession {
  const s = closeSegment(active, nowMs);
  const status = s.reviewReasons?.length ? 'needs-review' : 'stopped';
  return bump({ ...s, status }, new Date(nowMs).toISOString());
}

/** Start or switch. Same target while running is a no-op; same target while paused resumes. */
export function start(active: LocalSession | null, input: NewSessionInput, nowMs: number): Transition {
  if (active && active.targetKey === targetKey(input.target)) {
    if (active.status === 'running') return { writes: [], activeSessionId: active.id, current: active, noop: true };
    return resume(active, nowMs);
  }
  const writes: LocalSession[] = [];
  if (active) writes.push(finish(active, nowMs));
  const next = newSession(input, nowMs);
  writes.push(next);
  return { writes, activeSessionId: next.id, current: next };
}

export function pause(active: LocalSession | null, sessionId: string, nowMs: number): Transition {
  if (!active || active.id !== sessionId) throw new DomainError('CONFLICT', 'That timer is no longer active.');
  if (active.status === 'paused') return { writes: [], activeSessionId: active.id, current: active, noop: true };
  const s = closeSegment(active, nowMs);
  const next = bump({ ...s, status: 'paused' }, new Date(nowMs).toISOString());
  return { writes: [next], activeSessionId: next.id, current: next };
}

export function resume(active: LocalSession | null, nowMs: number, sessionId?: string): Transition {
  if (!active || (sessionId && active.id !== sessionId)) throw new DomainError('CONFLICT', 'That timer is no longer active.');
  if (active.status === 'running') return { writes: [], activeSessionId: active.id, current: active, noop: true };
  const iso = new Date(nowMs).toISOString();
  const next = bump({ ...active, status: 'running', runningSinceUtc: iso }, iso);
  return { writes: [next], activeSessionId: next.id, current: next };
}

export function stop(active: LocalSession | null, sessionId: string, nowMs: number): Transition {
  if (!active || active.id !== sessionId) throw new DomainError('CONFLICT', 'That timer is no longer active.');
  const done = finish(active, nowMs);
  return { writes: [done], activeSessionId: null, current: null };
}
