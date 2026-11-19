import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { elapsedMs } from '../../domain/timer';
import { WORK_STATUSES, type Client, type ClientKind, type WorkItem, type WorkStatus } from '../../domain/types';
import { PROVIDERS } from '../../integrations/providers';
import { sampleCatalog } from '../../integrations/sample';
import { APP } from '../../app-meta';
import { openReview, openSettings, useApp, useNow, type AppApi } from '../app-state';
import { AppHeader, Banner, Button, Dialog, EmptyState, FilterGroup, Icon, IconButton, PlayButton, Ring, SearchBox, Select, TextField } from '../components';
import { ModeStatus, TrackingPanel, WeekCard, WorkRow, WorkTile } from '../parts';
import { buildRows, matchesStatus, search, type Row, type StatusFilter } from '../rows';
import { loadKarbonBudgets, refreshKarbon } from '../../integrations/karbon-sync';

const PAGE = 50; // bounded DOM: at most PAGE items rendered until the user asks for more (KWS-029)

export function SidePanel() {
  const app = useApp();
  const s = app.snap;
  return (
    <div class="shell room">
      <AppHeader status={<ModeStatus app={app} />}>
        <IconButton label="Settings" icon="settings" onClick={openSettings} />
      </AppHeader>
      {app.error && <Banner tone="error" onDismiss={() => app.setError(null)}>{app.error}</Banner>}
      {!s ? <p class="muted" role="status">Loading…</p>
        : !s.state.profile ? <Onboarding app={app} />
        : <>
            {s.state.profile === 'karbon' && <KarbonBar app={app} />}
            <TrackingPanel app={app} />
            <Switcher app={app} />
            <WeekCard app={app} />
          </>}
    </div>
  );
}

