import { defineConfig } from 'wxt';
import { APP } from './src/app-meta';

// Phase A: no host permissions, no content scripts, no background worker.
// The ledger lives in IndexedDB, which needs no permission; `sidePanel` is the only one.
export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: APP.extensionName,
    short_name: APP.brand,
    description: APP.description,
    version: APP.version,
    minimum_chrome_version: '123',
    permissions: ['sidePanel'],
    action: { default_title: APP.brand },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  },
  vite: () => ({
    // Chrome supports modulepreload natively; the polyfill would add a fetch() call to the bundle.
    build: { modulePreload: { polyfill: false } },
    oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  }),
});
