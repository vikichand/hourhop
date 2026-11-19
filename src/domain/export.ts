// CSV / JSON export (KWS-014). Keeps typed target IDs, time zone, segment durations, session IDs
// and notes verbatim. No credentials exist to leak. CSV cells are protected against formula injection.

import type { LocalSession } from './types';

/**
 * OWASP CSV-injection guidance: prefix with a single quote any cell starting with tab or CR, or whose
 * first character after leading whitespace and control characters is = + - or @.
 */
export function csvCell(v: unknown): string {
  let s = v === undefined || v === null ? '' : String(v);
  if (/^[\t\r]/.test(s) || /^[\s\u0000-\u001f]*[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const COLUMNS = [
  'session_id', 'profile', 'target_kind', 'client_kind', 'client_id', 'work_item_id', 'client', 'work_item',
  'local_date', 'time_zone', 'segment_index', 'segment_start_utc', 'segment_end_utc', 'segment_ms', 'segment_minutes',
  'session_status', 'submission_status', 'billable_intent', 'role', 'task_type', 'note',
] as const;

/** One row per segment so exported totals reconcile exactly with recorded intervals. */
export function toCsv(sessions: LocalSession[]): string {
  const rows: string[] = [COLUMNS.join(',')];
  for (const s of sessions) {
    s.segments.forEach((g, i) => {
      const t = s.target;
      rows.push([
        s.id, s.profileId, t.kind, t.kind === 'unassigned' ? '' : t.clientKind, t.kind === 'unassigned' ? '' : t.clientId, t.kind === 'work-item' ? t.workItemId : '',
        s.label.client, s.label.work, s.dateLocal, s.timeZone, i, g.startedAtUtc, g.endedAtUtc, g.elapsedMs,
        (g.elapsedMs / 60_000).toFixed(2), s.status, s.submissionStatus, s.billableIntent,
        s.roleName, s.taskTypeName, s.userNote,
      ].map(csvCell).join(','));
    });
  }
  return rows.join('\r\n') + '\r\n';
}

export function toJson(sessions: LocalSession[], exportedAtUtc: string, appVersion: string): string {
  return JSON.stringify({ format: 'hourhop-sessions', formatVersion: 1, appVersion, exportedAtUtc, sessions }, null, 2);
}

/** Human-readable text for pasting into Karbon's own time entry form by hand. */
function localTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

export function copyText(s: LocalSession): string {
  const mins = Math.round(s.segments.reduce((a, g) => a + g.elapsedMs, 0) / 60_000);
  const h = Math.floor(mins / 60), m = mins % 60;
  return [
    `Client: ${s.label.client}`,
    `Work item: ${s.label.work}`,
    `Date: ${s.dateLocal}`,
    `Duration: ${h}h ${m}m`,
    s.roleName ? `Role: ${s.roleName}` : '',
    s.taskTypeName ? `Task type: ${s.taskTypeName}` : '',
    s.userNote ? `Note: ${s.userNote}` : '',
    s.autoNotes?.length ? `Timer notes: ${s.autoNotes.map((n) => `${localTime(n.atUtc, s.timeZone)} ${n.text}`).join('; ')}` : '',
  ].filter(Boolean).join('\n');
}