/** Sync status for Karbon mode, automatic refresh when stale, and lazy budgets for what is on screen. */
function KarbonBar({ app }: { app: AppApi }) {
  const s = app.snap!;
  const k = s.karbon;
  const [syncing, setSyncing] = useState(false);
  const refresh = async (force: boolean) => {
    const l = app.ledger;
    if (!l) return;
    setSyncing(true);
    try {
      await refreshKarbon(l, { force });
    } catch {
      // The reason is stored on the connection and shown below; the last good work list stays.
    } finally {
      setSyncing(false);
    }
  };
  useEffect(() => { refresh(false); }, [app.ledger]);
  // Budgets for the active item and the first visible recent and favorite items only.
  const want = [
    ...(s.active?.target.kind === 'work-item' && s.active.profileId === 'karbon' ? [s.active.target.workItemId] : []),
    ...s.recents.slice(0, 8).map((key) => key.split(':').pop()!),
    ...s.favorites.slice(0, 4).map((key) => key.split(':').pop()!),
  ].join(',');
  useEffect(() => {
    if (app.ledger && want) loadKarbonBudgets(app.ledger, want.split(',')).catch(() => undefined);
  }, [app.ledger, want]);
  if (!k.connected) {
    return <Banner tone="warning">Karbon is disconnected. Reconnect in Settings to refresh your work. Your recorded time is still here.</Banner>;
  }
  const at = k.lastSyncUtc ? new Date(k.lastSyncUtc).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : 'never';
  return (
    <>
      <div class="row small muted">
        <span class="grow" role="status">{syncing ? 'Refreshing from Karbon…' : `Synced from Karbon at ${at}. Read-only.`}</span>
        <IconButton variant="plain" label="Refresh from Karbon" icon="refresh" onClick={() => refresh(true)} aria-busy={syncing || undefined} />
      </div>
      {k.lastError && <Banner tone="warning">Couldn't refresh from Karbon: {k.lastError} Showing your work as of {at}.</Banner>}
    </>
  );
}

export function Onboarding({ app }: { app: AppApi }) {
  const choose = (p: 'sample' | 'local') =>
    app.act(`mode-${p}`, async (l) => {
      if (p === 'sample' && !(await l.catalog('sample')).work.length) {
        const c = sampleCatalog(Date.now());
        await l.seedCatalog(c.clients, c.work);
      }
      await l.setProfile(p);
    });
  return (
    <section class="glass card centered" aria-labelledby="ob-title">
      <Ring ratio={null}>0:00</Ring>
      <h1 id="ob-title" class="page-title">{APP.tagline}</h1>
      <p class="muted">One timer for all your client work. Jump to another job in one tap; every minute is kept for review and export.</p>
      <ul class="tiles full">
        <li class="glass tile">
          <div class="tile-top"><span class="avatar" aria-hidden="true"><Icon name="list" /></span>
            <PlayButton label="Track locally" live={false} busy={app.busy === 'mode-local'} onClick={() => choose('local')} /></div>
          <p class="work-title">Track locally</p><p class="xs muted">{PROVIDERS.local.description}</p>
        </li>
        <li class="glass tile">
          <div class="tile-top"><span class="avatar" aria-hidden="true"><Icon name="hop" /></span>
            <PlayButton label="Connect Karbon" live={false} onClick={() => openSettings()} /></div>
          <p class="work-title">Connect Karbon</p><p class="xs muted">Pull in the work assigned to you, read-only. Needs your firm's Karbon API keys.</p>
        </li>
        <li class="glass tile">
          <div class="tile-top"><span class="avatar" aria-hidden="true"><Icon name="star" /></span>
            <PlayButton label="Try sample data" live={false} busy={app.busy === 'mode-sample'} onClick={() => choose('sample')} /></div>
          <p class="work-title">Try sample data</p><p class="xs muted">{PROVIDERS.sample.description}</p>
        </li>
      </ul>
      <p class="xs dim">
        Your time is stored only in this browser profile. Without Karbon keys {APP.brand} makes no network requests; with them it
        only reads your assigned work from Karbon's official API and never writes to Karbon. {APP.nonAffiliation}
      </p>
    </section>
  );
}

type Tab = 'recent' | 'favorites' | 'all';

function Switcher({ app }: { app: AppApi }) {
  const s = app.snap!;
  const profile = s.state.profile!;
  const rows = useMemo(() => buildRows(s.clients, s.work), [s.clients, s.work]);
  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab | null>(null);
  const [status, setStatus] = useState<StatusFilter>('open');
  const [limit, setLimit] = useState(PAGE);
  const [confirm, setConfirm] = useState<Row | null>(null);
  const [adding, setAdding] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const now = useNow(60_000);

  const effectiveTab: Tab = tab ?? (s.recents.length ? 'recent' : 'all');
  const fav = useMemo(() => new Set(s.favorites), [s.favorites]);
  const searching = !!query.trim();

  let shown: Row[];
  if (searching) shown = search(rows, query).filter((r) => matchesStatus(r, status));
  else if (effectiveTab === 'recent') shown = s.recents.map((k) => byKey.get(k)).filter((r): r is Row => !!r);
  else if (effectiveTab === 'favorites') shown = rows.filter((r) => fav.has(r.key));
  else shown = rows.filter((r) => matchesStatus(r, status));
  // Recent and Favorites are short lists shown as tiles; search results and All work are dense rows.
  const asTiles = !searching && effectiveTab !== 'all';

  const todayByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of s.today) {
      const live = s.active?.id === x.id ? s.active : x;
      m.set(x.targetKey, (m.get(x.targetKey) ?? 0) + elapsedMs(live, now));
    }
    return m;
  }, [s.today, s.active, now]);

  useEffect(() => setLimit(PAGE), [query, effectiveTab, status]);

  // "/" focuses search from anywhere except a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && !document.querySelector('dialog[open]')) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const actions = () => [...(listRef.current?.querySelectorAll<HTMLElement>('[data-row-action]') ?? [])];
  const onSearchKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); actions()[0]?.focus(); }
    if (e.key === 'Escape' && query) { e.preventDefault(); setQuery(''); }
  };
  const onListKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const list = actions();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    if (e.key === 'ArrowUp' && i === 0) return searchRef.current?.focus();
    list[Math.min(list.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  };

  /** Play on another item switches; on the live item it pauses; on the paused item it resumes. */
  const play = (r: Row) => {
    const a = s.active;
    if (a?.targetKey === r.key) return a.status === 'running' ? app.pauseActive(a.id) : app.resumeActive(a.id);
    if (r.status === 'Completed') return setConfirm(r);
    app.startTarget(r.target, { client: r.client.name, work: r.title }, r.key);
  };

  const heading = searching ? `${shown.length} ${shown.length === 1 ? 'result' : 'results'}` : `${shown.length} ${effectiveTab === 'recent' ? 'recent' : effectiveTab === 'favorites' ? 'favorite' : 'work'} ${shown.length === 1 ? 'item' : 'items'}`;
  const Item = asTiles ? WorkTile : WorkRow;

  return (
    <section class="stack" aria-label="Work switcher">
      <SearchBox label="Search clients and work items" value={query} onInput={setQuery} onKeyDown={onSearchKey} inputRef={searchRef} />
      <FilterGroup label="Show" value={effectiveTab} onChange={(t) => { setTab(t); setQuery(''); }} options={[
        { id: 'recent', label: 'Recent' }, { id: 'favorites', label: 'Favorites' }, { id: 'all', label: 'All work' },
      ]} />
      {(effectiveTab === 'all' || searching) && (
        <Select label="Status" value={status} onChange={setStatus} options={[
          { value: 'open', label: 'Open (not completed)' }, { value: 'actionable', label: 'Ready to start or in progress' },
          { value: 'completed', label: 'Completed' }, { value: 'all', label: 'All statuses' },
        ]} />
      )}
      <p class="list-group" aria-live="polite">{heading}</p>
      {shown.length === 0 ? (
        <div class="glass round-sm">
          {searching ? <EmptyState title="No matches">Try a client name or part of a work title.</EmptyState>
          : effectiveTab === 'recent' ? <EmptyState title="No recent work yet" action={<Button size="sm" onClick={() => setTab('all')}>Browse all work</Button>}>Work you track appears here.</EmptyState>
          : effectiveTab === 'favorites' ? <EmptyState title="No favorites yet">Use the star on any work item to pin it here.</EmptyState>
          : profile === 'karbon' && !rows.length ? <EmptyState title="No open work assigned to you in Karbon">
              {s.karbon.email ? `Karbon has no open work items assigned to ${s.karbon.email}.` : ''} Use Refresh after work is assigned to you.
            </EmptyState>
          : <EmptyState title="No work items yet" action={PROVIDERS[profile].canEditCatalog && <Button size="sm" variant="primary" onClick={() => setAdding(true)}>Add work item</Button>}>
              {PROVIDERS[profile].canEditCatalog ? 'Add the clients and work items you track time against.' : 'Nothing matches this status filter.'}
            </EmptyState>}
        </div>
      ) : (
        <ul class={asTiles ? 'tiles' : 'glass rows'} ref={listRef} onKeyDown={onListKey} aria-label="Work items">
          {shown.slice(0, limit).map((r) => (
            <Item key={r.key} row={r} active={s.active?.targetKey === r.key ? s.active : undefined} anyActive={!!s.active}
              favorite={fav.has(r.key)} todayMs={todayByKey.get(r.key) ?? 0} busy={app.busy === r.key}
              onPlay={play} onFavorite={(x) => app.act('fav', (l) => l.toggleFavorite(profile, x.key))} />
          ))}
        </ul>
      )}
      {shown.length > limit && <div><Button size="sm" onClick={() => setLimit(limit + PAGE)}>Show more ({shown.length - limit} more)</Button></div>}
      <div class="row">
        {PROVIDERS[profile].canEditCatalog && <Button size="sm" onClick={() => setAdding(true)}><Icon name="plus" />Add work</Button>}
        <div class="grow" />
        <Button size="sm" onClick={() => openReview()}>Review time</Button>
      </div>
      <Dialog open={!!confirm} title="Start completed work?" onClose={() => setConfirm(null)} actions={<>
        <Button variant="quiet" onClick={() => setConfirm(null)}>Cancel</Button>
        <Button variant="primary" onClick={() => { const r = confirm!; setConfirm(null); app.startTarget(r.target, { client: r.client.name, work: r.title }, r.key); }}>Start anyway</Button>
      </>}>
        <p>{confirm?.title} for {confirm?.client.name} is marked Completed. Time you record will stay local and may need a different work item before it is billed.</p>
      </Dialog>
      {adding && <AddWorkDialog app={app} onClose={() => setAdding(false)} />}
    </section>
  );
}

