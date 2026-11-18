// Domain compositions shared across surfaces: TimerDisplay, TrackingPanel, BudgetSummary, WorkRow,
// ModeStatus. Built only from the primitives in components.tsx.

import { useEffect, useState } from 'preact/hooks';
import { budgetHint, budgetView } from '../domain/budget';
import { clock, LONG_SEGMENT_MS, short } from '../domain/time';
import { elapsedMs } from '../domain/timer';
import type { LocalSession, WorkItem } from '../domain/types';
import { PROVIDERS } from '../integrations/providers';
import { useNow, type AppApi } from './app-state';
import { Button, Disclosure, IconButton, Meter, StatusText, TextField } from './components';
import type { Row } from './rows';

/** Ticks once per second while visible; only this subtree re-renders, so search focus and caret are untouched. */
export function TimerDisplay({ session }: { session: LocalSession }) {
  const now = useNow(session.status === 'running' ? 1000 : 60_000);
  const open = session.status === 'running' && session.runningSinceUtc ? now - Date.parse(session.runningSinceUtc) : 0;
  return (
    <>
      <span class="timer" role="timer" aria-label={`Elapsed ${short(elapsedMs(session, now))}`}>{clock(elapsedMs(session, now))}</span>
      {open > LONG_SEGMENT_MS && <StatusText kind="review">Running over 8 hours. It will be flagged for review.</StatusText>}
      {open < 0 && <StatusText kind="review">Your clock moved backwards. This interval will be flagged for review.</StatusText>}
    </>
  );
}

export function ModeStatus({ app }: { app: AppApi }) {
  const p = app.snap?.state.profile;
  if (!p) return null;
  return <StatusText kind={p === 'sample' ? 'sample' : 'local'} pill>{PROVIDERS[p].label}</StatusText>;
}

function NoteEditor({ app, session }: { app: AppApi; session: LocalSession }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(session.userNote ?? '');
  const [saved, setSaved] = useState(false);
  useEffect(() => { setText(session.userNote ?? ''); setSaved(false); }, [session.id]);
  const save = async () => {
    if (text === (session.userNote ?? '')) return;
    const ok = await app.act('note', (l) => l.updateDetails(session.id, { userNote: text }));
    setSaved(ok);
  };
  if (!open) {
    return (
      <Disclosure expanded={false} onToggle={() => setOpen(true)}>{session.userNote ? 'Edit note' : 'Add note'}</Disclosure>
    );
  }
  return (
    <div class="stack">
      <TextField multiline label="Note (plain text)" value={text}
        onInput={(e) => { setText((e.currentTarget as { value: string }).value); setSaved(false); }} onBlur={save} />
      <div class="row">
        <Button size="sm" variant="secondary" busy={app.busy === 'note'} onClick={save}>Save note</Button>
        <Button size="sm" variant="quiet" onClick={() => { save(); setOpen(false); }}>Done</Button>
        <span class="xs muted" role="status">{saved ? 'Note saved locally' : ''}</span>
      </div>
    </div>
  );
}

/** Active session card. `compact` is the popup variant (no note editor, no budget). */
export function TrackingPanel({ app, compact }: { app: AppApi; compact?: boolean }) {
  const a = app.snap?.active ?? null;
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    setAnnounce(!a ? 'No timer running' : a.status === 'running' ? `Tracking ${a.label.work}` : `Paused ${a.label.work}`);
  }, [a?.id, a?.status]);

  const live = <span class="vh" role="status" aria-live="polite">{announce}</span>;
  if (!a) {
    return (
      <section class="tracking tracking-idle" aria-label="Current timer">
        <div class="grow">
          <p><strong>No timer running</strong></p>
          <p class="small muted">{compact ? 'Open the work switcher to choose work.' : 'Choose a work item below to start.'}</p>
        </div>
        {live}
      </section>
    );
  }
  const running = a.status === 'running';
  return (
    <section class={`tracking${running ? '' : ' tracking-paused'}`} aria-label="Current timer">
      <div class="row">
        <span class="eyebrow">Tracking now</span>
        <StatusText kind={running ? 'running' : 'paused'}>{running ? 'Running' : 'Paused'}</StatusText>
      </div>
      <p class="client-name">{a.label.client}</p>
      <p class="work-title clamp-2" title={a.label.work}>{a.label.work}</p>
      <TimerDisplay session={a} />
      <div class="controls">
        {running
          ? <Button variant="primary" busy={app.busy === 'pause'} onClick={() => app.pauseActive(a.id)}>Pause</Button>
          : <Button variant="primary" busy={app.busy === 'resume'} onClick={() => app.resumeActive(a.id)}>Resume</Button>}
        <Button variant="secondary" busy={app.busy === 'stop'} onClick={() => app.stopActive(a.id)}>Stop</Button>
      </div>
      {!compact && <ActiveBudget app={app} session={a} />}
      {!compact && <NoteEditor app={app} session={a} />}
      <p class="xs muted">
        <StatusText kind="local">Saved locally</StatusText> Not sent to Karbon. Karbon's own timer is separate, so don't run both.
      </p>
      {live}
    </section>
  );
}

