// Background helper: pause on screen lock, sleep or idle (and optionally resume), the long-timer alert, the toolbar
// badge and the start/pause keyboard shortcut. It holds no state of its own beyond a few markers in storage.local;
// every timer change goes through the same ledger commands as the UI, so the one-timer invariant still holds.
// Decisions live in src/domain/automation.ts. Events are handled one at a time, so a tick and an idle change can
// never overwrite each other's markers.

import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { APP } from '../app-meta';
import { badgeText, onIdleState, onTick, shouldAlertLong, type AutoAction, type AutoPaused, type IdleState } from '../domain/automation';
import { currentTimeZone } from '../domain/time';
import type { LocalSession } from '../domain/types';
import { openLedger, type Ledger } from '../storage/ledger';

const AUTO_KEY = 'automation';
const TICK = 'tick';
/** Badge colours mirror tokens in src/ui/tokens.css (the badge API takes no CSS variables). */
const BADGE_RUNNING = '#a38bff'; // --violet-400
const BADGE_PAUSED = '#8c8ba8'; // --ink-500

type Auto = { autoPaused: AutoPaused; lastTickMs: number | null; alerted: string[] };

export default defineBackground(() => {
  let ledgerPromise: Promise<Ledger> | undefined;
  const ledger = () => (ledgerPromise ??= openLedger());
  const getAuto = async (): Promise<Auto> => ({ autoPaused: null, lastTickMs: null, alerted: [], ...((await browser.storage.local.get(AUTO_KEY))[AUTO_KEY] as Partial<Auto> | undefined) });
  const setAuto = (a: Auto) => browser.storage.local.set({ [AUTO_KEY]: { ...a, alerted: a.alerted.slice(-50) } });

  /** One event at a time; a failure is contained so the next event still runs. */
  let chain: Promise<unknown> = Promise.resolve();
  const serial = (fn: () => Promise<unknown>) => { chain = chain.then(fn).catch(() => undefined); };

  async function apply(action: AutoAction, active: LocalSession, auto: Auto) {
    if (!action) return;
    const l = await ledger();
    if (action.type === 'pause') {
      await l.command({ opId: crypto.randomUUID(), type: 'pause', sessionId: active.id, atMs: action.atMs, autoNote: action.note });
      const after = (await l.active()).active;
      auto.autoPaused = after && after.id === active.id ? { id: after.id, version: after.version } : null;
    } else {
      await l.command({ opId: crypto.randomUUID(), type: 'resume', sessionId: active.id, autoNote: action.note });
      auto.autoPaused = null;
    }
  }

  async function refreshBadge() {
    const l = await ledger();
    const [prefs, { active }] = await Promise.all([l.prefs(), l.active()]);
    await browser.action.setBadgeText({ text: badgeText(prefs, active, Date.now()) });
    await browser.action.setBadgeBackgroundColor({ color: active?.status === 'paused' ? BADGE_PAUSED : BADGE_RUNNING });
  }

  async function syncIdleInterval() {
    const prefs = await (await ledger()).prefs();
    // Lock events arrive whatever the interval; idle only matters when the user switched idle pause on.
    browser.idle.setDetectionInterval(prefs.idleMinutes > 0 ? prefs.idleMinutes * 60 : 4 * 3600);
  }

  async function tick() {
    const l = await ledger();
    const [prefs, { active }, auto] = await Promise.all([l.prefs(), l.active(), getAuto()]);
    const now = Date.now();
    const lastTickMs = auto.lastTickMs;
    // Saved first: a later failure must not leave a stale tick that a future tick would read as a long sleep.
    auto.lastTickMs = now;
    await setAuto(auto);
    const sleep = onTick(prefs, active, lastTickMs, now);
    if (active && sleep) {
      await apply(sleep, active, auto);
      // The computer is awake again now, so an opted-in resume happens straight away.
      const paused = (await l.active()).active;
      if (paused) await apply(onIdleState('active', prefs, paused, auto.autoPaused, now), paused, auto);
    }
    const current = (await l.active()).active;
    if (shouldAlertLong(prefs, current, auto.alerted, now)) {
      auto.alerted.push(current!.id);
      // No client or work names: notifications can show on a lock screen or in a screen share.
      await browser.notifications.create(`long-${current!.id}`, {
        type: 'basic', iconUrl: browser.runtime.getURL('/icon/128.png'), title: `${APP.brand}: timer still running`,
        message: `Your timer has been running for over ${prefs.longAlertHours} hours. Still working on it?`,
      });
    }
    await setAuto(auto);
    await refreshBadge();
  }

  async function idleChanged(state: IdleState) {
    const l = await ledger();
    const [prefs, { active }, auto] = await Promise.all([l.prefs(), l.active(), getAuto()]);
    if (active) await apply(onIdleState(state, prefs, active, auto.autoPaused, Date.now()), active, auto);
    await setAuto(auto);
    await refreshBadge();
  }

  /** Alt+Shift+K: pause the running timer, resume a paused one, or restart the most recent assigned work. */
  async function toggle() {
    const l = await ledger();
    const { state, active } = await l.active();
    if (active?.status === 'running') await l.command({ opId: crypto.randomUUID(), type: 'pause', sessionId: active.id });
    else if (active) await l.command({ opId: crypto.randomUUID(), type: 'resume', sessionId: active.id });
    else if (state.profile) {
      const key = (await l.recentTargets(state.profile, 10)).find((k) => !k.startsWith('u:'));
      const last = key ? (await l.sessionsForTarget(key)).sort((a, b) => b.startedAtUtc.localeCompare(a.startedAtUtc))[0] : undefined;
      if (last) await l.command({ opId: crypto.randomUUID(), type: 'start', input: { id: crypto.randomUUID(), target: last.target, label: last.label, timeZone: currentTimeZone() } });
    }
    await refreshBadge();
  }

  async function started() {
    // A fresh start: the previous tick belongs to before Chrome closed, which is not a sleep to pause for.
    const auto = await getAuto();
    await setAuto({ ...auto, lastTickMs: null });
    await browser.alarms.create(TICK, { periodInMinutes: 1 });
  }

  // Listeners are registered synchronously so Chrome can wake the worker for them.
  browser.idle.onStateChanged.addListener((state) => serial(() => idleChanged(state as IdleState)));
  browser.alarms.onAlarm.addListener((a) => { if (a.name === TICK) serial(tick); });
  browser.commands.onCommand.addListener((c) => { if (c === 'toggle-timer') serial(toggle); });
  browser.runtime.onInstalled.addListener(() => serial(started));
  browser.runtime.onStartup.addListener(() => serial(started));
  // The Karbon session check's relay (a content script) writes its records to session storage.
  serial(() => browser.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }));
  serial(async () => { (await ledger()).onChange(() => { serial(refreshBadge); serial(syncIdleInterval); }); });
  serial(syncIdleInterval);
  serial(refreshBadge);
});
