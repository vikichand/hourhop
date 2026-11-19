# HourHop roadmap

Work planned but not built, with what each item depends on.

## Save time into Karbon automatically

**Status:** blocked on Karbon. **Owner:** to be raised with Karbon.

Today HourHop reads your assigned work and budgets from Karbon, but time still has to be entered in Karbon by hand (Copy for Karbon, then Mark entered). Karbon's API v3 can read time entries (`GET /v3/IndividualTimeEntries`, `GET /v3/Timesheets`) but has no endpoint for creating or updating them, as of the published specification dated October 2026 ([karbonhq/karbon-api-reference](https://github.com/karbonhq/karbon-api-reference)).

To build it:

1. Ask Karbon for a supported way for an approved application to create time entries for the signed-in user: an endpoint, its required fields (work item, date, minutes, role, task type, note, billable), and how duplicates and WIP-locked periods are handled.
2. Once that exists, add a deliberate **Submit to Karbon** action in Review with confirmation, an outbox that survives restarts, read-back of the created entry before showing it as confirmed, and no blind retries when the outcome is unknown.
3. Until a created entry is read back from Karbon, sessions stay "Not sent automatically". A session is shown as confirmed only with Karbon's own entry ID.

Automating Karbon's website to type entries in is out of scope: it would break Karbon's terms of use.

## Per-person Karbon access

**Status:** idea. Karbon has no "sign in with Karbon" for other apps, so the current integration uses the firm's API keys in each browser. A small server holding the keys and handing each colleague only their own work would remove firm-wide keys from browsers, and is a prerequisite for a public Chrome Web Store listing.

## Smaller items

- Restore from a JSON backup.
- Optional inactivity prompt and time-format setting.
- Chrome Web Store listing (privacy policy page, store screenshots, developer account).
