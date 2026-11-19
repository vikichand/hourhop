// Duration formatting and local-date attribution. UTC in, local only for display/attribution.

export const HOUR = 3_600_000;
/** A single uninterrupted segment longer than this is flagged for review (sleep, forgotten timer). */
export const LONG_SEGMENT_MS = 8 * HOUR;

export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

/** H:MM:SS without a leading zero hour, for the large dial readout. */
export function dialClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${Math.floor(s / 3600)}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

export function short(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

export function minutesShort(min: number): string {
  return short(min * 60_000);
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
/** YYYY-MM-DD for an instant in an IANA time zone. */
export function localDate(utcMs: number, timeZone: string): string {
  let f = fmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    fmtCache.set(timeZone, f);
  }
  return f.format(utcMs);
}

export function currentTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Splits [startMs, endMs) at local midnights in `timeZone` and returns ms per local date.
 * Midnight is found by binary search on the instant, so DST transitions are handled by Intl.
 */
export function allocateByLocalDate(startMs: number, endMs: number, timeZone: string): Map<string, number> {
  const out = new Map<string, number>();
  let s = startMs;
  while (s < endMs) {
    const d = localDate(s, timeZone);
    let e = endMs;
    if (localDate(endMs - 1, timeZone) !== d) {
      let lo = s, hi = endMs; // invariant: localDate(lo) === d, localDate(hi - 1) !== d
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (localDate(mid, timeZone) === d) lo = mid; else hi = mid;
      }
      e = hi;
    }
    out.set(d, (out.get(d) ?? 0) + (e - s));
    s = e;
  }
  return out;
}
