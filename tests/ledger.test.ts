import { describe, expect, it } from 'vitest';
import { openLedger, StorageError, type Ledger } from '../src/storage/ledger';
import { elapsedMs } from '../src/domain/timer';
import type { LocalSession } from '../src/domain/types';
import { sampleCatalog } from '../src/integrations/sample';
import { input, ledgers, MIN, T0 } from './helpers';

const op = () => crypto.randomUUID();

async function invariants(l: Ledger, profile: 'sample' | 'local' = 'sample') {
  const { state, active } = await l.active();
  const all = await l.allSessions(profile);
  const live = all.filter((s) => s.status === 'running' || s.status === 'paused');
  expect(live.length).toBeLessThanOrEqual(1);
  expect(live[0]?.id ?? null).toBe(state.activeSessionId);
  if (active) expect(active.id).toBe(state.activeSessionId);
  const segs = all.flatMap((s) => s.segments.map((g) => [Date.parse(g.startedAtUtc), Date.parse(g.endedAtUtc)] as const));
  segs.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < segs.length; i++) expect(segs[i]![0]).toBeGreaterThanOrEqual(segs[i - 1]![1]);
  return all;
}

describe('ledger concurrency and durability [KWS-001, KWS-004, KWS-005]', () => {
  it('two connections starting different targets at the same instant leave exactly one running session', async () => {
    const { list } = await ledgers(2);
    const [a, b] = list as [Ledger, Ledger];
    await Promise.all([
      a.command({ opId: op(), type: 'start', input: input('s-a', 'A') }),
      b.command({ opId: op(), type: 'start', input: input('s-b', 'B') }),
    ]);
    const all = await invariants(a);
    expect(all.filter((s) => s.status === 'running')).toHaveLength(1);
    expect(all).toHaveLength(2);
  });

  it('randomized commands from three connections never overlap, lose or duplicate time (fuzz, 300 ops)', async () => {
    const { list, clock } = await ledgers(3);
    let seed = 42;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n);
    let n = 0;
    for (let round = 0; round < 100; round++) {
      clock.now += (1 + rnd(20)) * MIN;
      await Promise.allSettled(list.map(async (l) => {
        const { active } = await l.active();
        const k = rnd(5);
        if (k < 2 || !active) return l.command({ opId: op(), type: 'start', input: input(`s${n++}`, String.fromCharCode(65 + rnd(4))) });
        if (k === 2) return l.command({ opId: op(), type: 'pause', sessionId: active.id });
        if (k === 3) return l.command({ opId: op(), type: 'resume', sessionId: active.id });
        return l.command({ opId: op(), type: 'stop', sessionId: active.id });
      }));
      await invariants(list[0]!);
    }
  });

  it('100 rapid switches produce 100 contiguous sessions with no gap', async () => {
    const { l, clock } = await ledgers();
    for (let i = 0; i < 101; i++) {
      clock.now += 1000;
      await l.command({ opId: op(), type: 'start', input: input(`s${i}`, `W${i % 7}`) });
    }
    const all = (await invariants(l)).sort((a, b) => a.startedAtUtc.localeCompare(b.startedAtUtc));
    expect(all).toHaveLength(101);
    for (let i = 1; i < all.length; i++) expect(all[i]!.startedAtUtc).toBe(all[i - 1]!.segments.at(-1)!.endedAtUtc);
  });

  it('replaying the same operation id has no second effect', async () => {
    const { l } = await ledgers();
    const id = op();
    await l.command({ opId: id, type: 'start', input: input('s1', 'A') });
    const r = await l.command({ opId: id, type: 'start', input: input('s2', 'B') });
    expect(r.replayed).toBe(true);
    expect(r.activeSessionId).toBe('s1');
    expect(await l.allSessions('sample')).toHaveLength(1);
  });

  it('a reopened database (worker/browser restart) keeps the running session and derives elapsed from timestamps', async () => {
    const { factory, clock, l } = await ledgers();
    await l.command({ opId: op(), type: 'start', input: input('s1', 'A') });
    l.close();
    clock.now += 3 * 60 * MIN;
    const l2 = await openLedger(factory, () => clock.now);
    const { active } = await l2.active();
    expect(active?.id).toBe('s1');
    expect(elapsedMs(active!, clock.now)).toBe(180 * MIN);
  });

  it('a failed write is reported and leaves the previous state intact [storage fault injection]', async () => {
    const { l } = await ledgers();
    await l.command({ opId: op(), type: 'start', input: input('s1', 'A') });
    const proto = (globalThis as any).IDBObjectStore.prototype;
    const orig = proto.put;
    proto.put = function () { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
    try {
      await expect(l.command({ opId: op(), type: 'start', input: input('s2', 'B') })).rejects.toBeInstanceOf(StorageError);
    } finally {
      proto.put = orig;
    }
    const { active } = await l.active();
    expect(active?.id).toBe('s1');
    expect(active?.status).toBe('running');
    expect(await l.allSessions('sample')).toHaveLength(1);
  });
});

