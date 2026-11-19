import { defineConfig } from 'wxt';
import { APP } from './src/app-meta';

// No content scripts, no background worker. The ledger lives in IndexedDB (no permission needed).
// `sidePanel` plus one host, Karbon's official API, used only after the user connects their firm's keys.
export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: APP.extensionName,
    short_name: APP.brand,
    description: APP.description,
    version: APP.version,
    minimum_chrome_version: '123',
    permissions: ['sidePanel'],
    // Karbon's official API only. Nothing is requested until the user enters their firm's keys.
    host_permissions: ['https://api.karbonhq.com/*'],
    action: { default_title: APP.brand },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; connect-src 'self' https://api.karbonhq.com",
    },
  },
  vite: () => ({
    // Chrome supports modulepreload natively; the polyfill would add a fetch() call to the bundle.
    build: { modulePreload: { polyfill: false } },
    oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  }),
});
