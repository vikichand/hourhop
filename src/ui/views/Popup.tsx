import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { APP } from '../../app-meta';
import { openSidePanelFrom, useApp } from '../app-state';
import { AppHeader, Banner, Button, Icon } from '../components';
import { ModeStatus, PopupTracker } from '../parts';

// Toolbar popup: current timer + controls + "Open work switcher". No catalog and no second timer state.
// Chrome does not fire action.onClicked when default_popup is set, so the side panel opens from this
// button's click (a real user gesture), verified in e2e/timer.spec.ts.
export function Popup() {
  const app = useApp();
  const [windowId, setWindowId] = useState<number>();
  useEffect(() => { browser.windows.getCurrent().then((w) => setWindowId(w.id)); }, []);
  const s = app.snap;

  const open = () => {
    if (!browser.sidePanel?.open) {
      // Fallback when the side panel API is unavailable: the same workspace in a tab.
      browser.tabs.create({ url: browser.runtime.getURL('/sidepanel.html') });
      return window.close();
    }
    openSidePanelFrom(windowId).then(() => window.close(), (e: unknown) => app.setError(`Couldn't open the side panel: ${(e as Error).message}`));
  };

  return (
    <div class="shell room">
      <AppHeader status={<ModeStatus app={app} />} />
      {app.error && <Banner tone="error" onDismiss={() => app.setError(null)}>{app.error}</Banner>}
      {s && !s.state.profile
        ? <p class="small muted">Set up {APP.brand} in the work switcher to start tracking.</p>
        : <PopupTracker app={app} />}
      <Button variant={s?.active ? 'secondary' : 'primary'} block onClick={open}><Icon name="panel" />Open work switcher</Button>
    </div>
  );
}
