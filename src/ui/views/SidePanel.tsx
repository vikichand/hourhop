import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { short } from '../../domain/time';
import { elapsedMs } from '../../domain/timer';
import { WORK_STATUSES, type Client, type ClientKind, type WorkItem, type WorkStatus } from '../../domain/types';
import { PROVIDERS } from '../../integrations/providers';
import { sampleCatalog } from '../../integrations/sample';
import { APP } from '../../app-meta';
import { openReview, openSettings, useApp, useNow, type AppApi } from '../app-state';
import { AppHeader, Banner, Button, Dialog, EmptyState, FilterGroup, IconButton, SearchBox, Select, StatusText, TextField } from '../components';
import { ModeStatus, TrackingPanel, WorkRow } from '../parts';
import { buildRows, matchesStatus, search, type Row, type StatusFilter } from '../rows';

const PAGE = 50; // bounded DOM: at most PAGE rows rendered until the user asks for more (KWS-029)

export function SidePanel() {
  const app = useApp();
  const s = app.snap;
  return (
    <div class="shell">
      <AppHeader status={<ModeStatus app={app} />}>
        <IconButton label="Settings" icon="settings" onClick={openSettings} />
      </AppHeader>
      {app.error && <Banner tone="error" onDismiss={() => app.setError(null)}>{app.error}</Banner>}
      {!s ? <p class="pad muted" role="status">Loading…</p>
        : !s.state.profile ? <Onboarding app={app} />
        : <>
            <TrackingPanel app={app} />
            <Switcher app={app} />
            <TodayFooter app={app} />
          </>}
    </div>
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
    <section class="section stack" aria-labelledby="ob-title">
      <h1 id="ob-title" class="section-title">{APP.tagline}</h1>
      <p>{APP.brand} keeps one timer running across your client work. Switch to another work item in one click; every interval is kept for review and export.</p>
      <Banner tone="info">
        Karbon connection isn't available in this version. {APP.brand} does not read or write any Karbon data. Your time is stored only in this browser profile.
      </Banner>
      <div class="stack-tight">
        <Button variant="primary" block busy={app.busy === 'mode-sample'} onClick={() => choose('sample')}>Try sample data</Button>
        <p class="xs muted">{PROVIDERS.sample.description}</p>
      </div>
      <div class="stack-tight">
        <Button variant="secondary" block busy={app.busy === 'mode-local'} onClick={() => choose('local')}>Track locally</Button>
        <p class="xs muted">{PROVIDERS.local.description}</p>
      </div>
      <p class="xs muted">No account, no sign-in, no network access. {APP.nonAffiliation}</p>
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

  let shown: Row[];
  if (query.trim()) shown = search(rows, query).filter((r) => matchesStatus(r, status));
  else if (effectiveTab === 'recent') shown = s.recents.map((k) => byKey.get(k)).filter((r): r is Row => !!r);
  else if (effectiveTab === 'favorites') shown = rows.filter((r) => fav.has(r.key));
  else shown = rows.filter((r) => matchesStatus(r, status));

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

  const start = (r: Row) => {
    if (s.active?.targetKey === r.key && s.active.status === 'running') return;
    if (r.status === 'Completed' && s.active?.targetKey !== r.key) return setConfirm(r);
    app.startTarget(r.target, { client: r.client.name, work: r.title }, r.key);
  };

  const heading = query.trim() ? `${shown.length} ${shown.length === 1 ? 'result' : 'results'}` : `${shown.length} ${effectiveTab === 'recent' ? 'recent' : effectiveTab === 'favorites' ? 'favorite' : 'work'} ${shown.length === 1 ? 'item' : 'items'}`;

  return (
    <section aria-label="Work switcher">
      <div class="section">
        <SearchBox label="Search clients and work items" value={query} onInput={setQuery} onKeyDown={onSearchKey} inputRef={searchRef} />
        <div class="row wrap">
          <FilterGroup label="Show" value={effectiveTab} onChange={(t) => { setTab(t); setQuery(''); }} options={[
            { id: 'recent', label: 'Recent' }, { id: 'favorites', label: 'Favorites', count: s.favorites.length }, { id: 'all', label: 'All' },
          ]} />
          <div class="grow" />
          {PROVIDERS[profile].canEditCatalog && <Button size="sm" variant="quiet" onClick={() => setAdding(true)}>Add work</Button>}
        </div>
        {(effectiveTab === 'all' || query.trim()) && (
          <Select label="Status" value={status} onChange={setStatus} options={[
            { value: 'open', label: 'Open (not completed)' }, { value: 'actionable', label: 'Ready to start or in progress' },
            { value: 'completed', label: 'Completed' }, { value: 'all', label: 'All statuses' },
          ]} />
        )}
      </div>
      <p class="list-group" aria-live="polite">{heading}</p>
      {shown.length === 0 ? (
        query.trim() ? <EmptyState title="No matches">Try a client name or part of a work title.</EmptyState>
        : effectiveTab === 'recent' ? <EmptyState title="No recent work yet" action={<Button size="sm" onClick={() => setTab('all')}>Browse all work</Button>}>Work you track appears here.</EmptyState>
        : effectiveTab === 'favorites' ? <EmptyState title="No favorites yet">Use the star on any work item to pin it here.</EmptyState>
        : <EmptyState title="No work items yet" action={PROVIDERS[profile].canEditCatalog && <Button size="sm" variant="primary" onClick={() => setAdding(true)}>Add work item</Button>}>
            {PROVIDERS[profile].canEditCatalog ? 'Add the clients and work items you track time against.' : 'Nothing matches this status filter.'}
          </EmptyState>
      ) : (
        <ul class="list" ref={listRef} onKeyDown={onListKey} aria-label="Work items">
          {shown.slice(0, limit).map((r) => (
            <WorkRow key={r.key} row={r} active={s.active?.targetKey === r.key ? s.active : undefined} anyActive={!!s.active}
              favorite={fav.has(r.key)} todayMs={todayByKey.get(r.key) ?? 0} busy={app.busy === r.key}
              onStart={start} onFavorite={(x) => app.act('fav', (l) => l.toggleFavorite(profile, x.key))} />
          ))}
        </ul>
      )}
      {shown.length > limit && (
        <div class="section"><Button size="sm" onClick={() => setLimit(limit + PAGE)}>Show more ({shown.length - limit} more)</Button></div>
      )}
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

function TodayFooter({ app }: { app: AppApi }) {
  const s = app.snap!;
  const now = useNow(30_000);
  const total = s.today.reduce((t, x) => t + elapsedMs(s.active?.id === x.id ? s.active : x, now), 0);
  return (
    <footer class="footer">
      <div class="grow">
        <p class="small"><strong class="num">Today {short(total)}</strong> <span class="muted">· {s.today.length} {s.today.length === 1 ? 'session' : 'sessions'}</span></p>
        <StatusText kind="local">Recorded locally, not confirmed in Karbon</StatusText>
      </div>
      <Button size="sm" variant="secondary" onClick={() => openReview()}>Review time</Button>
    </footer>
  );
}
