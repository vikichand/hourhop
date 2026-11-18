import { APP } from '../../app-meta';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { copyText } from '../../domain/export';
import { allocateByLocalDate, currentTimeZone, localDate, short } from '../../domain/time';
import { elapsedMs } from '../../domain/timer';
import type { LocalSession } from '../../domain/types';
import type { AuditRecord } from '../../storage/ledger';
import { useApp, useNow, type AppApi } from '../app-state';
import { AppHeader, Banner, Button, Dialog, EmptyState, FilterGroup, Select, StatusText, TextField } from '../components';
import { ModeStatus } from '../parts';
import { downloadExport } from './export-download';

type Period = 'today' | 'yesterday' | 'week' | 'custom';
const DAY = 86_400_000;

function range(p: Period, custom: string): [string, string] {
  const tz = currentTimeZone();
  const today = localDate(Date.now(), tz);
  if (p === 'today') return [today, today];
  if (p === 'yesterday') { const y = localDate(Date.now() - DAY, tz); return [y, y]; }
  if (p === 'week') return [localDate(Date.now() - 6 * DAY, tz), today];
  return [custom || today, custom || today];
}

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
/** datetime-local value in the browser's zone, to the second. */
const toLocalInput = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 19);

export function Review() {
  const app = useApp();
  const s = app.snap;
  const hashDate = location.hash.slice(1);
  const [period, setPeriod] = useState<Period>(/^\d{4}-\d{2}-\d{2}$/.test(hashDate) ? 'custom' : 'today');
  const [custom, setCustom] = useState(/^\d{4}-\d{2}-\d{2}$/.test(hashDate) ? hashDate : localDate(Date.now(), currentTimeZone()));
  const [sessions, setSessions] = useState<LocalSession[] | null>(null);
  const [editing, setEditing] = useState<LocalSession | null>(null);
  const [notice, setNotice] = useState('');
  const now = useNow(30_000);
  const [from, to] = range(period, custom);

  useEffect(() => {
    let stale = false;
    if (!s?.state.profile) return;
    app.ledger?.sessionsByDate(s.state.profile, from, to).then((x) => { if (!stale) setSessions(x); }, (e) => app.setError(String(e)));
    return () => { stale = true; };
  }, [s, from, to]);

  const groups = useMemo(() => {
    const m = new Map<string, LocalSession[]>();
    for (const x of sessions ?? []) m.set(x.targetKey, [...(m.get(x.targetKey) ?? []), x]);
    return [...m.values()].map((list) => list.sort((a, b) => a.startedAtUtc.localeCompare(b.startedAtUtc)))
      .sort((a, b) => a[0]!.label.client.localeCompare(b[0]!.label.client) || a[0]!.label.work.localeCompare(b[0]!.label.work));
  }, [sessions]);

  if (!s) return <p class="pad muted" role="status">Loading…</p>;
  const live = (x: LocalSession) => (s.active?.id === x.id ? s.active : x);
  const total = (sessions ?? []).reduce((t, x) => t + elapsedMs(live(x), now), 0);
  const review = (sessions ?? []).filter((x) => x.status === 'needs-review').length;

  return (
    <div class="shell shell-page">
      <AppHeader title={`${APP.brand} review`} status={<ModeStatus app={app} />} />
      {app.error && <Banner tone="error" onDismiss={() => app.setError(null)}>{app.error}</Banner>}
      {notice && <Banner tone="info" onDismiss={() => setNotice('')}>{notice}</Banner>}
      <main class="stack pad">
        <Banner tone="warning">
          This is local time only. Nothing here has been sent to Karbon. Enter it in Karbon yourself (use "Copy for Karbon"),
          and check Karbon's own timer is not also recording the same work.
        </Banner>
        {!s.state.profile ? <EmptyState title="Choose a data mode first">Open the {APP.brand} side panel to get started.</EmptyState> : <>
          <div class="row wrap">
            <FilterGroup<Period> label="Period" value={period} onChange={setPeriod} options={[
              { id: 'today', label: 'Today' }, { id: 'yesterday', label: 'Yesterday' }, { id: 'week', label: 'Last 7 days' }, { id: 'custom', label: 'Pick a date' },
            ]} />
            {period === 'custom' && <div><TextField label="Date" type="date" value={custom} onInput={(e) => setCustom((e.currentTarget as HTMLInputElement).value)} /></div>}
          </div>
          <div class="totals" aria-label="Totals">
            <div class="total"><span class="small muted">Recorded locally</span><strong>{short(total)}</strong></div>
            <div class="total"><span class="small muted">Sessions</span><strong>{sessions?.length ?? 0}</strong></div>
            <div class="total"><span class="small muted">Need review</span><strong>{review}</strong></div>
            <div class="total"><span class="small muted">Confirmed in Karbon</span><strong>Not connected</strong></div>
          </div>
          <div class="row wrap">
            <Button size="sm" onClick={async () => setNotice(await downloadExport(s.state.profile!, 'csv'))}>Export all as CSV</Button>
            <Button size="sm" onClick={async () => setNotice(await downloadExport(s.state.profile!, 'json'))}>Export all as JSON</Button>
            <span class="xs muted">Exports every session in this data mode, one CSV row per interval.</span>
          </div>
          {sessions && !groups.length && <EmptyState title="No time recorded for this period" />}
          {groups.map((list) => {
            const first = list[0]!;
            const sum = list.reduce((t, x) => t + elapsedMs(live(x), now), 0);
            return (
              <section class="group" key={first.targetKey} aria-label={`${first.label.client}, ${first.label.work}`}>
                <div class="group-head">
                  <div class="grow">
                    <p class="client-name">{first.label.client}</p>
                    <h2 class="work-title">{first.label.work}</h2>
                  </div>
                  <strong class="num">{short(sum)}</strong>
                </div>
                {list.map((x) => <SessionRow key={x.id} app={app} session={live(x)} now={now} onEdit={() => setEditing(x)} onCopied={setNotice} />)}
              </section>
            );
          })}
        </>}
      </main>
      {editing && <EditDialog app={app} session={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SessionRow({ app, session: x, now, onEdit, onCopied }: { app: AppApi; session: LocalSession; now: number; onEdit: () => void; onCopied: (m: string) => void }) {
  const isActive = x.status === 'running' || x.status === 'paused';
  const count = x.segments.length + (x.status === 'running' ? 1 : 0);
  // Intervals crossing local midnight are attributed to each date (KWS-006), in the zone they were recorded in.
  const byDate = new Map<string, number>();
  for (const g of x.segments)
    for (const [d, ms] of allocateByLocalDate(Date.parse(g.startedAtUtc), Date.parse(g.endedAtUtc), x.timeZone)) byDate.set(d, (byDate.get(d) ?? 0) + ms);
  const reasons = (x.reviewReasons ?? []).map((r) => (r === 'clock-reversal' ? 'clock moved backwards' : 'interval over 8 hours')).join(', ');
  return (
    <div class="session-row">
      <div class="grow stack-tight">
        <p class="num">
          {x.segments.map((g) => `${time(g.startedAtUtc)}–${time(g.endedAtUtc)}`).join(', ')}
          {x.status === 'running' && `${x.segments.length ? ', ' : ''}${time(x.runningSinceUtc!)}–now`}
          <span class="muted"> · {x.dateLocal} · {count} {count === 1 ? 'interval' : 'intervals'}</span>
        </p>
        <div class="row wrap">
          {x.status === 'running' && <StatusText kind="running">Running</StatusText>}
          {x.status === 'paused' && <StatusText kind="paused">Paused</StatusText>}
          {x.status === 'needs-review' && <StatusText kind="review">Needs review: {reasons}</StatusText>}
          <StatusText kind="local">Local only</StatusText>
          {x.billableIntent !== 'unknown' && <span class="xs muted">{x.billableIntent === 'billable' ? 'Billable' : 'Non-billable'}</span>}
          {x.roleName && <span class="xs muted">Role: {x.roleName}</span>}
          {x.taskTypeName && <span class="xs muted">Task type: {x.taskTypeName}</span>}
        </div>
        {byDate.size > 1 && <p class="xs muted">Spans {byDate.size} dates: {[...byDate].map(([d, ms]) => `${d} ${short(ms)}`).join(' · ')}</p>}
        {x.userNote && <p class="note">{x.userNote}</p>}
      </div>
      <strong class="num">{short(elapsedMs(x, now))}</strong>
      <div class="row">
        <Button size="sm" variant="quiet" onClick={async () => {
          try { await navigator.clipboard.writeText(copyText(x)); onCopied('Copied. Paste it into Karbon\'s time entry form.'); }
          catch { app.setError('Copy failed. Your browser blocked clipboard access.'); }
        }} aria-label={`Copy for Karbon: ${x.label.work}`}>Copy for Karbon</Button>
        <Button size="sm" variant="secondary" inert={isActive} onClick={onEdit}
          aria-label={isActive ? 'Stop the timer to edit this session' : `Edit session: ${x.label.work}`}>Edit</Button>
      </div>
    </div>
  );
}

function EditDialog({ app, session, onClose }: { app: AppApi; session: LocalSession; onClose: () => void }) {
  const [segs, setSegs] = useState(session.segments.map((g) => ({ start: toLocalInput(Date.parse(g.startedAtUtc)), end: toLocalInput(Date.parse(g.endedAtUtc)) })));
  const [note, setNote] = useState(session.userNote ?? '');
  const [role, setRole] = useState(session.roleName ?? '');
  const [task, setTask] = useState(session.taskTypeName ?? '');
  const [billable, setBillable] = useState(session.billableIntent);
  const [reason, setReason] = useState('');
  const [splitAt, setSplitAt] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [history, setHistory] = useState<AuditRecord[]>([]);
  const [err, setErr] = useState('');
  useEffect(() => { app.ledger?.audit(session.id).then(setHistory); }, [session.id]);

  // The inputs show whole seconds. Only fields the user changed are sent; untouched ones keep their
  // exact stored milliseconds, so an edit never shifts a boundary onto the neighbouring session.
  const edits = segs.flatMap((g, index) => {
    const orig = session.segments[index]!;
    const os = Date.parse(orig.startedAtUtc), oe = Date.parse(orig.endedAtUtc);
    const startMs = g.start === toLocalInput(os) ? os : new Date(g.start).getTime();
    const endMs = g.end === toLocalInput(oe) ? oe : new Date(g.end).getTime();
    return startMs === os && endMs === oe ? [] : [{ index, startMs, endMs }];
  });
  const timesChanged = edits.length > 0;
  const needReason = () => { if (!reason.trim()) { setErr('Enter a reason for this correction. It is kept in the edit history.'); return true; } return false; };

  const save = async () => {
    setErr('');
    if (timesChanged && needReason()) return;
    const ok = await app.act('edit', async (l) => {
      await l.updateDetails(session.id, { userNote: note, roleName: role.trim() || undefined, taskTypeName: task.trim() || undefined, billableIntent: billable });
      if (timesChanged) await l.editTimes(session.id, edits, reason);
    });
    if (ok) onClose();
  };

  return (
    <Dialog open title="Edit session" onClose={onClose} actions={<>
      <Button variant="danger" onClick={() => { setErr(''); if (!needReason()) setConfirmDiscard(true); }}>Discard…</Button>
      {session.status === 'needs-review' && (
        <Button variant="secondary" busy={app.busy === 'accept'} onClick={async () => {
          setErr('');
          if (needReason()) return;
          if (await app.act('accept', (l) => l.acceptReview(session.id, reason))) onClose();
        }}>Keep as recorded</Button>
      )}
      <div class="grow" />
      <Button variant="quiet" onClick={onClose}>Cancel</Button>
      <Button variant="primary" busy={app.busy === 'edit'} onClick={save}>Save</Button>
    </>}>
      <p class="small"><strong>{session.label.work}</strong> <span class="muted">· {session.label.client}</span></p>
      <p class="xs muted">Times use your current time zone ({currentTimeZone()}). Recorded in {session.timeZone}.</p>
      {segs.map((g, i) => (
        <div class="seg-grid" key={i}>
          <TextField label={`Interval ${i + 1} start`} type="datetime-local" step={1} value={g.start}
            onInput={(e) => setSegs(segs.map((x, j) => (j === i ? { ...x, start: (e.currentTarget as HTMLInputElement).value } : x)))} />
          <TextField label={`Interval ${i + 1} end`} type="datetime-local" step={1} value={g.end}
            onInput={(e) => setSegs(segs.map((x, j) => (j === i ? { ...x, end: (e.currentTarget as HTMLInputElement).value } : x)))} />
        </div>
      ))}
      <TextField multiline label="Note (plain text)" value={note} onInput={(e) => setNote((e.currentTarget as { value: string }).value)} />
      <div class="row wrap">
        <TextField label="Role" value={role} onInput={(e) => setRole((e.currentTarget as HTMLInputElement).value)} />
        <TextField label="Task type" value={task} onInput={(e) => setTask((e.currentTarget as HTMLInputElement).value)} />
        <Select label="Billable" value={billable} onChange={setBillable}
          options={[{ value: 'unknown', label: 'Not set' }, { value: 'billable', label: 'Billable' }, { value: 'nonbillable', label: 'Non-billable' }]} />
      </div>
      <TextField label="Reason for time change, split or discard" value={reason} onInput={(e) => setReason((e.currentTarget as HTMLInputElement).value)}
        hint="Required when you change times. Note, role and task type edits don't need one." />
      <div class="seg-grid">
        <TextField label="Split into two sessions at" type="datetime-local" step={1} value={splitAt} onInput={(e) => setSplitAt((e.currentTarget as HTMLInputElement).value)} />
        <Button size="sm" onClick={async () => {
          setErr('');
          if (!splitAt) return setErr('Choose a split time.');
          if (needReason()) return;
          if (await app.act('split', (l) => l.split(session.id, new Date(splitAt).getTime(), crypto.randomUUID(), reason))) onClose();
        }}>Split</Button>
      </div>
      {err && <p class="small status-error" role="alert">{err}</p>}
      {history.length > 0 && (
        <details>
          <summary class="small">Edit history ({history.length})</summary>
          <ul class="xs muted">
            {history.map((h) => <li key={h.id}>{new Date(h.atUtc).toLocaleString()}: {h.action}, "{h.reason}" (was {short(h.before.segments.reduce((t, g) => t + g.elapsedMs, 0))})</li>)}
          </ul>
        </details>
      )}
      <Dialog open={confirmDiscard} title="Discard this session?" onClose={() => setConfirmDiscard(false)} actions={<>
        <Button variant="quiet" onClick={() => setConfirmDiscard(false)}>Keep it</Button>
        <Button variant="danger" onClick={async () => { if (await app.act('discard', (l) => l.discard(session.id, reason))) { setConfirmDiscard(false); onClose(); } }}>Discard session</Button>
      </>}>
        <p>The session is removed from totals and exports. A copy stays in the local edit history with your reason.</p>
      </Dialog>
    </Dialog>
  );
}
