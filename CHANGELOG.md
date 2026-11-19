# Changelog

All notable changes to HourHop are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-11-19

### Added

- Connect Karbon: enter your firm's Karbon API keys and your Karbon email in Settings, and the work assigned to you (not completed) appears automatically, grouped by client, with Karbon statuses and due dates. It refreshes every 15 minutes while open, or on demand.
- Real budgets from Karbon estimates: the work item total and your own allocation, with time already recorded in Karbon. Hourly rates are never shown.
- Mark entered: after pasting a session into Karbon, mark it so it is not counted twice against the budget.
- A roadmap for saving time into Karbon automatically, which needs Karbon to add an API for it (docs/roadmap.md).

### Changed

- HourHop now asks for access to one site, Karbon's API (`api.karbonhq.com`). It makes no request until Karbon keys are entered, and only ever reads.

### Fixed

- The note editor could clear its "saved" message on a slow machine.
- Review's day strip has more room, and a day's hours no longer spill out of the highlighted day; on narrow cards hours stack over minutes.
- The Hours this week chart and the Settings cards fit narrow windows (320px) without pushing the page sideways.

### Known limits

- The Karbon integration is built and tested against Karbon's published API specification with a simulated Karbon; it has not yet been verified against a live Karbon account.

## [0.2.0] - 2026-11-19

### Changed

- New "control room" look: frosted glass over an ambient-lit dark room, rounded pill controls and the Manrope typeface, bundled with the extension.
- The timer card is now a budget dial: the arc fills toward the work item's time budget and turns red when over. Pause, Resume and Stop are round controls.
- Recent and Favorites show work as tiles; every work item has one play button that switches the timer, and pauses or resumes the running one.
- New "This week" chart in the side panel and a week day strip plus hours chart in Review.
- Review and Settings use a round navigation rail and glass cards.
- Dark is now the default theme for new installs; System and Light remain in Settings.

## [0.1.1] - 2026-11-19

### Fixed

- Removed a large empty gap under the Status filter in the side panel; form fields in dialogs no longer reserve extra height.
- The search box shows one clear (×) button instead of two.

## [0.1.0] - 2026-11-19

First public release.

### Added

- Side panel work switcher with one global timer: start, switch, pause, resume and stop, with every session and interval kept per work item.
- Toolbar popup showing the current timer, with pause, stop and "Open work switcher".
- Search, Recent, Favorites and All lists with a status filter; completed work asks before starting.
- Track locally mode for your own clients and work items, plus a sample-data mode with made-up clients.
- Plain-text notes, role, task type and billable flag per session.
- Review by day or week with audited edit, split, discard and "keep as recorded"; per-date totals for sessions crossing midnight.
- "Copy for Karbon" text for manual entry, and CSV and JSON export.
- Dark, light and system themes; keyboard navigation.
- All data stays in the browser profile; no network requests, no analytics, one permission (`sidePanel`).

[0.3.0]: https://github.com/vikichand/hourhop/releases/tag/v0.3.0
[0.2.0]: https://github.com/vikichand/hourhop/releases/tag/v0.2.0
[0.1.1]: https://github.com/vikichand/hourhop/releases/tag/v0.1.1
[0.1.0]: https://github.com/vikichand/hourhop/releases/tag/v0.1.0
