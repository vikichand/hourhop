// Domain compositions shared across surfaces: the timer card with its budget dial, the popup tracker,
// work tiles and rows with play / pause, the week chart and the mode status. Built only from the
// primitives in components.tsx.

import { useEffect, useState } from 'preact/hooks';
import { budgetHint, budgetView, type BudgetView } from '../domain/budget';
import { dialClock, LONG_SEGMENT_MS, minutesShort, short } from '../domain/time';
import { elapsedMs } from '../domain/timer';
import type { BudgetInfo, LocalSession, WorkItem } from '../domain/types';
import { PROVIDERS } from '../integrations/providers';
import { useNow, type AppApi } from './app-state';
import { Avatar, Button, Dial, Disclosure, IconButton, PlayButton, Ring, RoundControl, StatusText, TextField, WeekBars } from './components';
import type { Row } from './rows';
import { weekDays } from './week';

export function ModeStatus({ app }: { app: AppApi }) {
  const p = app.snap?.state.profile;
  if (!p) return null;
  return <StatusText kind={p === 'sample' ? 'sample' : 'local'} pill>{PROVIDERS[p].label}</StatusText>;
}

/** The work item behind the active session, if it is a catalog work item. */
function activeWork(app: AppApi, s: LocalSession): WorkItem | undefined {
  return s.target.kind === 'work-item' ? app.snap?.work.find((w) => w.key === (s.target as { workItemId: string }).workItemId) : undefined;
}

/** Budget view for the active session: recorded actuals from the source, local unsubmitted time kept separate. */
function useActiveBudget(app: AppApi, s: LocalSession): BudgetView {
  const now = useNow(60_000);
  const work = activeWork(app, s);
  const info: BudgetInfo = work?.budget ?? { kind: 'unavailable', reason: 'not-connected' };
  const localMs = (app.snap?.activeTargetSessions ?? [])
    // Sessions the user marked as entered in Karbon are already inside Karbon's recorded minutes.
    .filter((x) => x.submissionStatus === 'local-only' && !x.enteredInKarbonAtUtc)
    .reduce((t, x) => t + elapsedMs(x.id === s.id ? s : x, now), 0);
  return budgetView(info, Math.floor(localMs / 60_000), PROVIDERS[s.profileId].recordedLabel);
}

/** "3h" rather than "3h 00m" on the dial. */
const hm = (min: number) => minutesShort(min).replace(/ 00m$/, '');

/** First real time budget line drives the dial; anything else shows ticks only, never a fake arc. */
function dialFor(v: BudgetView, info: BudgetInfo | undefined): { ratio: number | null; over: boolean; sub: string; ends?: [string, string] } {
  const line = v.lines.find((l) => l.ratio !== undefined);
  const raw = info?.kind === 'set' ? info.lines.find((l) => l.kind === 'time' && l.estimateMinutes > 0) : undefined;
  if (!line || !raw || raw.kind !== 'time') return { ratio: null, over: v.lines.some((l) => l.level === 'over'), sub: v.state === 'set' ? v.summary : v.summary };
  return {
    ratio: line.ratio ?? null,
    over: line.level === 'over',
    sub: line.level === 'over' ? `${line.remaining} the ${hm(raw.estimateMinutes)} budget` : `${hm(raw.recordedMinutes)} of ${hm(raw.estimateMinutes)} budget`,
    ends: ['0h', hm(raw.estimateMinutes)],
  };
}

/** Ticks once per second while visible; only this subtree re-renders, so search focus and caret are untouched. */
export function TimerDisplay({ session }: { session: LocalSession }) {
  const now = useNow(session.status === 'running' ? 1000 : 60_000);
  return <span class="timer" role="timer" aria-label={`Elapsed ${short(elapsedMs(session, now))}`}>{dialClock(elapsedMs(session, now))}</span>;
}

