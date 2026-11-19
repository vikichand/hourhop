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
    // storage: the Karbon session check's shape records, written by the content script on Karbon's web app.
    permissions: ['sidePanel', 'storage'],
    // Karbon only: the official API (firm keys), Karbon's sign-in and MCP servers ("Sign in with Karbon"), and the
    // loopback address Karbon redirects to after sign-in, so the opening page can read that one URL (it is not in
    // connect-src, so nothing can fetch it). No request is made until the user connects or signs in.
    host_permissions: ['https://api.karbonhq.com/*', 'https://identity.karbonhq.com/*', 'https://mcp.karbonhq.com/*', 'http://127.0.0.1:53682/*'],
    action: { default_title: APP.brand },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; connect-src 'self' https://api.karbonhq.com https://identity.karbonhq.com https://mcp.karbonhq.com",
    },
  },
  vite: () => ({
    // Chrome supports modulepreload natively; the polyfill would add a fetch() call to the bundle.
    build: { modulePreload: { polyfill: false } },
    oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  }),
});
