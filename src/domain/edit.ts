// Audited corrections to stopped local sessions (KWS-013, KWS-032). Pure functions; the store
// writes the result and the audit record in one transaction.

import { DomainError } from './timer';
import { localDate } from './time';
import type { LocalSession, Segment } from './types';

function assertEditable(s: LocalSession) {
  if (s.submissionStatus === 'confirmed' || s.officialEntryId)
    throw new DomainError('CONFIRMED_LOCKED', 'This entry is confirmed in Karbon and cannot be changed locally.');
  if (s.status === 'running' || s.status === 'paused')
    throw new DomainError('INVALID_EDIT', 'Stop the timer before correcting its times.');
}

function seg(startMs: number, endMs: number): Segment {
  return { startedAtUtc: new Date(startMs).toISOString(), endedAtUtc: new Date(endMs).toISOString(), elapsedMs: endMs - startMs };
}

function overlaps(a: Segment, b: Segment) {
  return Date.parse(a.startedAtUtc) < Date.parse(b.endedAtUtc) && Date.parse(b.startedAtUtc) < Date.parse(a.endedAtUtc);
}

/** Rejects a segment set that overlaps itself or any other session's segments. */
export function assertNoOverlap(segments: Segment[], others: LocalSession[], selfId: string) {
  const all = others.filter((o) => o.id !== selfId).flatMap((o) => o.segments);
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i]!;
    if (Date.parse(a.endedAtUtc) <= Date.parse(a.startedAtUtc)) throw new DomainError('INVALID_EDIT', 'End time must be after start time.');
    for (let j = i + 1; j < segments.length; j++) if (overlaps(a, segments[j]!)) throw new DomainError('INVALID_EDIT', 'Intervals in this session overlap.');
    if (all.some((b) => overlaps(a, b))) throw new DomainError('INVALID_EDIT', 'This interval overlaps another recorded session.');
  }
}

export interface SegmentEdit { index: number; startMs: number; endMs: number }

export function editTimes(s: LocalSession, edits: SegmentEdit[], others: LocalSession[], nowIso: string): LocalSession {
  assertEditable(s);
  const segments = s.segments.map((g, i) => {
    const e = edits.find((x) => x.index === i);
    return e ? seg(e.startMs, e.endMs) : g;
  });
  assertNoOverlap(segments, others, s.id);
  segments.sort((a, b) => Date.parse(a.startedAtUtc) - Date.parse(b.startedAtUtc));
  const first = segments[0];
  return {
    ...s,
    segments,
    startedAtUtc: first ? first.startedAtUtc : s.startedAtUtc,
    dateLocal: first ? localDate(Date.parse(first.startedAtUtc), s.timeZone) : s.dateLocal,
    status: 'stopped',
    reviewReasons: undefined,
    lastEditedAtUtc: nowIso,
    version: s.version + 1,
  };
}

/** Splits at an instant: segments (or the part of one) after `atMs` move to a new session with the same target. */
export function splitAt(s: LocalSession, atMs: number, newId: string, nowIso: string): [LocalSession, LocalSession] {
  assertEditable(s);
  const before: Segment[] = [];
  const after: Segment[] = [];
  for (const g of s.segments) {
    const a = Date.parse(g.startedAtUtc), b = Date.parse(g.endedAtUtc);
    if (b <= atMs) before.push(g);
    else if (a >= atMs) after.push(g);
    else { before.push(seg(a, atMs)); after.push(seg(atMs, b)); }
  }
  if (!before.length || !after.length) throw new DomainError('INVALID_EDIT', 'Choose a split time inside the recorded intervals.');
  const base = { lastEditedAtUtc: nowIso, version: s.version + 1 };
  const first: LocalSession = { ...s, ...base, segments: before };
  const second: LocalSession = {
    ...s, ...base, id: newId, segments: after, version: 1,
    startedAtUtc: after[0]!.startedAtUtc,
    dateLocal: localDate(Date.parse(after[0]!.startedAtUtc), s.timeZone),
  };
  return [first, second];
}

export function assertDiscardable(s: LocalSession) {
  assertEditable(s);
}
