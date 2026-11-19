import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { PROBE_STORAGE_KEY, type ProbeEntry } from '../../integrations/karbon-probe';
import { APP } from '../../app-meta';
import { sampleCatalog } from '../../integrations/sample';
import { PROVIDERS } from '../../integrations/providers';
import { getLedger, useApp } from '../app-state';
import { signInWithKarbon } from '../../integrations/karbon-mcp';
import { Banner, Button, Checkbox, Dialog, FilterGroup, Icon, Rail, Select, TextField } from '../components';
import { useRailItems } from './nav';
import { connectKarbon, disconnectKarbon, refreshKarbon } from '../../integrations/karbon-sync';
import type { AppApi } from '../app-state';
import { ModeStatus } from '../parts';
import { downloadExport } from './export-download';
import type { ProfileId } from '../../domain/types';
import type { Preset, Prefs, Theme } from '../../storage/ledger';

export function Settings() {
  const app = useApp();
  const rail = useRailItems();
  const s = app.snap;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typed, setTyped] = useState('');
  const [notice, setNotice] = useState('');
  if (!s) return <p class="muted" role="status">Loading…</p>;
  const profile = s.state.profile;

  const switchMode = (p: ProfileId) =>
    app.act(`mode-${p}`, async (l) => {
      if (p === 'sample' && !(await l.catalog('sample')).work.length) {
        const c = sampleCatalog(Date.now());
        await l.seedCatalog(c.clients, c.work);
      }
      await l.setProfile(p);
    });

  return (
    <div class="room">
      <div class="app">
        <Rail current="settings" items={rail} />
        <main class="main">
          <div class="topbar"><h1 class="page-title grow">Settings</h1><ModeStatus app={app} /></div>
          {app.error && <Banner tone="error" onDismiss={() => app.setError(null)}>{app.error}</Banner>}
          {notice && <Banner tone="info" onDismiss={() => setNotice('')}>{notice}</Banner>}
          <div class="settings-grid">
            <section class="glass card" aria-labelledby="t-theme">
              <h2 id="t-theme" class="card-title">Appearance</h2>
              <p class="small muted">Dark by default. System follows your computer.</p>
              <FilterGroup<Theme> label="Theme" value={s.state.theme} onChange={(t) => app.act('theme', (l) => l.setTheme(t))}
                options={[{ id: 'system', label: 'System' }, { id: 'dark', label: 'Dark' }, { id: 'light', label: 'Light' }]} />
            </section>

            <section class="glass card" aria-labelledby="t-mode">
              <h2 id="t-mode" class="card-title">Data mode</h2>
              <p class="small muted">Each mode keeps its own clients, favorites and sessions. Switching never deletes anything.</p>
              {s.active && <p class="small warn">Stop the running timer before switching data mode.</p>}
              <FilterGroup<ProfileId> label="Data mode" value={profile ?? 'local'} onChange={(p) => p !== profile && switchMode(p)}
                options={[
                  ...(s.karbon.connected || s.karbon.hasSessions ? [{ id: 'karbon' as const, label: PROVIDERS.karbon.label }] : []),
                  { id: 'local', label: PROVIDERS.local.label }, { id: 'sample', label: PROVIDERS.sample.label },
                ]} />
              {profile && <p class="xs muted">{PROVIDERS[profile].description}</p>}
              <div><Button size="sm" variant="quiet" onClick={() => app.act('onboard', (l) => l.setProfile(null))}>Show the welcome screen again</Button></div>
            </section>

            <TimerCard app={app} />

            <KarbonCard app={app} onNotice={setNotice} />

            <section class="glass card" aria-labelledby="t-data">
              <h2 id="t-data" class="card-title">Your data</h2>
              <p class="small muted">
                Everything is stored in this browser profile only (IndexedDB). {APP.brand} sends no analytics, and its only network
                requests are reads from Karbon, once you connect Karbon. Uninstalling the extension or clearing site data deletes it, so export a copy now and then.
              </p>
              <div class="row wrap">
                {profile && <Button size="sm" onClick={async () => setNotice(await downloadExport(profile, 'csv'))}><Icon name="export" />Export CSV</Button>}
                {profile && <Button size="sm" onClick={async () => setNotice(await downloadExport(profile, 'json'))}><Icon name="export" />Export JSON</Button>}
                <div class="grow" />
                <Button size="sm" variant="danger" onClick={() => { setTyped(''); setConfirmDelete(true); }}>Delete all {APP.brand} data…</Button>
              </div>
            </section>

            <section class="glass card" aria-labelledby="t-about">
              <h2 id="t-about" class="card-title">About</h2>
              <p class="small">{APP.brand} {APP.version}. {APP.tagline}</p>
              <p class="small muted">{APP.nonAffiliation}</p>
              <p class="small muted">Notes are plain text you type. There is no voice capture or AI processing in this version.</p>
            </section>
          </div>
        </main>
      </div>

      <Dialog open={confirmDelete} title={`Delete all ${APP.brand} data?`} onClose={() => setConfirmDelete(false)} actions={<>
        <Button variant="quiet" onClick={() => setConfirmDelete(false)}>Cancel</Button>
        <Button variant="danger" inert={typed !== 'DELETE'} busy={app.busy === 'delete'}
          onClick={async () => { if (await app.act('delete', (l) => l.deleteAll())) { setConfirmDelete(false); setNotice(`All ${APP.brand} data was deleted.`); } }}>
          Delete everything
        </Button>
      </>}>
        <p>This permanently removes every session, client, work item, favorite and edit history from both data modes in this browser profile{s.active ? ', including the running timer' : ''}. It cannot be undone. Your Karbon account and other browser data are not affected.</p>
        <p class="small muted">Export first if you might need this time later.</p>
        <TextField label="Type DELETE to confirm" value={typed} onInput={(e) => setTyped((e.currentTarget as HTMLInputElement).value)} />
      </Dialog>
    </div>
  );
}

