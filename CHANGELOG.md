# Changelog

All notable changes to HourHop are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

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

[0.1.1]: https://github.com/vikichand/hourhop/releases/tag/v0.1.1
[0.1.0]: https://github.com/vikichand/hourhop/releases/tag/v0.1.0
