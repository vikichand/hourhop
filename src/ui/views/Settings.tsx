import { useState } from 'preact/hooks';
import { APP } from '../../app-meta';
import { sampleCatalog } from '../../integrations/sample';
import { PROVIDERS } from '../../integrations/providers';
import { useApp } from '../app-state';
import { Banner, Button, Dialog, FilterGroup, Icon, Rail, TextField } from '../components';
import { useRailItems } from './nav';
import { connectKarbon, disconnectKarbon, refreshKarbon } from '../../integrations/karbon-sync';
import type { AppApi } from '../app-state';
import { ModeStatus } from '../parts';
import { downloadExport } from './export-download';
import type { ProfileId } from '../../domain/types';
import type { Theme } from '../../storage/ledger';

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

            <KarbonCard app={app} onNotice={setNotice} />

            <section class="glass card span-2" aria-labelledby="t-data">
              <h2 id="t-data" class="card-title">Your data</h2>
              <p class="small muted">
                Everything is stored in this browser profile only (IndexedDB). {APP.brand} sends no analytics and makes no network
                requests. Uninstalling the extension or clearing site data deletes it, so export a copy now and then.
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
  if (!k.connected) {
    return (
      <section class="glass card" aria-labelledby="t-karbon">
        <h2 id="t-karbon" class="card-title">Connect Karbon</h2>
        <p class="small muted">
          Pull in the work assigned to you, with real budgets, straight from Karbon. Read-only: {APP.brand} never changes anything in
          Karbon, and you still enter time in Karbon yourself with Copy for Karbon. Your firm's Karbon admin can give you the two keys
          (see the README).
        </p>
        <TextField label="Application ID" type="password" autocomplete="new-password" value={appId} onInput={(e) => setAppId((e.currentTarget as HTMLInputElement).value)} />
        <TextField label="AccessKey" type="password" autocomplete="new-password" value={accessKey} onInput={(e) => setAccessKey((e.currentTarget as HTMLInputElement).value)} />
        <TextField label="Your Karbon email" type="email" autocomplete="email" value={email} onInput={(e) => setEmail((e.currentTarget as HTMLInputElement).value)} />
        <p class="xs muted">These keys can read your whole firm's Karbon data. They are stored only in this browser and sent only to Karbon's official API.</p>
        <div><Button variant="primary" busy={app.busy === 'karbon-connect'} onClick={connect}>Connect Karbon</Button></div>
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
