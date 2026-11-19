import { useState } from 'preact/hooks';
import { APP } from '../../app-meta';
import { sampleCatalog } from '../../integrations/sample';
import { PROVIDERS } from '../../integrations/providers';
import { useApp } from '../app-state';
import { Banner, Button, Dialog, FilterGroup, Icon, Rail, TextField } from '../components';
import { useRailItems } from './nav';
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
                options={[{ id: 'local', label: PROVIDERS.local.label }, { id: 'sample', label: PROVIDERS.sample.label }]} />
              {profile && <p class="xs muted">{PROVIDERS[profile].description}</p>}
              <div><Button size="sm" variant="quiet" onClick={() => app.act('onboard', (l) => l.setProfile(null))}>Show the welcome screen again</Button></div>
            </section>

            <section class="glass card" aria-labelledby="t-karbon">
              <h2 id="t-karbon" class="card-title">Karbon connection</h2>
              <p><strong>Not available in this version.</strong></p>
              <p class="small muted">
                {APP.brand} does not sign in to Karbon, read your Karbon clients or budgets, or create Karbon time entries. Karbon's
                public API uses firm-wide credentials and does not document creating time entries, so a connection needs Karbon's
                approval first. Until then, use Copy for Karbon in Review. Karbon's own timer is separate from {APP.brand}; avoid
                running both for the same work.
              </p>
            </section>

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
