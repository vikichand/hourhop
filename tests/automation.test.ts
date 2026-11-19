import { describe, expect, it } from 'vitest';
import { badgeText, onIdleState, onTick, shouldAlertLong, SLEEP_GAP_MS } from '../src/domain/automation';
import { copyText } from '../src/domain/export';
import { DEFAULT_PREFS } from '../src/storage/ledger';
import { input, ledgers, MIN, T0 } from './helpers';

const op = () => crypto.randomUUID();

async function running() {
  const env = await ledgers();
  await env.l.command({ opId: op(), type: 'start', input: input('s1', 'A') });
  return env;
}

describe('automatic pause and resume rules', () => {
  it('lock pauses at once; idle pauses back at when idling began; coming back resumes only an auto-paused timer, only if asked', async () => {
    const { l, clock } = await running();
    clock.now += 30 * MIN;
    const { active } = await l.active();
    expect(onIdleState('locked', DEFAULT_PREFS, active, null, clock.now)).toEqual({ type: 'pause', atMs: clock.now, note: 'Paused: screen locked' });
    expect(onIdleState('locked', DEFAULT_PREFS, null, null, clock.now)).toBeNull();
    expect(onIdleState('locked', { ...DEFAULT_PREFS, pauseOnLock: false }, active, null, clock.now)).toBeNull();
    expect(onIdleState('idle', DEFAULT_PREFS, active, null, clock.now)).toBeNull(); // idle pause is off by default
    expect(onIdleState('idle', { ...DEFAULT_PREFS, idleMinutes: 10 }, active, null, clock.now)).toEqual({ type: 'pause', atMs: clock.now - 10 * MIN, note: 'Paused: idle for 10 min' });

    await l.command({ opId: op(), type: 'pause', sessionId: 's1', autoNote: 'Paused: screen locked' });
    const paused = (await l.active()).active!;
    const mark = { id: 's1', version: paused.version };
    const resumeOn = { ...DEFAULT_PREFS, autoResume: true };
    expect(onIdleState('active', DEFAULT_PREFS, paused, mark, clock.now)).toBeNull(); // resume is opt-in
    expect(onIdleState('active', resumeOn, paused, mark, clock.now)).toEqual({ type: 'resume', note: 'Resumed: back at the computer' });
    expect(onIdleState('active', resumeOn, paused, null, clock.now)).toBeNull(); // the user paused it
    // The user resumed and paused again by hand after the automatic pause: that manual pause is theirs to end.
    await l.command({ opId: op(), type: 'resume', sessionId: 's1' });
    await l.command({ opId: op(), type: 'pause', sessionId: 's1' });
    expect(onIdleState('active', resumeOn, (await l.active()).active, mark, clock.now)).toBeNull();
  });

  it('a long gap between ticks means the computer slept: pause at the last tick before the gap', async () => {
    const { l, clock } = await running();
    clock.now += 20 * MIN;
    const { active } = await l.active();
    expect(onTick(DEFAULT_PREFS, active, clock.now - MIN, clock.now)).toBeNull();
    expect(onTick(DEFAULT_PREFS, active, clock.now - SLEEP_GAP_MS, clock.now)).toEqual({ type: 'pause', atMs: clock.now - SLEEP_GAP_MS, note: 'Paused: computer asleep' });
    expect(onTick({ ...DEFAULT_PREFS, pauseOnSleep: false }, active, clock.now - SLEEP_GAP_MS, clock.now)).toBeNull();
    expect(onTick(DEFAULT_PREFS, active, null, clock.now)).toBeNull(); // first tick ever
    // A timer started after the gap (Chrome reopened, then play) has nothing to take back.
    expect(onTick(DEFAULT_PREFS, active, T0 - 60 * MIN, clock.now)).toBeNull();
  });

  it('badge and long-timer alert', async () => {
    const { l, clock } = await running();
    clock.now += 45 * MIN;
    let { active } = await l.active();
    expect(badgeText(DEFAULT_PREFS, active, clock.now)).toBe('45m');
    expect(badgeText(DEFAULT_PREFS, active, clock.now + 39 * MIN)).toBe('1:24');
    expect(badgeText({ ...DEFAULT_PREFS, badge: false }, active, clock.now)).toBe('');
    expect(shouldAlertLong(DEFAULT_PREFS, active, [], clock.now + 4 * 60 * MIN)).toBe(true);
    expect(shouldAlertLong(DEFAULT_PREFS, active, ['s1'], clock.now + 4 * 60 * MIN)).toBe(false); // once per session
    expect(shouldAlertLong({ ...DEFAULT_PREFS, longAlertHours: 0 }, active, [], clock.now + 9 * 60 * MIN)).toBe(false);
    await l.command({ opId: op(), type: 'pause', sessionId: 's1' });
    ({ active } = await l.active());
    expect(badgeText(DEFAULT_PREFS, active, clock.now)).toBe('II');
    expect(badgeText(DEFAULT_PREFS, null, clock.now)).toBe('');
  });
});

