// Decisions for the background helper: when to pause or resume automatically, what the toolbar badge shows and when
// to alert about a long timer. Pure functions, so every rule is unit-tested; the service worker only wires events.

import type { Prefs } from '../storage/ledger';
import type { LocalSession } from './types';
import { elapsedMs } from './timer';

/** A gap this long between one-minute ticks means the computer was asleep (Chrome's timers stop while asleep). */
export const SLEEP_GAP_MS = 3 * 60_000;

export type IdleState = 'active' | 'idle' | 'locked';
export type AutoAction = { type: 'pause'; atMs: number; note: string } | { type: 'resume'; note: string } | null;
/** The session the helper paused, and its version right after that pause: any later change by the user voids it. */
export type AutoPaused = { id: string; version: number } | null;

const untouchedSinceAutoPause = (active: LocalSession, autoPaused: AutoPaused) =>
  !!autoPaused && active.id === autoPaused.id && active.version === autoPaused.version;

/** Lock or idle pauses a running timer; coming back resumes it only if this helper paused it and the user asked for that. */
export function onIdleState(state: IdleState, prefs: Prefs, active: LocalSession | null, autoPaused: AutoPaused, nowMs: number): AutoAction {
  if (!active) return null;
  if (state === 'locked' && prefs.pauseOnLock && active.status === 'running') return { type: 'pause', atMs: nowMs, note: 'Paused: screen locked' };
  if (state === 'idle' && prefs.idleMinutes > 0 && active.status === 'running') {
    return { type: 'pause', atMs: nowMs - prefs.idleMinutes * 60_000, note: `Paused: idle for ${prefs.idleMinutes} min` };
  }
  if (state === 'active' && prefs.autoResume && active.status === 'paused' && untouchedSinceAutoPause(active, autoPaused)) {
    return { type: 'resume', note: 'Resumed: back at the computer' };
  }
  return null;
}

/**
 * On a tick after a long gap, the timer is paused at the last tick before the gap: the moment the computer slept.
 * Only for a timer that was already running before that tick: one started after the gap has nothing to take back.
 */
export function onTick(prefs: Prefs, active: LocalSession | null, lastTickMs: number | null, nowMs: number): AutoAction {
  if (!active || active.status !== 'running' || !prefs.pauseOnSleep || lastTickMs === null || !active.runningSinceUtc) return null;
  if (nowMs - lastTickMs < SLEEP_GAP_MS || Date.parse(active.runningSinceUtc) >= lastTickMs) return null;
  return { type: 'pause', atMs: lastTickMs, note: 'Paused: computer asleep' };
}

/** "1:24" from an hour, "45m" below it, "II" when paused, empty when nothing is active or the badge is off. */
export function badgeText(prefs: Prefs, active: LocalSession | null, nowMs: number): string {
  if (!prefs.badge || !active) return '';
  if (active.status === 'paused') return 'II';
  const min = Math.floor(elapsedMs(active, nowMs) / 60_000);
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}

/** True once per session when it passes the alert threshold while running. */
export function shouldAlertLong(prefs: Prefs, active: LocalSession | null, alerted: string[], nowMs: number): boolean {
  return !!active && active.status === 'running' && prefs.longAlertHours > 0 && !alerted.includes(active.id)
    && elapsedMs(active, nowMs) >= prefs.longAlertHours * 3_600_000;
}
