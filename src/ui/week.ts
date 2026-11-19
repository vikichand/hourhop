// Monday-to-Sunday totals for the current local week, from real local sessions only.
import { currentTimeZone, localDate } from '../domain/time';
import { elapsedMs } from '../domain/timer';
import type { LocalSession } from '../domain/types';

const DAY = 86_400_000;
const NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Local dates (YYYY-MM-DD) of this week's Monday through Sunday. */
export function weekDates(nowMs: number, tz = currentTimeZone()): string[] {
  const today = localDate(nowMs, tz);
  // Day of week from the local date itself, so the time zone and DST cannot shift it.
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
  const noon = Date.parse(`${today}T12:00:00Z`);
  return NAMES.map((_, i) => new Date(noon + (i - dow) * DAY).toISOString().slice(0, 10));
}

export function weekDays(sessions: LocalSession[], active: LocalSession | null, nowMs: number) {
  const dates = weekDates(nowMs);
  const today = localDate(nowMs, currentTimeZone());
  const totals = new Map<string, number>();
  for (const s of sessions) {
    const live = active?.id === s.id ? active : s;
    totals.set(s.dateLocal, (totals.get(s.dateLocal) ?? 0) + elapsedMs(live, nowMs));
  }
  return dates.map((d, i) => ({ date: d, label: NAMES[i]!, ms: totals.get(d) ?? 0, today: d === today }));
}