function AddWorkDialog({ app, onClose }: { app: AppApi; onClose: () => void }) {
  const s = app.snap!;
  const clients = [...s.clients.values()].sort((a, b) => a.name.localeCompare(b.name));
  const [clientKey, setClientKey] = useState(clients[0]?.key ?? 'new');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ClientKind>('Organization');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<WorkStatus>('In Progress');
  const [err, setErr] = useState('');
  const save = async () => {
    if (clientKey === 'new' && !name.trim()) return setErr('Enter a client name.');
    if (clientKey !== 'new' && !title.trim()) return setErr('Enter a work item title.');
    const client: Client | undefined = clientKey === 'new' ? { key: crypto.randomUUID(), profileId: 'local', kind, name: name.trim() } : undefined;
    const work: WorkItem[] = title.trim()
      ? [{ key: crypto.randomUUID(), profileId: 'local', clientKey: client?.key ?? clientKey, title: title.trim(), status, budget: { kind: 'unavailable', reason: 'not-connected' } }]
      : [];
    if (await app.act('add', (l) => l.seedCatalog(client ? [client] : [], work))) onClose();
  };
  return (
    <Dialog open title="Add work item" onClose={onClose} actions={<>
      <Button variant="quiet" onClick={onClose}>Cancel</Button>
      <Button variant="primary" busy={app.busy === 'add'} onClick={save}>Save</Button>
    </>}>
      <Select label="Client" value={clientKey} onChange={setClientKey}
        options={[...clients.map((c) => ({ value: c.key, label: c.name })), { value: 'new', label: 'New client…' }]} />
      {clientKey === 'new' && (
        <div class="row wrap">
          <TextField label="Client name" value={name} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} />
          <Select label="Client type" value={kind} onChange={setKind}
            options={[{ value: 'Organization', label: 'Organization' }, { value: 'Contact', label: 'Contact (person)' }, { value: 'ClientGroup', label: 'Client group' }]} />
        </div>
      )}
      <TextField label="Work item title" value={title} hint={clientKey === 'new' ? 'Optional. Leave empty to track client-only time.' : undefined}
        onInput={(e) => setTitle((e.currentTarget as HTMLInputElement).value)} />
      <Select label="Status" value={status} onChange={setStatus} options={WORK_STATUSES.map((v) => ({ value: v, label: v }))} />
      {err && <p class="small status-error" role="alert">{err}</p>}
    </Dialog>
  );
}
