import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import type { IconName } from '../components';
import { openSidePanelFrom } from '../app-state';

export type Page = 'timer' | 'review' | 'settings';

/** Rail destinations for the full-tab pages. "Timer" opens the side panel from the click (a user gesture). */
export function useRailItems(): { id: Page; label: string; icon: IconName; onClick: () => void }[] {
  const [windowId, setWindowId] = useState<number>();
  useEffect(() => { browser.windows.getCurrent().then((w) => setWindowId(w.id)); }, []);
  return [
    { id: 'timer', label: 'Open work switcher', icon: 'timer', onClick: () => { openSidePanelFrom(windowId).catch(() => undefined); } },
    { id: 'review', label: 'Review time', icon: 'list', onClick: () => location.assign(browser.runtime.getURL('/review.html')) },
    { id: 'settings', label: 'Settings', icon: 'settings', onClick: () => location.assign(browser.runtime.getURL('/options.html')) },
  ];
}
