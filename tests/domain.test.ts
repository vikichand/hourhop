import { describe, expect, it } from 'vitest';
import { budgetHint, budgetView, normalizeTimeEstimates } from '../src/domain/budget';
import { editTimes, splitAt } from '../src/domain/edit';
import { copyText, csvCell, toCsv, toJson } from '../src/domain/export';
import { allocateByLocalDate, clock, HOUR, localDate, short } from '../src/domain/time';
import { DomainError, elapsedMs, pause, resume, start, stop } from '../src/domain/timer';
import type { LocalSession } from '../src/domain/types';
import { input, MIN, T0 } from './helpers';

describe('timer transitions [KWS-002, KWS-003, KWS-004]', () => {
  it('pause ends a segment, paused time is not counted, resume adds a segment to the same session', () => {
    const a = start(null, input('s1', 'A'), T0).current!;
    const p = pause(a, 's1', T0 + 10 * MIN).current!;
    expect(p.status).toBe('paused');
    expect(elapsedMs(p, T0 + 60 * MIN)).toBe(10 * MIN);
    const r = resume(p, T0 + 30 * MIN).current!;
    expect(r.id).toBe('s1');
    expect(elapsedMs(r, T0 + 35 * MIN)).toBe(15 * MIN);
    const s = stop(r, 's1', T0 + 40 * MIN).writes[0]!;
    expect(s.segments).toHaveLength(2);
    expect(elapsedMs(s, T0 + 999 * MIN)).toBe(20 * MIN);
    expect(s.status).toBe('stopped');
    expect(s.submissionStatus).toBe('local-only');
  });

  it('switch closes the old session and opens a new one at the same instant', () => {
    const a = start(null, input('s1', 'A'), T0).current!;
    const tr = start(a, input('s2', 'B'), T0 + 5 * MIN);
    expect(tr.writes.map((s) => [s.id, s.status])).toEqual([['s1', 'stopped'], ['s2', 'running']]);
    expect(tr.writes[0]!.segments[0]!.endedAtUtc).toBe(tr.writes[1]!.runningSinceUtc);
    expect(tr.activeSessionId).toBe('s2');
  });

  it('same target while running is a no-op; while paused it resumes the same session', () => {
    const a = start(null, input('s1', 'A'), T0).current!;
    expect(start(a, input('s9', 'A'), T0 + MIN).noop).toBe(true);
    const p = pause(a, 's1', T0 + MIN).current!;
    const r = start(p, input('s9', 'A'), T0 + 2 * MIN);
    expect(r.current!.id).toBe('s1');
    expect(r.current!.status).toBe('running');
  });

  it('restarting a stopped target creates a separate session', () => {
    const a = start(null, input('s1', 'A'), T0).current!;
    stop(a, 's1', T0 + MIN);
    const b = start(null, input('s2', 'A'), T0 + 2 * MIN).current!;
    expect(b.id).toBe('s2');
  });

  it('commands for a session that is no longer active are rejected as CONFLICT', () => {
    const a = start(null, input('s1', 'A'), T0).current!;
    expect(() => pause(a, 'other', T0)).toThrow(DomainError);
    expect(() => stop(null, 's1', T0)).toThrow(/no longer active/);
  });
});

