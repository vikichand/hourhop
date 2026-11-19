# HourHop: Product Design System

**Version:** 2.0
**Updated:** 2026-11-19
**Status:** Implemented in 0.2.0; Karbon mode added in 0.3.0. Owner-approved "control room" direction, replacing the 1.x restrained-utility rules.
**Scope:** Side panel, toolbar popup, review, settings, first run and every state of the Chrome extension.

KWS-nnn labels refer to the project's private requirement list.

## 1. Direction

HourHop is the control room for an accountant's working day. The look is frosted glass floating over a charcoal room lit by one warm orange lamp from the bottom right. There is no purple: an earlier violet light pool and accent read as generic, so the owner replaced them with charcoal and orange (0.5.0). Big rounded shapes, pill tabs and circular controls make it feel like a modern device panel, not a form.

The owner supplied two references, kept privately and never bundled:

- **A dark rewards card:** ink-navy surfaces, violet hairlines, white primary text, and an iridescent lilac, aqua and cream "Activate" button.
- **A smart-home dashboard:** frosted glass panels over a blurred room, pill room tabs, a thermostat dial with tick marks, device tiles, a monthly chart with one lit bar, a forecast-style day row and a round navigation rail.

| Reference idea | HourHop translation |
|---|---|
| Thermostat dial | The **budget dial**, the hero: thin oversized timer, arc filling toward the work item's time budget |
| Device tiles with switches | **Work tiles** with a round play or pause button |
| Room tabs | **Recent / Favorites / All work** pill tabs |
| Power chart with one lit bar | **This week** chart, today's bar lit |
| Forecast row | Review's **day strip** |
| Round nav rail | Rail on the full-tab pages (Review, Settings) |
| Iridescent "Activate" button | The single **signature gradient** |

Copied logos, brand names, photos, rewards content, clipped corners and the references' text are never used.

## 2. Rules that keep it from turning into noise

1. **Orange means live.** The accent marks only what is running or selected: the running dot, the active tile, the selected pill or option, today's bar, focus rings, the toolbar badge.
2. **One signature gradient, three places.** The lilac, aqua and cream gradient (`--iri`) appears only on the primary action (Pause/Resume, the live play button, primary buttons, the current rail item), the dial's arc, and the active timer card's edge and top sheen. Nowhere else.
3. **Warnings never look live.** Near budget is yellow (kept clearly apart from the orange accent), over budget is red (the dial arc turns red too).
4. **Numbers are the hero.** Time uses thin (200 weight) tabular numerals; labels are smaller, semibold sentence case. No all-caps eyebrows.
5. **No fake data.** The dial arc appears only for a real positive time budget. Amount budgets, missing or unavailable budgets, and zero budgets show ticks and a text summary, never an invented percentage. The week chart uses only recorded local sessions.
6. **Honest status, always in words.** "Saved on this device, not sent to Karbon", "Synced from Karbon at ...", "Not sent to Karbon", "Confirmed in Karbon: Not connected" or "Not sent automatically". Status uses text plus a dot, never colour alone.
7. **No ambient motion.** Glows are static. Transitions are 120 to 180 ms on hover and state changes only, and are removed under reduced motion.

## 3. Tokens

`src/ui/tokens.css` is the only place exact values live: primitives, then semantic tokens resolved per theme with `light-dark()`. Components use semantic tokens only; `tests/ui-guards.test.ts` rejects raw colours, pixel and timing values, font families, notched borders and keyframe animation anywhere else, and requires every gradient in the component layer to be built from tokens.

| Role | Dark | Light |
|---|---|---|
| Room background | `#131314` charcoal | `#F2F1EF` |
| Room light | one orange pool, 26% | one orange pool, 30% |
| Glass fill | white 6% | white 62% |
| Menu (open dropdown) | `#1B1B1D`, opaque | `#FAF9F8`, opaque |
| Primary text | `#F3F3F2` | `#1C1C1E` |
| Secondary text | `#BCBCC1` | `#4A4A50` |
| Tertiary text | `#8F8F95` | `#5B5B61` |
| Accent (live) | `#FF9A52` | `#96410A` |
| Signature gradient | `#CDBBFF` to `#A9E4F2` to `#F7E6B5` | same |
| Warning | `#F0D45C` | `#6F5600` |
| Danger | `#FF8A8A` | `#B3372F` |

- **Type:** Manrope Variable (SIL Open Font License), bundled with the extension from `@fontsource-variable/manrope`; no web font requests.
- **Shape:** radii 12 / 16 / 22 / 28 px and full pills; 44 px round controls, 64 px primary control, 38 px tile buttons.
- **Glass:** 22 px backdrop blur, 1 px hairline, inner top highlight.
- **Theme:** Dark is the default for new installs. Settings offers System, Dark and Light; the choice applies to every surface at once.