const IDLE = [0, 5, 10, 15, 30].map((m) => ({ value: String(m), label: m ? `After ${m} minutes` : 'Off' }));
const LONG = [0, 2, 4, 6, 8, 10].map((h) => ({ value: String(h), label: h ? `${h} hours` : 'Off' }));

/** Automatic pause and resume, the long-timer alert, the badge, shortcuts and presets. Each automatic action is optional. */
function TimerCard({ app }: { app: AppApi }) {
  // Shown at once and undone if the save fails; otherwise a control flicks back until the snapshot reloads.
  const [draft, setDraft] = useState<Partial<Prefs>>({});
  const p = { ...app.snap!.prefs, ...draft };
  const save = async (patch: Partial<Prefs>) => {
    setDraft((d) => ({ ...d, ...patch }));
    const ok = await app.act('prefs', (l) => l.savePrefs(patch));
    if (!ok) setDraft((d) => { const n = { ...d }; for (const k of Object.keys(patch)) delete n[k as keyof Prefs]; return n; });
    return ok;
  };
  const [label, setLabel] = useState('');
  const [role, setRole] = useState('');
  const [task, setTask] = useState('');
  const add = async () => {
    if (!label.trim() || (!role.trim() && !task.trim())) { app.setError('Give the preset a name and a role or task type.'); return; }
    const preset: Preset = { id: crypto.randomUUID(), label: label.trim().slice(0, 40), roleName: role.trim() || undefined, taskTypeName: task.trim() || undefined };
    if (await save({ presets: [...p.presets, preset].slice(0, 12) })) { setLabel(''); setRole(''); setTask(''); }
  };
  return (
    <section class="glass card" aria-labelledby="t-timer">
      <h2 id="t-timer" class="card-title">Timer</h2>
      <p class="small muted">Every automatic action is optional and leaves a short, time-stamped note on the session, such as "Paused: screen locked".</p>
      <Checkbox label="Pause when the screen locks" checked={p.pauseOnLock} onChange={(v) => save({ pauseOnLock: v })} />
      <Checkbox label="Pause when the computer sleeps" checked={p.pauseOnSleep} onChange={(v) => save({ pauseOnSleep: v })} />
      <Select label="Pause when idle (no keyboard or mouse)" value={String(p.idleMinutes)} options={IDLE} onChange={(v) => save({ idleMinutes: Number(v) })} />
      <Checkbox label="Resume when I'm back (only after an automatic pause)" checked={p.autoResume} onChange={(v) => save({ autoResume: v })} />
      <Select label="Alert me when one timer runs past" value={String(p.longAlertHours)} options={LONG} onChange={(v) => save({ longAlertHours: Number(v) })} />
      <Checkbox label="Show the running time on the toolbar icon" checked={p.badge} onChange={(v) => save({ badge: v })} />
      <p class="xs muted">Shortcuts: Alt+Shift+K starts, pauses or resumes the timer; Alt+Shift+T opens it. Change them at chrome://extensions/shortcuts.</p>

      <h3 class="card-title card-title-sm">Presets</h3>
      <p class="small muted">One-click role and task type for the running timer, for the stages of one job.</p>
      {p.presets.length > 0 && (
        <ul class="stack-tight">
          {p.presets.map((x) => (
            <li key={x.id} class="row">
              <span class="grow small"><strong>{x.label}</strong> <span class="muted">{[x.roleName, x.taskTypeName].filter(Boolean).join(', ')}</span></span>
              <Button size="sm" variant="quiet" aria-label={`Remove preset ${x.label}`} onClick={() => save({ presets: p.presets.filter((y) => y.id !== x.id) })}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
      <TextField label="Preset name" value={label} onInput={(e) => setLabel((e.currentTarget as HTMLInputElement).value)} />
      <TextField label="Role" value={role} onInput={(e) => setRole((e.currentTarget as HTMLInputElement).value)} />
      <TextField label="Task type" value={task} onInput={(e) => setTask((e.currentTarget as HTMLInputElement).value)} />
      <div><Button size="sm" onClick={add}>Add preset</Button></div>
    </section>
  );
}

/**
 * Karbon session check: shows how many of Karbon's own requests the probe has recorded (shapes only) and copies them as
 * a report, so the Karbon-login connection can be built against Karbon's real app.
 */
function KarbonSessionCheck({ app, onNotice }: { app: AppApi; onNotice: (m: string) => void }) {
  const [entries, setEntries] = useState<Record<string, ProbeEntry>>({});
  useEffect(() => {
    const load = () => browser.storage.session.get(PROBE_STORAGE_KEY).then((r) => setEntries((r[PROBE_STORAGE_KEY] as Record<string, ProbeEntry> | undefined) ?? {}), () => undefined);
    void load();
    const onChange = (changes: Record<string, unknown>) => { if (PROBE_STORAGE_KEY in changes) void load(); };
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, []);
  const list = Object.values(entries);
  const timer = list.some((e) => /stopwatch|timer/i.test(e.path));
  const copy = async () => {
    const report = { generatedUtc: new Date().toISOString(), app: `${APP.brand} ${APP.version}`, kind: 'karbon-session-check', entries: list.sort((a, b) => a.path.localeCompare(b.path)) };
    try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); onNotice("Karbon session report copied. It lists how Karbon's app talks to Karbon: addresses and field names, with no values or client data."); }
    catch { app.setError('Copy failed. Your browser blocked clipboard access.'); }
  };
  return (
    <div class="stack-tight">
      <p class="small muted">
        {APP.brand} connects through the Karbon login already in this browser. One-time setup check: open Karbon here, open any work
        item, start and stop Karbon's own timer once, then copy the report and send it to whoever maintains {APP.brand}. It records
        addresses and field names only, never values, names or amounts.
      </p>
      <p class="small" role="status">
        {list.length ? <><strong>{list.length} Karbon {list.length === 1 ? 'request' : 'requests'} recorded.</strong> {timer ? "Karbon's timer was seen." : "Karbon's timer not seen yet: start and stop it once."}</> : 'Nothing recorded yet. Open Karbon in this browser.'}
      </p>
      <div class="row wrap">
        <Button size="sm" onClick={() => void browser.tabs.create({ url: 'https://app2.karbonhq.com/' })}>Open Karbon</Button>
        <Button size="sm" variant={list.length ? 'primary' : 'secondary'} inert={!list.length} onClick={copy}><Icon name="copy" />Copy Karbon session report</Button>
        {list.length > 0 && <Button size="sm" variant="quiet" onClick={() => void browser.storage.session.remove(PROBE_STORAGE_KEY)}>Clear</Button>}
      </div>
    </div>
  );
}

/** Connect, refresh and disconnect the firm's Karbon account. Keys go straight to the ledger; the UI never reads them back. */
function KarbonCard({ app, onNotice }: { app: AppApi; onNotice: (m: string) => void }) {
  const k = app.snap!.karbon;
  const [appId, setAppId] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [email, setEmail] = useState('');
  const [confirmOff, setConfirmOff] = useState(false);
  const connect = async () => {
    let result: { workCount: number; switched: boolean } | undefined;
    const ok = await app.act('karbon-connect', async (l) => { result = await connectKarbon(l, { appId, accessKey, email }); });
    if (ok && result) {
      setAppId(''); setAccessKey('');
      onNotice(`Connected to Karbon. ${result.workCount} open ${result.workCount === 1 ? 'work item is' : 'work items are'} assigned to you.${result.switched ? '' : ' Stop the running timer, then switch to Karbon under Data mode.'}`);
    }
  };
  const signIn = async () => {
    const ok = await app.act('karbon-signin', async (l) => {
      const report = await signInWithKarbon({ now: () => new Date().toISOString() });
      await l.saveKarbonSignIn({ key: 'karbon:signin', report });
    });
    if (ok) onNotice(`Signed in to Karbon. Copy the connection report and send it to whoever maintains ${APP.brand}.`);
  };
  const copyReport = async () => {
    const r = (await (await getLedger()).karbonSignIn())?.report;
    try { await navigator.clipboard.writeText(JSON.stringify(r, null, 2)); onNotice("Connection report copied. It lists what Karbon offers, with none of your firm's data."); }
    catch { app.setError('Copy failed. Your browser blocked clipboard access.'); }
  };
  if (!k.connected) {
    return (
      <section class="glass card" aria-labelledby="t-karbon">
        <h2 id="t-karbon" class="card-title">Connect Karbon</h2>
        <KarbonSessionCheck app={app} onNotice={onNotice} />
        <h3 class="card-title card-title-sm">Official Karbon sign-in (beta)</h3>
        <p class="small muted">
          Sign in on Karbon's own page with read-only access. This version checks the connection and prepares a short report.
        </p>
        <div><Button busy={app.busy === 'karbon-signin'} onClick={signIn}>Sign in with Karbon</Button></div>
        {k.signIn && (
          <div class="stack-tight" role="status">
            <p class="small"><strong>Signed in to Karbon.</strong> Karbon offers {k.signIn.toolCount} {k.signIn.toolCount === 1 ? 'tool' : 'tools'} to {APP.brand}.</p>
            <div><Button size="sm" onClick={copyReport}><Icon name="copy" />Copy connection report</Button></div>
          </div>
        )}
        <h3 class="card-title card-title-sm">Or connect with your firm's API keys</h3>
        <p class="small muted">
          Pull in the work assigned to you, with real budgets, straight from Karbon. Read-only: {APP.brand} never changes anything in
          Karbon, and you still enter time in Karbon yourself with Copy for Karbon. Your firm's Karbon admin can give you the two keys
          (see the README).
        </p>
        <TextField label="Application ID" type="password" autocomplete="new-password" value={appId} onInput={(e) => setAppId((e.currentTarget as HTMLInputElement).value)} />
        <TextField label="AccessKey" type="password" autocomplete="new-password" value={accessKey} onInput={(e) => setAccessKey((e.currentTarget as HTMLInputElement).value)} />
        <TextField label="Your Karbon email" type="email" autocomplete="email" value={email} onInput={(e) => setEmail((e.currentTarget as HTMLInputElement).value)} />
        <p class="xs muted">These keys give full access to your whole firm's Karbon data, including changing it; {APP.brand} only reads. They are stored only in this browser and sent only to Karbon's official API.</p>
        <div><Button busy={app.busy === 'karbon-connect'} onClick={connect}>Connect Karbon</Button></div>
      </section>
    );
  }
  const at = k.lastSyncUtc ? new Date(k.lastSyncUtc).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'never';
  return (
    <section class="glass card" aria-labelledby="t-karbon">
      <h2 id="t-karbon" class="card-title">Karbon connection</h2>
      <p><strong>Connected as {k.userName}</strong> <span class="muted small">({k.email})</span></p>
      <p class="small muted">{k.workCount ?? 0} open work items assigned to you. Synced from Karbon {at}. Read-only: time is not sent to Karbon.</p>
      {k.lastError && <p class="small warn" role="status">Last refresh failed: {k.lastError}</p>}
      <div class="row wrap">
        <Button size="sm" busy={app.busy === 'karbon-refresh'} onClick={() => app.act('karbon-refresh', (l) => refreshKarbon(l, { force: true }))}><Icon name="refresh" />Refresh now</Button>
        <Button size="sm" variant="danger" onClick={() => setConfirmOff(true)}>Disconnect…</Button>
      </div>
      <Dialog open={confirmOff} title="Disconnect Karbon?" onClose={() => setConfirmOff(false)} actions={<>
        <Button variant="quiet" onClick={() => setConfirmOff(false)}>Cancel</Button>
        <Button variant="danger" busy={app.busy === 'karbon-off'} onClick={async () => {
          if (await app.act('karbon-off', (l) => disconnectKarbon(l))) { setConfirmOff(false); onNotice('Karbon disconnected. The keys were removed from this browser.'); }
        }}>Disconnect</Button>
      </>}>
        <p>This removes the keys and the synced work list from this browser. Time you recorded stays here and can still be reviewed and exported.</p>
      </Dialog>
    </section>
  );
}
