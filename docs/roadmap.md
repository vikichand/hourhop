# HourHop roadmap

Work planned but not built, with what each item depends on. HourHop is an internal tool for the owner's colleagues; a public Chrome Web Store listing is not a goal.

## Phase next: connect through the Karbon login

**Status:** next, waiting on one Karbon session report. **Depends on:** one colleague doing the session check once.

**Goal:** zero setup, the way Reckonry Timer for Karbon works. HourHop uses the Karbon login already in the browser to load the colleague's work and run Karbon's own timer, so time lands in Karbon without copying. The owner chose this route on 2026-11-19, knowing the interface is Karbon's private web-app API: Karbon can change it without notice, and it may not be allowed by Karbon's terms.

**Built so far:** 0.5.0 includes the Karbon session check (Settings, Copy Karbon session report). It records how Karbon's app calls Karbon (address patterns, login scheme, field names and types; no values).

**Known from the Reckonry listing and manifest:**
- Karbon's web app is at `app2.karbonhq.com`.
- It calls regional API hosts such as `us3.karbonhq.com`.
- It uses per-tenant paths, including:
  - `/time/api/{tenant}/stopwatches/{user}` (Karbon's timer);
  - `/time/api/{tenant}/timeEntries`;
  - `/work/api/{tenant}/workItems`;
  - `/todo/api/{tenant}/workViewListItems`;
  - `/tenant/api/{tenant}/taskTypes`.
- The web app's session cookie is `__Secure-Karbon`.

**To build it:**

1. **Get the report.** One colleague opens Karbon in Chrome, opens a work item, starts and stops Karbon's timer once, then sends the Karbon session report.
2. **Read the work.** From the report, map how the app authenticates, and which calls list "my work", clients, task types and the current timer. Read them read-only first, behind an allowlist of paths, with a clear "Karbon changed something" message when a shape no longer matches.
3. **Run Karbon's timer.** Start, pause, switch and stop it from HourHop, mirroring HourHop's own timer. Each write needs:
   - a confirmation the first time;
   - read-back of Karbon's timer state after every change;
   - no blind retries;
   - a setting to switch it off.
4. **Bring in Reckonry's in-Karbon touches**, as optional settings: auto-start or switch when a work item page is opened in Karbon (with a countdown and cancel), and role and task type filled in from the firm's Karbon settings.

## Later phase: official Karbon sign-in

**Status:** later, after the Karbon-login phase. **Depends on:** one connection report.

Sign in with Karbon (beta since 0.4.0) uses Karbon's official MCP server with each colleague's own login and read-only scope. It is official and stable, but cannot run Karbon's timer. Karbon does not publish the MCP server's tool list, so the beta only lists the tools.

To finish it:

1. One colleague clicks **Sign in with Karbon**, then **Copy connection report**, and sends the report (tool names and descriptions only, no firm data).
2. Map the read-only tools for "my assigned work", clients and estimates to HourHop's catalog and budgets, behind an allowlist of tool names; never call a tool marked as writing.
3. Keep the access token for the session (request `offline_access` for a refresh token only once it is stored and revocable), refresh the work list every 15 minutes as the key-based sync does, and add Sign out.

Facts verified on 2026-11-19:
- The return address must be exactly `http://127.0.0.1:53682/callback`.
- Scope `mcp:public:read` reaches Karbon's login page.
- `chromiumapp.org` addresses are refused.

## Save time into Karbon through the published API

**Status:** blocked on Karbon.

Karbon's published API v3 can read time entries but has no endpoint for creating them ([karbonhq/karbon-api-reference](https://github.com/karbonhq/karbon-api-reference), October 2026). The Karbon-login phase above runs Karbon's own timer instead. If Karbon adds an official endpoint, it is the safer path: a deliberate **Submit to Karbon** in Review, an outbox that survives restarts, read-back before showing an entry as confirmed, and no blind retries.

## Smaller items

- Restore from a JSON backup.
- Time-format setting.