## 4. Surfaces

**Side panel (canonical workspace), top to bottom:**

1. Header: brand mark, mode pill (Sample data or Local only), round Settings button.
2. Timer card. Running or paused: client avatar and names, the budget dial with state, timer and budget line, round Note, Pause or Resume (signature gradient) and Stop, the "Saved on this device, not sent to Karbon" footer with the remaining-budget figure, and a "Budget details" disclosure for the scoped breakdown. Idle: a compact card with a dashed ring, "No timer running" and today's total.
3. Search pill (`/` focuses it; Escape clears it).
4. Recent / Favorites / All work pill tabs; a Status filter under All work and while searching.
5. Items. Recent and Favorites show **tiles**; All work and search results show denser **rows**. Each item has a favorite star and one play button: play on another item switches the timer in one transaction; on the running item it shows pause; on the paused item it resumes. Stop lives only on the timer card. Completed work asks before starting.
6. Add work (local mode) and Review time.
7. This week chart.

**Toolbar popup:** brand and mode pill, a ring with the timer, the live target and budget line, Pause or Resume and Stop, and "Open work switcher", which opens the side panel from the click.

**Review (full tab):** round nav rail; title, date, mode pill and both exports; the "local time only" notice; a totals card (big thin total, sessions, need review, Confirmed in Karbon: Not connected) with the week's day strip; Hours this week with today's bar lit; Sessions grouped by work item with intervals, notes, tags, Copy for Karbon and Edit.

**Settings (full tab):** rail; glass cards for Appearance, Data mode (Karbon, Local only, Sample data), Karbon connection, Your data (exports, delete with typed confirmation) and About. The Karbon card shows the three connect fields (keys as password fields) with a plain warning that the keys are firm-wide; once connected it shows who you are connected as, when it last synced, the last refresh error if any, Refresh now and Disconnect. Saved keys are never shown back.

**Karbon mode:** the mode pill reads "Karbon"; a quiet line under the header says "Synced from Karbon at HH:MM. Read-only." with a round Refresh button; a failed refresh shows an amber banner and keeps the last good work list. Review never claims confirmation: the totals say "Confirmed in Karbon: Not sent automatically", and each session has a **Mark entered** toggle whose tag reads "Entered in Karbon (marked by you)".

**First run:** ring, "Switch work. Track time.", two tiles (Track locally, Try sample data) with play buttons, and the plain statement that nothing connects to Karbon.

Every surface uses the shared components in `src/ui/components.tsx` (Button, IconButton, RoundControl, PlayButton, Dial, Ring, WeekBars, Rail, FilterGroup, SearchBox, TextField, Select, Dialog, Banner, StatusText, Avatar) and the compositions in `src/ui/parts.tsx`. Only `components.tsx` may render raw form controls or dialogs. Every dropdown is `Select`, a custom select-only combobox (WAI-ARIA pattern) styled like the inputs, with an opaque glass menu; the native `<select>` is not used anywhere because Chrome draws its open list itself and it cannot match the design. A guard test rejects any `<select>`.

## 5. Accessibility and responsiveness

- WCAG 2.2 AA is the target and is checked with axe on the rendered pages in both themes: side panel (first run, running, paused, searching), review, the edit dialog and settings.
- Every icon-only control has an accessible name ("Pause: Alder & Finch Joinery Ltd, VAT return Q3"); round controls also show a visible label.
- Visible focus rings on everything; focus stays on a tile's button through a switch; dialogs return focus to their opener.
- Forced colours keep every boundary and the live state visible.
- Layout works from 320 to 600 CSS px in the panel, and at 150% and 200% browser zoom down to 240 CSS px. The full-tab pages reflow to one column, and the rail turns horizontal, below 640 px. Components that sit in cards of varying width size themselves to their card (container queries), never the window: Review's day strip stacks hours over minutes when one-line durations would not fit, and drops to four columns in a very narrow card. No text or control may spill out of its own box at any supported width; `e2e/ui-quality.spec.ts` checks every surface for it.

## 6. Verification

`pnpm e2e` drives the built extension in Chromium (and in Google Chrome with `BRANDED=1`) and saves a screenshot matrix to `.tmp/evidence/`: panel states in both themes and four widths, the real toolbar popup, review, settings, zoom and forced colours. A UI change is done only when the guards, the axe scans and this matrix pass and the screenshots have been looked at against Section 2.

## 7. Change control

The owner approves visual direction. A design change updates `tokens.css` or the shared components, this document and the affected tests in the same change. New surfaces reuse the shared components; one-off styling is not allowed.