describe('clock, sleep and dates [KWS-006]', () => {
  it('clock reversal records zero for the interval and flags review instead of inventing time', () => {
    const a = start(null, input('s1', 'A'), T0).current!;
    const s = stop(a, 's1', T0 - 30 * MIN).writes[0]!;
    expect(s.segments[0]!.elapsedMs).toBe(0);
    expect(s.status).toBe('needs-review');
    expect(s.reviewReasons).toEqual(['clock-reversal']);
    expect(elapsedMs(a, T0 - 30 * MIN)).toBe(0); // running display never goes negative
  });

  it('a segment over 8h (sleep, forgotten timer) is kept as recorded but flagged for review', () => {
    const a = start(null, input('s1', 'A'), T0).current!;
    const s = stop(a, 's1', T0 + 9 * HOUR).writes[0]!;
    expect(s.segments[0]!.elapsedMs).toBe(9 * HOUR);
    expect(s.status).toBe('needs-review');
    expect(s.reviewReasons).toEqual(['long-interval']);
  });

  it('a forward clock jump while paused does not count', () => {
    const a = start(null, input('s1', 'A'), T0).current!;
    const p = pause(a, 's1', T0 + MIN).current!;
    expect(elapsedMs(p, T0 + 50 * HOUR)).toBe(MIN);
  });

  it('formats durations', () => {
    expect(clock(3_723_000)).toBe('01:02:03');
    expect(clock(-5)).toBe('00:00:00');
    expect(short(75 * MIN)).toBe('1h 15m');
    expect(short(5 * MIN)).toBe('5m');
  });

  it('attributes a midnight-crossing interval to both local dates', () => {
    const s = Date.parse('2026-11-19T23:30:00Z');
    const m = allocateByLocalDate(s, s + HOUR, 'UTC');
    expect([...m]).toEqual([['2026-11-19', 30 * MIN], ['2026-11-20', 30 * MIN]]);
  });

  it('handles DST: spring-forward night has a 23h local day and real elapsed time is preserved', () => {
    const tz = 'America/New_York';
    const s = Date.parse('2026-03-08T05:00:00Z'); // 00:00 EST
    const e = Date.parse('2026-03-09T04:00:00Z'); // 00:00 EDT next day
    const m = allocateByLocalDate(s, e, tz);
    expect([...m]).toEqual([['2026-03-08', 23 * HOUR]]);
    expect(localDate(Date.parse('2026-11-01T05:30:00Z'), tz)).toBe('2026-11-01'); // 01:30 EDT, fall-back night
    const fb = allocateByLocalDate(Date.parse('2026-11-01T04:00:00Z'), Date.parse('2026-11-02T05:00:00Z'), tz);
    expect([...fb]).toEqual([['2026-11-01', 25 * HOUR]]);
  });
});

describe('budgets [KWS-011, KWS-012]', () => {
  const asOf = '2026-11-19T08:00:00Z';
  it('keeps unavailable, none, zero and real budgets distinct', () => {
    expect(budgetView({ kind: 'unavailable', reason: 'not-connected' }, 0, 'Recorded').summary).toBe('Budget unavailable: not connected to Karbon');
    expect(budgetView({ kind: 'unavailable', reason: 'denied' }, 0, 'Recorded').lines).toEqual([]);
    expect(budgetView({ kind: 'none', asOfUtc: asOf }, 0, 'Recorded').summary).toBe('No budget set');
    const zero = budgetView({ kind: 'set', asOfUtc: asOf, lines: [{ kind: 'time', scope: 'work-total', estimateMinutes: 0, recordedMinutes: 0 }] }, 0, 'R');
    expect(zero.lines[0]!.ratio).toBeUndefined();
    expect(zero.lines[0]!.remaining).toBe('Zero budget set');
  });

  it('`0-` estimate rows never become a budget', () => {
    expect(normalizeTimeEstimates([{ key: '0-x', minutes: 0 }], 30, 'work-total', asOf).kind).toBe('none');
    expect(normalizeTimeEstimates([], 0, 'work-total', asOf).kind).toBe('none');
    const b = normalizeTimeEstimates([{ key: '0-x', minutes: 0 }, { key: 'u1-t1', userKey: 'u1', minutes: 60 }, { key: 'u2-t1', userKey: 'u2', minutes: 30 }], 10, 'user-allocation', asOf, 'u1');
    expect(b).toMatchObject({ kind: 'set', lines: [{ estimateMinutes: 60, scope: 'user-allocation' }] });
  });

  it('keeps recorded and local separate; near/over levels; amount never converted to time', () => {
    const v = budgetView({ kind: 'set', asOfUtc: asOf, lines: [
      { kind: 'time', scope: 'work-total', estimateMinutes: 480, recordedMinutes: 400 },
      { kind: 'time', scope: 'user-allocation', estimateMinutes: 60, recordedMinutes: 90 },
    ] }, 45, 'Sample recorded');
    expect(v.lines[0]).toMatchObject({ title: 'Work budget', value: '6h 40m / 8h 00m', remaining: '1h 20m left', level: 'near', local: 'Local unsubmitted 45m' });
    expect(v.lines[1]).toMatchObject({ title: 'Your allocation', level: 'over', remaining: '30m over' });
    expect(v.summary).toBe('Over budget');
    const amt = budgetView({ kind: 'set', asOfUtc: asOf, lines: [{ kind: 'amount', scope: 'work-total', estimateAmount: 1200, currency: 'GBP', recordedAmount: 450 }] }, 30, 'R');
    expect(amt.lines[0]!.value).toMatch(/450.*1,200/);
    expect(amt.lines[0]!.ratio).toBeUndefined();
    expect(amt.lines[0]!.local).toContain('not converted');
    expect(budgetView({ kind: 'set', asOfUtc: asOf, lines: [{ kind: 'amount', scope: 'work-total', estimateAmount: 5 }] }, 0, 'R').lines[0]!.value).toContain('currency unverified');
  });

  it('row hints say only what is true', () => {
    expect(budgetHint({ kind: 'unavailable', reason: 'error' })).toBeUndefined();
    expect(budgetHint({ kind: 'none', asOfUtc: asOf })).toBe('No budget');
  });
});

