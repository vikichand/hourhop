// Isolated-world partner of karbon-probe.content.ts: accepts only well-formed shape records from the same window
// and keeps them in the extension's local storage for the Settings report. Makes no network request.

import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { isProbeEntry, mergeEntry, PROBE_SOURCE, PROBE_STORAGE_KEY, type ProbeEntry } from '../integrations/karbon-probe';

export default defineContentScript({
  matches: ['https://app2.karbonhq.com/*'],
  runAt: 'document_start',
  main() {
    let queue: ProbeEntry[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = async () => {
      const batch = queue;
      queue = [];
      const stored = (await browser.storage.local.get(PROBE_STORAGE_KEY))[PROBE_STORAGE_KEY] as Record<string, ProbeEntry> | undefined;
      let map = stored ?? {};
      for (const e of batch) map = mergeEntry(map, e);
      await browser.storage.local.set({ [PROBE_STORAGE_KEY]: map });
    };
    window.addEventListener('message', (ev) => {
      if (ev.source !== window || ev.origin !== location.origin) return;
      const d = ev.data as { source?: unknown; entry?: unknown } | null;
      if (!d || d.source !== PROBE_SOURCE || !isProbeEntry(d.entry)) return;
      queue.push(d.entry);
      clearTimeout(timer);
      timer = setTimeout(() => void flush().catch(() => undefined), 500);
    });
  },
});