describe('automatic actions in the ledger', () => {
  it('a backdated pause is clamped to the current interval and leaves a time-stamped note that Copy for Karbon includes', async () => {
    const { l, clock } = await running();
    clock.now += 60 * MIN;
    await l.command({ opId: op(), type: 'pause', sessionId: 's1', atMs: clock.now - 10 * MIN, autoNote: 'Paused: idle for 10 min' });
    let s = (await l.active()).active!;
    expect(s.segments.at(-1)!.elapsedMs).toBe(50 * MIN);
    expect(s.autoNotes).toEqual([{ atUtc: new Date(T0 + 50 * MIN).toISOString(), text: 'Paused: idle for 10 min' }]);
    expect(copyText(s)).toContain('Timer notes: 09:50 Paused: idle for 10 min');

    await l.command({ opId: op(), type: 'resume', sessionId: 's1', autoNote: 'Resumed: back at the computer' });
    clock.now += 5 * MIN;
    await l.command({ opId: op(), type: 'pause', sessionId: 's1', atMs: T0 - 999 * MIN }); // before the interval: clamped
    s = (await l.active()).active!;
    expect(s.segments.at(-1)!.elapsedMs).toBe(0);
    expect(s.autoNotes!.map((n) => n.text)).toEqual(['Paused: idle for 10 min', 'Resumed: back at the computer']);

    // A pause that changes nothing adds no note.
    await l.command({ opId: op(), type: 'pause', sessionId: 's1', autoNote: 'Paused: screen locked' });
    expect((await l.active()).active!.autoNotes).toHaveLength(2);
  });

  it('prefs default safely and save partially', async () => {
    const { l } = await ledgers();
    expect(await l.prefs()).toEqual(DEFAULT_PREFS);
    await l.savePrefs({ idleMinutes: 15, presets: [{ id: 'p', label: 'Prep', roleName: 'Senior' }] });
    expect(await l.prefs()).toMatchObject({ pauseOnLock: true, idleMinutes: 15, presets: [{ label: 'Prep' }] });
  });

  it('start now, choose later: an unassigned session gets its work item once, from the same data mode only', async () => {
    const { l, clock } = await ledgers();
    await l.replaceCatalog('sample', [{ key: 'org-1', profileId: 'sample', kind: 'Organization', name: 'Client 1' }],
      [{ key: 'W7', profileId: 'sample', clientKey: 'org-1', title: 'Work W7', status: 'Planned', budget: { kind: 'none', asOfUtc: 'x' } }]);
    await l.command({ opId: op(), type: 'start', input: { id: 'u1', target: { kind: 'unassigned', tenantId: 'sample' }, label: { client: 'Work not chosen yet', work: 'x' }, timeZone: 'UTC' } });
    clock.now += 25 * MIN;
    await expect(l.assignTarget('u1', input('x', 'W7').target, { client: 'C', work: 'W' })).rejects.toThrow(/Stop the timer/);
    await l.command({ opId: op(), type: 'stop', sessionId: 'u1' });
    await expect(l.assignTarget('u1', input('x', 'NOPE').target, { client: 'C', work: 'W' })).rejects.toThrow(/not in this data mode/);
    const work = input('ignored', 'W7').target;
    await expect(l.assignTarget('u1', { ...work, tenantId: 'local' } as never, { client: 'C', work: 'W' })).rejects.toThrow(/same data mode/);
    await l.assignTarget('u1', work, { client: 'Client 1', work: 'Work W7' });
    const [s] = await l.sessionsForTarget('w:sample:Organization:org-1:W7');
    expect(s).toMatchObject({ id: 'u1', label: { work: 'Work W7' }, segments: [{ elapsedMs: 25 * MIN }] });
    await expect(l.assignTarget('u1', work, { client: 'C', work: 'W' })).rejects.toThrow(/already has a work item/);
  });
});