function stopped(id: string, startMs: number, mins: number, extra: Partial<LocalSession> = {}): LocalSession {
  const s = start(null, input(id, 'A'), startMs).current!;
  return { ...stop(s, id, startMs + mins * MIN).writes[0]!, ...extra };
}

describe('audited edits [KWS-013, KWS-032]', () => {
  it('rejects overlap with another session and end-before-start', () => {
    const a = stopped('a', T0, 30);
    const b = stopped('b', T0 + 60 * MIN, 30);
    expect(() => editTimes(b, [{ index: 0, startMs: T0 + 20 * MIN, endMs: T0 + 90 * MIN }], [a, b], 'now')).toThrow(/overlaps another/);
    expect(() => editTimes(b, [{ index: 0, startMs: T0 + 90 * MIN, endMs: T0 + 80 * MIN }], [a, b], 'now')).toThrow(/after start/);
    const ok = editTimes(b, [{ index: 0, startMs: T0 + 45 * MIN, endMs: T0 + 90 * MIN }], [a, b], 'now');
    expect(ok.segments[0]!.elapsedMs).toBe(45 * MIN);
    expect(ok.version).toBe(b.version + 1);
  });

  it('never rewrites a confirmed entry locally', () => {
    const a = stopped('a', T0, 30, { submissionStatus: 'confirmed' });
    expect(() => editTimes(a, [], [a], 'now')).toThrow(/confirmed in Karbon/);
  });

  it('split moves the later part into a new session with the same target', () => {
    const a = stopped('a', T0, 60);
    const [x, y] = splitAt(a, T0 + 20 * MIN, 'b', 'now');
    expect(x.segments[0]!.elapsedMs).toBe(20 * MIN);
    expect(y.segments[0]!.elapsedMs).toBe(40 * MIN);
    expect(y.targetKey).toBe(a.targetKey);
    expect(() => splitAt(a, T0 + 90 * MIN, 'c', 'now')).toThrow(/inside/);
  });
});

describe('export [KWS-014, KWS-035]', () => {
  it('escapes CSV formula injection and quoting', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell(' =1+1')).toBe("' =1+1");
    expect(csvCell('\n=cmd')).toBe(`"'\n=cmd"`);
  });

  it('keeps typed IDs, time zone, segment ms and verbatim notes; totals reconcile', () => {
    const note = '  Reviewed ledger;\n=cmd|"/c calc"  ünïcødé  ';
    const s = { ...stopped('a', T0, 30), userNote: note };
    const csv = toCsv([s]);
    expect(csv).toContain('session_id,profile,target_kind,client_kind,client_id,work_item_id');
    expect(csv).toContain('a,sample,work-item,Organization,org-1,A');
    expect(csv).toContain(',UTC,0,');
    expect(csv).toContain(',1800000,30.00,');
    const json = JSON.parse(toJson([s], 'now', '0.1.0'));
    expect(json.sessions[0].userNote).toBe(note);
    expect(json.sessions[0].segments[0].elapsedMs).toBe(30 * MIN);
    expect(copyText(s)).toContain('Duration: 0h 30m');
  });
});