function ActiveBudget({ app, session }: { app: AppApi; session: LocalSession }) {
  const now = useNow(60_000);
  const work = session.target.kind === 'work-item' ? app.snap?.work.find((w) => w.key === (session.target as { workItemId: string }).workItemId) : undefined;
  if (!work) return null;
  const localMs = (app.snap?.activeTargetSessions ?? [])
    .filter((s) => s.submissionStatus === 'local-only')
    .reduce((t, s) => t + elapsedMs(s.id === session.id ? session : s, now), 0);
  return <BudgetSummary work={work} localMinutes={Math.floor(localMs / 60_000)} recordedLabel={PROVIDERS[session.profileId].recordedLabel} />;
}

export function BudgetSummary({ work, localMinutes, recordedLabel }: { work: WorkItem; localMinutes: number; recordedLabel: string }) {
  const [open, setOpen] = useState(false);
  const v = budgetView(work.budget, localMinutes, recordedLabel);
  if (v.state !== 'set') {
    return <p class="small muted">{v.summary}{v.asOf ? ` · as of ${v.asOf}` : ''}</p>;
  }
  return (
    <div class="budget">
      {v.lines.map((l) => (
        <div key={l.title} class="stack-tight">
          <div class="budget-line">
            <span>{l.title} <span class="num">{l.value}</span></span>
            <span class={`num level-${l.level}`}>{l.remaining}</span>
          </div>
          {l.ratio !== undefined && <Meter ratio={l.ratio} level={l.level} />}
        </div>
      ))}
      <Disclosure expanded={open} onToggle={() => setOpen(!open)}>{open ? 'Hide budget details' : 'Budget details'}</Disclosure>
      {open && (
        <div class="xs muted stack-tight">
          {v.lines.map((l) => (
            <p key={l.title}>{l.title}: {recordedLabel} {l.value}.{l.local ? ` ${l.local}.` : ''}{l.projected ? ` ${l.projected}.` : ''}</p>
          ))}
          <p>Recorded and local time are shown separately and never added together as official time. As of {v.asOf}.</p>
        </div>
      )}
    </div>
  );
}

export function WorkRow({ row, active, anyActive, favorite, todayMs, busy, onStart, onFavorite }: {
  row: Row; active?: LocalSession; anyActive: boolean; favorite: boolean; todayMs: number; busy: boolean;
  onStart: (row: Row) => void; onFavorite: (row: Row) => void;
}) {
  const isActive = !!active;
  const hint = row.work ? budgetHint(row.work.budget) : undefined;
  const label = !active ? (anyActive ? 'Switch' : 'Start') : active.status === 'running' ? 'Tracking' : 'Resume';
  return (
    <li class={`work-row${isActive ? ' is-active' : ''}`} data-key={row.key}>
      <div class="grow">
        <p class="client-name">{row.client.name}</p>
        <p class="work-title clamp-2" title={row.title}>{row.title}</p>
        <p class="meta">
          {row.status && <span>{row.status}</span>}
          {!row.work && <span>Client-only time</span>}
          {row.work?.dueDate && <span>Due {row.work.dueDate}</span>}
          {hint && <span>{hint}</span>}
          {todayMs > 0 && <span class="num">Today {short(todayMs)}</span>}
        </p>
      </div>
      <IconButton label={favorite ? `Remove ${row.title} from favorites` : `Add ${row.title} to favorites`}
        icon="star" filled={favorite} pressed={favorite} onClick={() => onFavorite(row)} />
      <Button size="sm" variant={isActive ? 'quiet' : 'secondary'} busy={busy} inert={active?.status === 'running'}
        data-row-action="" aria-label={`${label}: ${row.client.name}, ${row.title}`} onClick={() => onStart(row)}>
        {label}
      </Button>
    </li>
  );
}