function ClockWarnings({ session }: { session: LocalSession }) {
  useNow(60_000); // re-check every minute
  // Read the clock now, not a cached tick: a tick from before the session started would look like a reversal.
  const open = session.status === 'running' && session.runningSinceUtc ? Date.now() - Date.parse(session.runningSinceUtc) : 0;
  if (open > LONG_SEGMENT_MS) return <StatusText kind="review">Running over 8 hours. It will be flagged for review.</StatusText>;
  if (open < -2000) return <StatusText kind="review">Your clock moved backwards. This interval will be flagged for review.</StatusText>;
  return null;
}

function NoteEditor({ app, session, onDone }: { app: AppApi; session: LocalSession; onDone: () => void }) {
  const [text, setText] = useState(session.userNote ?? '');
  const [saved, setSaved] = useState(false);
  // No reset effect: effects run after paint, and a late one could wipe text typed in the meantime.
  // The parent keys this editor by session id, so a different session always mounts a fresh editor.
  const save = async () => {
    if (text === (session.userNote ?? '')) return;
    setSaved(await app.act('note', (l) => l.updateDetails(session.id, { userNote: text })));
  };
  return (
    <div class="stack">
      <TextField multiline label="Note (plain text)" value={text}
        onInput={(e) => { setText((e.currentTarget as { value: string }).value); setSaved(false); }} onBlur={save} />
      <div class="row">
        <Button size="sm" busy={app.busy === 'note'} onClick={save}>Save note</Button>
        <Button size="sm" variant="quiet" onClick={() => { save(); onDone(); }}>Done</Button>
        <span class="xs muted" role="status">{saved ? 'Note saved locally' : ''}</span>
      </div>
    </div>
  );
}

function useAnnounce(a: LocalSession | null) {
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    setAnnounce(!a ? 'No timer running' : a.status === 'running' ? `Tracking ${a.label.work}` : `Paused ${a.label.work}`);
  }, [a?.id, a?.status]);
  return <span class="vh" role="status" aria-live="polite">{announce}</span>;
}

/** Side panel timer card: target, budget dial, round controls, note, budget details. */
export function TrackingPanel({ app }: { app: AppApi }) {
  const a = app.snap?.active ?? null;
  const live = useAnnounce(a);
  const now = useNow(60_000);
  if (!a) {
    const today = (app.snap?.today ?? []).reduce((t, x) => t + elapsedMs(x, now), 0);
    return (
      <section class="glass tracking tracking-idle" aria-label="Current timer">
        <span class="idle-ring" aria-hidden="true">idle</span>
        <div class="grow">
          <p class="card-title">No timer running</p>
          <p class="small muted">Press play on any work item to start.{today > 0 ? ` Today so far: ${short(today)}.` : ''}</p>
        </div>
        {live}
      </section>
    );
  }
  return <ActiveCard app={app} a={a} live={live} />;
}

