// Snapshot subscription and command dispatch shared by every surface (T-205). No surface keeps its
// own timer state: each one reads the durable ledger, and re-reads it whenever any surface commits
// (BroadcastChannel), when it becomes visible again, or after its own command.

import { APP } from '../app-meta';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { DomainError } from '../domain/timer';
import { currentTimeZone, localDate } from '../domain/time';
import type { Client, LocalSession, ProfileId, Target, WorkItem } from '../domain/types';
import { latestOnly } from './latest';
import { openLedger, StorageError, type GlobalState, type Ledger, type Theme } from '../storage/ledger';

let ledgerPromise: Promise<Ledger> | null = null;
export function getLedger(): Promise<Ledger> {
  return (ledgerPromise ??= openLedger());
}

export function applyTheme(theme: Theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

export interface Snapshot {
  state: GlobalState;
  active: LocalSession | null;
  clients: Map<string, Client>;
  work: WorkItem[];
  favorites: string[];
  recents: string[];
  today: LocalSession[];
  /** All sessions of the active target, for local-unsubmitted budget totals. */
  activeTargetSessions: LocalSession[];
}

export function errorMessage(e: unknown): string {
  if (e instanceof StorageError) return `Not saved. ${APP.brand} could not write to local storage, so your last action was not recorded. (${e.message})`;
  if (e instanceof DomainError) return e.message;
  return `Something went wrong: ${(e as Error)?.message ?? String(e)}`;
}

async function load(l: Ledger): Promise<Snapshot> {
  const { state, active } = await l.active();
  const profile = state.profile;
  if (!profile) return { state, active, clients: new Map(), work: [], favorites: [], recents: [], today: [], activeTargetSessions: [] };
  const today = localDate(Date.now(), currentTimeZone());
  const [cat, favorites, recents, todays, activeTargetSessions] = await Promise.all([
    l.catalog(profile), l.favorites(profile), l.recentTargets(profile), l.sessionsByDate(profile, today, today),
    active ? l.sessionsForTarget(active.targetKey) : Promise.resolve([]),
  ]);
  return {
    state, active, favorites, recents, today: todays, activeTargetSessions,
    clients: new Map(cat.clients.map((c) => [c.key, c])), work: cat.work,
  };
}

export function useApp() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const latest = useRef(latestOnly());

  const reload = useCallback(async () => {
    const l = await getLedger();
    await latest.current(load(l), setSnap, (e) => setError(errorMessage(e)));
  }, []);

  useEffect(() => {
    let off = () => {};
    getLedger().then((l) => {
      setLedger(l);
      off = l.onChange(reload);
      reload();
    }, (e) => setError(errorMessage(e)));
    const vis = () => document.visibilityState === 'visible' && reload();
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('focus', reload);
    return () => { off(); document.removeEventListener('visibilitychange', vis); window.removeEventListener('focus', reload); };
  }, [reload]);

  useEffect(() => { if (snap) applyTheme(snap.state.theme); }, [snap?.state.theme]);

  /** Runs a ledger action, shows busy state, reports failures, never claims success early. */
  const act = useCallback(async (key: string, fn: (l: Ledger) => Promise<unknown>): Promise<boolean> => {
    const l = await getLedger();
    setBusy(key);
    try {
      await fn(l);
      setError(null);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(null);
      await reload();
    }
  }, [reload]);

  const startTarget = useCallback((target: Target, label: { client: string; work: string }, key: string) =>
    act(key, (l) => l.command({ opId: crypto.randomUUID(), type: 'start', input: { id: crypto.randomUUID(), target, label, timeZone: currentTimeZone() } })), [act]);
  const pauseActive = useCallback((id: string) => act('pause', (l) => l.command({ opId: crypto.randomUUID(), type: 'pause', sessionId: id })), [act]);
  const resumeActive = useCallback((id: string) => act('resume', (l) => l.command({ opId: crypto.randomUUID(), type: 'resume', sessionId: id })), [act]);
  const stopActive = useCallback((id: string) => act('stop', (l) => l.command({ opId: crypto.randomUUID(), type: 'stop', sessionId: id })), [act]);

  return { snap, ledger, error, setError, busy, act, reload, startTarget, pauseActive, resumeActive, stopActive };
}
export type AppApi = ReturnType<typeof useApp>;

/** Re-renders every `ms` while the page is visible; stops entirely while hidden. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | undefined;
    const run = () => {
      clearInterval(id);
      if (document.visibilityState === 'visible') { setNow(Date.now()); id = setInterval(() => setNow(Date.now()), ms); }
    };
    run();
    document.addEventListener('visibilitychange', run);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', run); };
  }, [ms]);
  return now;
}

export function openSidePanelFrom(windowId: number | undefined) {
  // Must run synchronously inside the click handler: an await before open() drops the user gesture.
  if (windowId !== undefined) return browser.sidePanel.open({ windowId });
  return Promise.reject(new Error('No browser window'));
}

export function openReview(date?: string) {
  browser.tabs.create({ url: browser.runtime.getURL(`/review.html${date ? `#${date}` : ''}`) });
}

export function openSettings() {
  browser.runtime.openOptionsPage();
}

export type { ProfileId };