describe('identity isolation and mode switching [KWS-016]', () => {
  it('rejects a target from another namespace and refuses a mode switch while a timer is active', async () => {
    const { l } = await ledgers();
    await expect(l.command({ opId: op(), type: 'start', input: input('x', 'A', 'local') })).rejects.toThrow(/different data mode/);
    await l.command({ opId: op(), type: 'start', input: input('s1', 'A') });
    await expect(l.setProfile('local')).rejects.toThrow(/Stop the running timer/);
    const { active } = await l.active();
    await l.command({ opId: op(), type: 'stop', sessionId: active!.id });
    await l.setProfile('local');
    expect(await l.allSessions('local')).toHaveLength(0);
  });

  it('catalogs are namespaced', async () => {
    const { l } = await ledgers();
    const c = sampleCatalog(T0);
    await l.seedCatalog(c.clients, c.work);
    expect((await l.catalog('sample')).work).toHaveLength(c.work.length);
    expect((await l.catalog('local')).work).toHaveLength(0);
  });
});

describe('audited corrections and deletion [KWS-013, KWS-032, KWS-034]', () => {
  async function twoStopped() {
    const env = await ledgers();
    const { l, clock } = env;
    await l.command({ opId: op(), type: 'start', input: input('a', 'A') });
    clock.now += 30 * MIN;
    await l.command({ opId: op(), type: 'start', input: input('b', 'B') });
    clock.now += 30 * MIN;
    await l.command({ opId: op(), type: 'stop', sessionId: 'b' });
    return env;
  }

  it('edits require a reason, are audited with before/after, and cannot overlap other sessions', async () => {
    const { l } = await twoStopped();
    await expect(l.editTimes('b', [{ index: 0, startMs: T0, endMs: T0 + 60 * MIN }], ' ')).rejects.toThrow(/reason/);
    await expect(l.editTimes('b', [{ index: 0, startMs: T0, endMs: T0 + 60 * MIN }], 'fix')).rejects.toThrow(/overlaps/);
    await l.editTimes('b', [{ index: 0, startMs: T0 + 40 * MIN, endMs: T0 + 60 * MIN }], 'Started late');
    const audit = await l.audit('b');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'edit-times', reason: 'Started late' });
    expect(audit[0]!.before.segments[0]!.elapsedMs).toBe(30 * MIN);
    expect(audit[0]!.after[0]!.segments[0]!.elapsedMs).toBe(20 * MIN);
  });

  it('refuses to edit the active timer times', async () => {
    const { l } = await ledgers();
    await l.command({ opId: op(), type: 'start', input: input('a', 'A') });
    await expect(l.editTimes('a', [], 'x')).rejects.toThrow(/Stop the timer/);
  });

  it('split and discard keep the full prior record in the audit log', async () => {
    const { l } = await twoStopped();
    await l.split('a', T0 + 10 * MIN, 'a2', 'Two tasks');
    expect((await l.session('a'))!.segments[0]!.elapsedMs).toBe(10 * MIN);
    expect((await l.session('a2'))!.segments[0]!.elapsedMs).toBe(20 * MIN);
    await l.discard('a2', 'Personal call');
    expect(await l.session('a2')).toBeUndefined();
    const audit = await l.audit('a2');
    expect(audit.map((a) => a.action)).toEqual(['split', 'discard']);
    expect((audit[1]!.before as LocalSession).id).toBe('a2');
  });

  it('notes are stored verbatim, also on the running session', async () => {
    const { l } = await ledgers();
    await l.command({ opId: op(), type: 'start', input: input('a', 'A') });
    const note = '<b>not html</b>\n  - bullet  ';
    await l.updateDetails('a', { userNote: note, roleName: 'Senior', billableIntent: 'billable' });
    expect((await l.session('a'))!.userNote).toBe(note);
  });

  it('deleteAll clears every record and the active pointer but keeps theme', async () => {
    const { l } = await ledgers();
    await l.setTheme('light');
    await l.command({ opId: op(), type: 'start', input: input('a', 'A') });
    await l.deleteAll();
    const s = await l.getState();
    expect(s).toMatchObject({ activeSessionId: null, profile: null, theme: 'light' });
    expect(await l.allSessions('sample')).toHaveLength(0);
  });
});