function ActiveCard({ app, a, live }: { app: AppApi; a: LocalSession; live: preact.JSX.Element }) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [details, setDetails] = useState(false);
  const v = useActiveBudget(app, a);
  const d = dialFor(v, activeWork(app, a)?.budget);
  const running = a.status === 'running';
  const firstLine = v.lines[0];
  return (
    <section class="glass tracking is-live" aria-label="Current timer">
      <div class="row">
        <Avatar name={a.label.client} />
        <div class="grow">
          <p class="client-name">{a.label.client}</p>
          <p class="work-title clamp-2" title={a.label.work}>{a.label.work}</p>
        </div>
      </div>
      <Dial ratio={d.ratio} tone={d.over ? 'over' : 'live'} ends={d.ends}>
        <StatusText kind={running ? 'running' : 'paused'}>{running ? 'Running' : 'Paused'}</StatusText>
        <TimerDisplay session={a} />
        <span class={`dial-sub${d.over ? ' over' : ''}`}>{d.sub}</span>
      </Dial>
      <ClockWarnings session={a} />
      <div class="controls">
        <RoundControl label="Note" ariaLabel={a.userNote ? 'Edit note' : 'Add note'} icon="note" onClick={() => setNoteOpen(!noteOpen)} />
        {running
          ? <RoundControl label="Pause" icon="pause" primary busy={app.busy === 'pause'} onClick={() => app.pauseActive(a.id)} />
          : <RoundControl label="Resume" icon="play" primary busy={app.busy === 'resume'} onClick={() => app.resumeActive(a.id)} />}
        <RoundControl label="Stop" icon="stop" busy={app.busy === 'stop'} onClick={() => app.stopActive(a.id)} />
      </div>
      {noteOpen && <NoteEditor key={a.id} app={app} session={a} onDone={() => setNoteOpen(false)} />}
      <div class="tracking-foot">
        <span>Saved on this device, not sent to Karbon</span>
        {firstLine && <span class={`num ${firstLine.level === 'over' ? 'over' : firstLine.level === 'near' ? 'warn' : ''}`}>{firstLine.remaining}</span>}
      </div>
      {v.state === 'set' && (
        <>
          <Disclosure expanded={details} onToggle={() => setDetails(!details)}>{details ? 'Hide budget details' : 'Budget details'}</Disclosure>
          {details && (
            <div class="budget-lines">
              {v.lines.map((l) => (
                <p key={l.title}><span class={l.level === 'over' ? 'over' : l.level === 'near' ? 'warn' : ''}>{l.title}</span>: {PROVIDERS[a.profileId].recordedLabel} {l.value}, {l.remaining}.{l.local ? ` ${l.local}.` : ''}{l.projected ? ` ${l.projected}.` : ''}</p>
              ))}
              <p>Recorded and local time are shown separately and never added together as official time. As of {v.asOf}.</p>
            </div>
          )}
        </>
      )}
      {live}
    </section>
  );
}

/** Popup timer: ring, target, the same live controls. */
export function PopupTracker({ app }: { app: AppApi }) {
  const a = app.snap?.active ?? null;
  const live = useAnnounce(a);
  if (!a) {
    return (
      <section class="glass tracking tracking-idle" aria-label="Current timer">
        <span class="idle-ring" aria-hidden="true">idle</span>
        <div class="grow"><p class="card-title">No timer running</p><p class="small muted">Open the work switcher to choose work.</p></div>
        {live}
      </section>
    );
  }
  return <PopupActive app={app} a={a} live={live} />;
}

function PopupActive({ app, a, live }: { app: AppApi; a: LocalSession; live: preact.JSX.Element }) {
  const v = useActiveBudget(app, a);
  const d = dialFor(v, activeWork(app, a)?.budget);
  const running = a.status === 'running';
  return (
    <section class="glass tracking" aria-label="Current timer">
      <div class="row" style={{ gap: 'var(--space-4)' }}>
        <Ring ratio={d.ratio}><TimerDisplay session={a} /></Ring>
        <div class="grow">
          <StatusText kind={running ? 'running' : 'paused'}>{running ? 'Running' : 'Paused'}</StatusText>
          <p class="client-name">{a.label.client}</p>
          <p class="work-title clamp-2" title={a.label.work}>{a.label.work}</p>
          <p class={`xs ${d.over ? 'over' : 'muted'}`}>{d.sub}</p>
        </div>
      </div>
      <div class="controls">
        {running
          ? <RoundControl label="Pause" icon="pause" primary busy={app.busy === 'pause'} onClick={() => app.pauseActive(a.id)} />
          : <RoundControl label="Resume" icon="play" primary busy={app.busy === 'resume'} onClick={() => app.resumeActive(a.id)} />}
        <RoundControl label="Stop" icon="stop" busy={app.busy === 'stop'} onClick={() => app.stopActive(a.id)} />
      </div>
      {live}
    </section>
  );
}

type ItemProps = {
  row: Row; active?: LocalSession; anyActive: boolean; favorite: boolean; todayMs: number; busy: boolean;
  onPlay: (row: Row) => void; onFavorite: (row: Row) => void;
};

