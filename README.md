# HourHop

Switch work. Track time. A local-first Chrome extension (Manifest V3) that keeps one timer running across client work, with a side panel for one-click switching, a toolbar popup, review, editing and export.

Internal project name: HourHop - Karbon. HourHop is an independent tool. It is not affiliated with, endorsed by or connected to Karbon, and this version does not read or write any Karbon data.

## Quick start

Requires Node 22+ and pnpm 10.

```sh
pnpm install
pnpm build
```

Then load it in Chrome:

1. Open `chrome://extensions` and switch on **Developer mode**.
2. Click **Load unpacked** and choose the `.output/chrome-mv3` folder.
3. Click the HourHop toolbar icon, then **Open work switcher**.
4. Pick **Try sample data** (synthetic clients) or **Track locally** (your own clients).

Use a separate Chrome profile for evaluation if you want to keep test data apart from your normal browsing.

## What it does

- One timer for the whole browser profile. Starting another work item stops the current session and starts a new one in a single IndexedDB transaction.
- Pause, resume and stop. Each work item keeps every session and interval separately.
- Search, Recent, Favorites and All, with a status filter. Completed work asks before starting.
- Plain-text notes, role, task type and billable flag per session.
- Budgets shown only when known, with scope and source. Recorded and local time are never added together.
- Review by day or week, audited corrections (edit times, split, discard, each with a reason), CSV and JSON export, and "Copy for Karbon" text for manual entry.
- Dark, light and system themes. Keyboard support: `/` focuses search, arrow keys move through results, Enter starts.

Not in this version: any Karbon sign-in, client sync or time-entry submission (blocked until Karbon provides a supported, approved integration), voice dictation and AI notes.

## Commands

| Command | What it does |
|---|---|
| `pnpm build` | Production build into `.output/chrome-mv3` |
| `pnpm zip` | Build and zip for distribution into `.output/` |
| `pnpm dev` | WXT dev mode with reload |
| `pnpm typecheck` | TypeScript strict check |
| `pnpm test` | Vitest: domain, ledger (fake IndexedDB), UI architecture guards |
| `pnpm e2e` | Playwright against the built extension in a fresh temporary Chromium profile (run `pnpm build` first) |
| `pnpm check` | All of the above in order |
| `node scripts/make-icons.mjs` | Re-render toolbar PNG icons from `public/icon/icon.svg` |

E2E notes: tests use Playwright's bundled Chromium (branded Chrome no longer honours `--load-extension`), a throwaway profile per test and synthetic data only. Set `HEADED=1` to watch. Screenshots, axe results and timing data go to `.tmp/evidence/` (override with `EVIDENCE_DIR`). The suite opens a random loopback DevTools port on each throwaway profile to drive the real toolbar popup.

## How it works

- `src/domain/`: pure TypeScript. Timer transitions, durations and local-date attribution, budgets, audited edits, export.
- `src/storage/ledger.ts`: the IndexedDB ledger. Every timer command is one readwrite transaction over the global active pointer, the session records and an operation journal, so commands from the popup and side panel serialize in IndexedDB itself. Success is shown only after the transaction commits with strict durability.
- `src/ui/`: Preact. `tokens.css` holds every colour, size and timing value; `components.tsx` is the only module that renders raw controls; `parts.tsx` and `views/` compose them. `tests/ui-guards.test.ts` enforces both rules.
- `src/app-meta.ts`: the single source of product name and copy identity.
- No background service worker, content script or host permission. The only permission is `sidePanel`. Elapsed time is always derived from stored timestamps, so closing every window or restarting the browser loses nothing.

## Limits

- Data lives only in this browser profile. Uninstalling the extension or clearing site data deletes it, so export first.
- A single interval over 8 hours, or one where the clock moved backwards, is kept as recorded and flagged for review.
- Layout is designed for 320 to 600 CSS px. 200% zoom in a 360 px side panel (180 CSS px) overflows horizontally.
- Chrome 123 or newer.

## Design and policy docs

- `docs/design.md`: visual and interaction contract.
- `docs/branches-and-releases.md`: release policy.
