// Isolated-world partner of karbon-probe.content.ts: accepts only well-formed shape records from the same window
// and keeps them in session storage for the Settings report. Makes no network request.

import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { mergeEntry, PROBE_SOURCE, PROBE_STORAGE_KEY, sanitizeEntry, type ProbeEntry } from '../integrations/karbon-probe';

export default defineContentScript({
  matches: ['https://app2.karbonhq.com/*'],
  runAt: 'document_start',
  main() {
    // Any script on Karbon's page can post messages, so each one is rebuilt from scratch (sanitizeEntry), the queue
    // is bounded, and records live in session storage: their own quota, cleared when Chrome closes.
    let queue: ProbeEntry[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let chain = Promise.resolve();
    const flush = () => {
      const batch = queue;
      queue = [];
      chain = chain.then(async () => {
        const stored = (await browser.storage.session.get(PROBE_STORAGE_KEY))[PROBE_STORAGE_KEY] as Record<string, ProbeEntry> | undefined;
        let map = stored ?? {};
        for (const e of batch) map = mergeEntry(map, e);
        await browser.storage.session.set({ [PROBE_STORAGE_KEY]: map });
      }).catch(() => undefined);
    };
    window.addEventListener('message', (ev) => {
      if (ev.source !== window || ev.origin !== location.origin || queue.length >= 100) return;
      const d = ev.data as { source?: unknown; entry?: unknown } | null;
      if (!d || d.source !== PROBE_SOURCE) return;
      const entry = sanitizeEntry(d.entry, new Date().toISOString());
      if (!entry) return;
      queue.push(entry);
      clearTimeout(timer);
      timer = setTimeout(flush, 500);
    });
  },
});