function itemBits({ row, active, anyActive }: ItemProps) {
  const verb = !active ? (anyActive ? 'Switch' : 'Start') : active.status === 'running' ? 'Pause' : 'Resume';
  return { verb, label: `${verb}: ${row.client.name}, ${row.title}`, live: active?.status === 'running', hint: row.work ? budgetHint(row.work.budget) : undefined };
}

function Meta({ row, active, todayMs, hint }: { row: Row; active?: LocalSession; todayMs: number; hint?: string }) {
  return (
    <p class="meta">
      {active ? <span class="tag live">{active.status === 'running' ? 'Running' : 'Paused'}</span> : row.status && <span>{row.status}</span>}
      {!row.work && <span>Client-only time</span>}
      {row.work?.dueDate && <span>Due {row.work.dueDate}</span>}
      {hint && <span class={hint === 'Over budget' ? 'over' : hint === 'Near budget' ? 'warn' : ''}>{hint}</span>}
      {todayMs >= 60_000 && <span class="num">Today {short(todayMs)}</span>}
    </p>
  );
}

/** Recent and Favorites: one glass tile per work item, play / pause in the corner. */
export function WorkTile(p: ItemProps) {
  const b = itemBits(p);
  return (
    <li class={`glass tile${p.active ? ' is-active' : ''}`} data-key={p.row.key}>
      <div class="tile-top">
        <Avatar name={p.row.client.name} />
        <div class="row" style={{ gap: 'var(--space-1)' }}>
          <IconButton variant="plain" label={p.favorite ? `Remove ${p.row.title} from favorites` : `Add ${p.row.title} to favorites`}
            icon="star" filled={p.favorite} pressed={p.favorite} onClick={() => p.onFavorite(p.row)} />
          <PlayButton data-row-action="" label={b.label} live={b.live} busy={p.busy} onClick={() => p.onPlay(p.row)} />
        </div>
      </div>
      <p class="work-title clamp-2" title={p.row.title}>{p.row.title}</p>
      <p class="client-name" title={p.row.client.name}>{p.row.client.name}</p>
      <Meta row={p.row} active={p.active} todayMs={p.todayMs} hint={b.hint} />
    </li>
  );
}

/** Search results and All work: denser rows with the same controls. */
export function WorkRow(p: ItemProps) {
  const b = itemBits(p);
  return (
    <li class={`work-row${p.active ? ' is-active' : ''}`} data-key={p.row.key}>
      <Avatar name={p.row.client.name} />
      <div class="grow">
        <p class="work-title clamp-2" title={p.row.title}>{p.row.title}</p>
        <p class="client-name">{p.row.client.name}</p>
        <Meta row={p.row} active={p.active} todayMs={p.todayMs} hint={b.hint} />
      </div>
      <IconButton variant="plain" label={p.favorite ? `Remove ${p.row.title} from favorites` : `Add ${p.row.title} to favorites`}
        icon="star" filled={p.favorite} pressed={p.favorite} onClick={() => p.onFavorite(p.row)} />
      <PlayButton data-row-action="" label={b.label} live={b.live} busy={p.busy} onClick={() => p.onPlay(p.row)} />
    </li>
  );
}

/** This week's local totals, today lit. */
export function WeekCard({ app }: { app: AppApi }) {
  const now = useNow(60_000);
  const s = app.snap!;
  const days = weekDays(s.week, s.active, now);
  const total = days.reduce((t, d) => t + d.ms, 0);
  return (
    <section class="glass card week" aria-label="This week">
      <div class="row">
        <h2 class="card-title grow">This week</h2>
        <span class="small muted num">{short(total)}</span>
      </div>
      <WeekBars label="Hours recorded locally this week" days={days.map((d) => ({ label: d.label, ms: d.ms, today: d.today, value: short(d.ms) }))} />
    </section>
  );
}
