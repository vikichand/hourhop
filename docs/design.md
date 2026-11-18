# HourHop - Karbon — Product Design System

**Version:** 1.2  
**Updated:** 2026-11-19  
**Purpose:** Binding, reference-led UI and interaction contract for the HourHop browser extension, with testable anti-pattern replacements.  
**Scope:** Manifest V3 side panel, toolbar popup, time review, onboarding, settings, and all application states.  
**Status:** PROPOSED ART DIRECTION — owner supplied visual inspiration; actual extension not yet rendered or approved; live Karbon integration blocked

## 1. Identity, design intent, and source-of-truth contract

**Internal project identity:** `HourHop - Karbon`; **independent brand shown prominently:** `HourHop`; tagline: `Switch work. Track time.` Public listing candidate: `HourHop for Karbon`, **not approved for publication until trademark/affiliation review**. The proposed label identifies compatibility, not ownership or endorsement. Do not copy Karbon's marks, Karbon's product chrome, or any logos from the reference screenshot. Keep all display-name variants in one app-metadata/i18n entry, not separate hardcoded strings in each view. Keep existing `KWS-001..036` IDs despite the name change.

**Intended character:** a disciplined, dark-first professional utility — precise, confident, compact, instantly scannable, quietly premium. Not a consumer-rewards landing page, cyberpunk dashboard, glassmorphism showcase or generic AI-generated SaaS panel. Support a fully finished **light theme**, browser/system default, and high-contrast/forced-colors adaptations. The visually restrained theme must never be used to hide important data or focus indications.

**Nonnegotiable functional hierarchy:** active target and correct timer state > pause/stop/switch > search and recent/favorite work > clear budget scope > today/review > account/integration status. In an idle state, search and recent work take priority over an empty timer. Fewer decorative pixels, more client/work rows per viewport. The panel is an app workspace, not a mini marketing site.

**Single exact-value owner once code exists:** `src/ui/tokens.css` (primitive → semantic → optional component aliases). Every screen uses the shared token and component system. This document owns visual intent, accessible behavior, selected references, and acceptance rules, but **not a second independently hand-edited palette**. The seed values below become proposals for `tokens.css`, then `tokens.css` becomes authoritative. No duplicate root `DESIGN.md`; if tooling requires it, generate a verified adapter. Use `docs/design.md` as the tracked human-readable contract, and do not copy generic Design Systems 101 into the app.

## 2. Reference inventory and precise adaptation

### R0 — Owner screenshot (included unchanged)

- **Asset:** `myDocs/references/1000083021.jpg` (portrait consumer-rewards UI, visible `doppdock` branding and Nike card).
- **Observed visual traits:** very dark navy-black/ink backdrop; slightly raised charcoal panels; low-chroma purple hairline/selected boundaries; subtle cyan at one corner; large white primary labels; muted cool-grey secondary labels; isolated CTA; dramatic vertical spacing; soft rounded outer shell; deliberate grouped cards; minimal visible icon families.
- **Image-specific details we deliberately reject:** Doppdock/Nike trademarks and photos; loyalty metrics, social-proof row, coins and marketing CTA; irregular clipped/notched corners; bright iridescent multicolor button; exaggerated floating tabs; extra-large 30–40px gaps and tall marketing cards; unreadably faint grey-on-dark copy; dramatic glow and gradient overlays. A narrow productivity side panel cannot afford those costs.
- **Adapt closely:** ink/charcoal layering, calm violet as a *single* accent, typographic contrast, sophisticated restrained shape and section spacing.
- **Adapt rather than imitate:** one quiet active-session rail and restrained selected-work treatment instead of large ornamental borders; one subtle tonal primary action instead of rainbow gradient.
- **Do not imitate:** typography, exact layout, branded imagery, UI notches, text content, and rewards mechanics.

### Other functional research references (URL only; not bundled art)

| Ref | Source | Useful fact/pattern | Scope and exclusions |
|---|---|---|---|
| R1 | [Karbon native timer (2021)](https://karbonhq.com/release-notes/june-14-2021/) | Existing time-tracking vocabulary, work context and timer controls | Borrow terminology only; no pixel-copy or Karbon branding |
| R2 | [Karbon Time & Budgets](https://karbonhq.com/resources/introducing-time-and-budgets-embedded-in-your-workflow/) | Estimate/actual/remaining information types | Compact factual budget labels, not a mini finance dashboard |
| R3 | [Karbon Work Dashboards](https://karbonhq.com/resources/karbon-work-dashboards/) | Client and work-item labels, status metadata | Row-level identity, not Kanban tiles |
| R4 | [Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel) and [Chrome UI](https://developer.chrome.com/docs/extensions/develop/ui) | The side panel stays accessible beside page content; popup is transient | Browser-native window behavior and constrained width |
| R5 | [Nielsen Norman Group: usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) and [aesthetic minimalism](https://www.nngroup.com/articles/aesthetic-minimalist-design/) | Recognition, system-status visibility, familiar language, only relevant information | Practical interaction standards, not an endorsement of any specific palette |
| R6 | [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) and [Chrome extension accessibility](https://developer.chrome.com/docs/extensions/develop/ui/a11y) | Contrast, focus, keyboard, labels, zoom, accessibility semantics | Verified against rendered UI, not only token pairs |
| R7 | [Apple typography guidance](https://developer.apple.com/design/human-interface-guidelines/typography) and [design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles/) | Clarity and disciplined type hierarchy | General design evidence, not an instruction to imitate Apple system UI |

### Reference-to-screen map

| Screen / state | R0 aspects to preserve | R0 aspects to avoid | Functional reference and acceptance |
|---|---|---|---|
| Side panel — actively tracking | Dark tonal panel, crisp number hierarchy, violet controlled emphasis | Reward card, enormous outer padding, neon framed every section | R1/R4: active client+work name, elapsed, pause/stop and one-action switch all visible at ~360px |
| Side panel — idle/search | Calm background with obvious focused section | Hero-sized blank artwork or CTA | R3/R5: recent work and search above nonessential messages; 8+ typical rows visible if height permits |
| Work item results | Dense neutral list, one selected-row accent | Separate rounded marketing card for every result | R3/R5: exact client and work title, current status, optional budget note and correct action |
| Budget compact/expanded | Discreet progress treatment, two-tone hierarchy | Decorative coin, unlabeled circular chart, fake growth numbers | R2/R6: scope and source explicit: work total vs my allocation, local vs Karbon posted |
| Popup | Same theme, typographic clarity | Duplicate full dashboard/cards | R4: current timer/status and open-panel action only; popup can close safely |
| Review & edit | Clear information grouping | Floating curved panels for every entry | R5/R6: genuine dates, separate intervals, notes, edit provenance and sync state |
| Onboarding, offline, errors, settings | Consistent tonal surfaces and hierarchy | Marketing illustrations, nonfunctional connecting CTA, confetti | R4/R5/R6: transparent permissions, honest manual/demo state, usable recovery |

**Reference R0 is a design influence, not an approved mockup**. The agent must compare actual Chrome captures with these traits and document why differences make the timer easier to use. User silence does not constitute design approval.

## 3. Information architecture and specific layouts

### 3.1 Side panel — canonical main app

Design for **320–600 CSS px**, especially 320, 360, 400 and 480, without assuming a specific Chrome sidebar width or that users can freely enlarge it. At narrow width, one column; no two-column client/work grid. Content can scroll; a compact current-session summary stays reachable while the work list scrolls if measurements permit. Do **not** create a permanent oversized sticky header that leaves only four results visible.

**Tracking active — top-to-bottom:**

1. **Header (compact, single row):** HourHop wordmark, tiny honest connection state (`Local only`, `Connected`, `Stale`), Settings icon with accessible label. If `Karbon` is shown, treat it as a compatibility reference, not an endorsement or confirmed connection.
2. **Active tracking block:** small `Tracking now` eyebrow paired with running/paused status (text + dot); one-line client name, up to two-line work title, high-legibility tabular `hh:mm:ss` timer; prominent primary `Pause`/`Resume`; secondary `Stop`. On wide panel controls can sit beside time; narrow widths stack as needed. Never hide the target name behind ellipses with no way to reveal it.
3. **Budget line (conditional):** `Work budget 3h 15m / 8h` and `4h 45m left`, visually small restrained bar. When individual allocation exists, show a separate labeled line `Your allocation`. If source is unknown, don't render a fake progress bar. Toggle `Budget details` for posted/local breakdown or amount-based data.
4. **Search input:** `Search clients and work items`, keyboard focus as first-class state; search is available without changing current timer; clear X only when query exists.
5. **Compact filter segmented group:** `Recent`, `Favorites`, `My Work`, `All`; count or status in an unobtrusive line. `My Work` appears only when assignee semantics are trustworthy; absent filters must not pretend to restrict account access.
6. **Work list:** one row per exact work-item ID; client label muted, work-item title medium weight, status/due/budget supporting line only where known, trailing one-action `Start` or `Switch`. Running row says `Tracking` rather than offering a second start. If a client has multiple entries, they're grouped or independently searchable without duplicating a large client header for every row. No card stacking.
7. **Today footer / review action:** aggregate tracked time from real local entries, count of sessions, `Review time` action. Distinguish `Recorded locally` from `Confirmed in Karbon`.

**Idle variation:** Empty timer area contracts to a short `No timer running` row with `Choose a work item to start`, leaving Search + Recents immediately visible. Do not show `00:00:00` as the dominant hero in idle mode.

**Switch semantics:** click a different work row => one serialized `Switch(target)` action; old session closes, new begins; UI immediately indicates busy while persistence commits, no speculative success. Same row click does not create duplicate. Keyboard activation works. If switching fails, original active target remains truthful with recovery and no false dual timer.

### 3.2 Toolbar action / popup

The **extension-action behavior must be deliberately chosen**: Chrome `action.onClicked` is not invoked if `default_popup` is defined. Therefore an always-visible popup and direct icon-open-sidepanel cannot both be assumed to work through `onClicked`. Proposed approach: toolbar popup opens, showing live timer + `Open work switcher` control; this calls the supported side panel opening API from a real user gesture. Test on actual Chrome versions. If the interaction proves unreliable, prefer action-click opening the side panel with a separate compact status affordance, and record the chosen trade-off; never ship a broken open-panel button. Reference: [Chrome guidance](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/chrome-extensions/references/extensions/side-panel.md).

Popup ~320–360 CSS px, content: brand/status, active client/work item, timer, Pause/Resume, Stop, `Open work switcher`. No independent client catalog, no dense list, no second session controller. It may unmount when losing focus; nothing important relies on popup existence.

### 3.3 Review workspace

Full extension tab or expanded workspace when responsive room is insufficient. No modal for long session-history lists. Sticky date/period filter, daily total separated by source, grouping by client/work item, individual session rows with start/end, duration, notes, pending/confirmed state, and correction actions. Editing opens a scoped accessible form with save, cancel, reason and clear audit. Local CSV/JSON export is a real action with scope explanation, not an icon-only gimmick.

### 3.4 Onboarding, settings, identity, and errors

- **First run:** compact explanation and two honest actions `Try sample data` / `Track locally`; no fake Karbon OAuth/sign-in affordance until approved. Safe, dismissible and replayable.
- **Settings:** theme/system, time display, privacy, export/delete and actual connection state. No five-step onboarding wizard, decorative usage graphs or unnecessary profile fields.
- **Disconnected / permission denied:** maintain local tracking; stale Karbon fields must show last-refreshed time if a later supported integration exists. No spinner where a recovery button is possible.
- **Account/tenant switch:** old firm's names never leak into newly selected identity. Show a clear, non-destructive export/retention choice.
- **Manual notes:** plain editable text only. Do **not** render a microphone, recording indicator, sparkles, AI rewrite, model/download label or a disabled future-feature button in Phase A. Voice and AI bullet formatting remain deferred.

## 4. Visual foundations — proposed palette and geometry

The design uses neutral density and whitespace for hierarchy. Violet is meaningful only for active/switch/focus/selected states, **not** a decoration on each card. Cyan from R0 may appear as a *tiny optional* secondary accent in a static illustration/logo exploration but must never compete with the running state or create multicolor buttons. The safer baseline is **one accent**. Dark should feel warm-ink/blue-black, not pure `#000` with neon edges. Light mode is a deliberate translation, not automatic inversion.

These are **seed candidates for implementing `src/ui/tokens.css`**, not multiple authoritative palettes:

| Role | Dark draft | Light draft | Usage |
|---|---|---|---|
| Canvas | `#111218` | `#F6F7FA` | Whole app background |
| Raised surface | `#1A1B24` | `#FFFFFF` | Active-session group, menus and review panels |
| Quiet surface | `#22232E` | `#ECEFF4` | Hover, secondary controls, selected-neutral background |
| Primary text | `#F2F3F7` | `#1B1C25` | Labels, work title and time |
| Secondary text | `#A9AFBF` | `#5A6271` | Client label, timestamps, metadata |
| Active accent | `#A99AF4` | `#5846A9` | Selected/running indication and action; test inverse button text |
| Strong control boundary | `#72758E` | `#7D8495` | Focus/inputs and essential component borders |
| Subtle separator | `#45465A` | `#D8DDE6` | Decorative row separators only, never essential focus-only edge |
| Focus indicator | `#C7BBFF` | `#5141A4` | Clearly visible focus outline plus gap/offset |

**Calculated token-pair spot checks, not a WCAG pass:** Dark primary on raised surface ~15.45:1; dark secondary ~7.81:1; dark accent ~7.03:1. Light primary on white ~16.94:1; light secondary ~6.14:1; light active accent on white ~7.33:1. Strong control boundaries on their nearest raised surface ~3.79:1 dark and ~3.75:1 light. Subtle separators are *not* adequate as the sole indication of an input or selection. Recompute with final token values, hover/disabled/alpha compositing, focus outlines and all statuses. The chosen primary-button fill needs an explicitly tested on-color.

**Typography:** prefer native/system-optimized UI sans stack (`system-ui`, `-apple-system`, `Segoe UI`, sans-serif) with no external font download, no ornamental geometric display face, no artificially spaced uppercase headings. Use 4 consistent weights/roles at most: normal metadata/body, semibold work title, strong numeric timer, section title. Proposed panel roles: 12–13px labels, 13–14px body, 14–16px work titles, 26–34px timer (clamp by width), 15–17px section title. Preserve 1.35–1.5 body line-height, never squish to 11px to make a card fit. `font-variant-numeric: tabular-nums` for duration and amounts. Section titles in sentence case; cap decorative eyebrow uppercase labels to rare status lines.

**Spacing and shape:** base 4px spacing scale, 12–16px panel gutters, ~8–12px related-control gap, ~16–20px between sections, minimum practical clickable target 40–44 CSS px where layout allows (including meaningful icon buttons), 10–14px panel group radius, 8–10px input/button radius; avoid universal 24px pills. One subtle border or elevation for the active timer; a thin separator between work rows; avoid card-in-card-in-card. Radius, spacing, typography and motion live only in tokens after implementation.

**Iconography:** one licensed outline icon family with consistent 1.75–2px apparent stroke at 16–20px size; use named text buttons for Pause/Resume/Stop/Switch because icons alone are ambiguous. Avoid random emoji, 3D glyphs, two unrelated icon packs or vague progress/ring symbols. Real branding/icon assets require owner/licensing review and must not reuse R0 logos.

**Motion:** no ambient background animation. Simple 100–180ms opacity/transform for disclosure and state transitions, tokenized; timer digits update without reflow; no sparkling, bobbing icons, confetti, pulsing gradients or perpetual glow. Respect `prefers-reduced-motion`, tab/panel visibility, and inactivity. A running-state dot can be static. Animation must never mask a state transition or impose recurrent CPU load.

## 5. Shared component contracts (exactly one implementation)

| Shared component | Required variants/behavior | Visual contract and verification |
|---|---|---|
| `AppShell/Header` | panel/popup/review/setting mode; identity + status | Same typography and spacing; truthful connection badges, not colorful decorations |
| `Button`, `IconButton` | primary, secondary, quiet, danger, disabled, busy | One canonical implementation; visible focus ring and text equivalents; minimum practical hit target |
| `TimerDisplay` | idle, running, paused, review-needed | Tabular numerals; DOM update isolated from search focus; accessible state announced on changes, not 1Hz chatter |
| `TrackingPanel` | idle/active/paused/switching/error | One raised surface, crisp target title, controls stable; no tall hero when idle |
| `WorkRow` | default/hover/focus/running/selected/disabled | Compact list item with client/work/status and one obvious action; stable keyed identity |
| `SearchCombobox` | query, clear, matches, loading, none | Native input semantics; arrows/Enter/Escape; preserve caret across timer ticks and list refreshes |
| `FilterGroup` | recent/favorite/my work/all | Selected label visually obvious; no repeated colorful badges |
| `BudgetSummary` | absent/unavailable/zero/time/amount/near/over | Explicit scope, provenance and remaining, optional actual meter if real data; no empty fake bar |
| `StatusText` | local/pending/confirmed/uncertain/failed/stale | Both text and symbol, never rely only on color; shared copy vocabulary |
| `SessionRow/EditForm` | date, interval, correction, notes, audited edit | Dense but readable with clear source/state and keyboard access |
| `Dialog`, `Toast`, `Tooltip` | positive/negative/cancel, focus/escape | Accessible semantics and focus return; durable errors inline; no toast flood |
| `Empty/Loading/ErrorState` | distinct demo, empty, denied, stale, offline, fail | Real, specific recovery; short direct copy and no stock art |

Each primitive must be imported across every applicable surface, including first-run and settings; page-specific compositions can use domain metadata but cannot instantiate an alternative Button, Card, Input or Status component. Enforce architecture via AST/import checks and visual state tests, not vague styling instructions.

## 6. Complete interaction-state quality contract

At minimum test:

- Start idle → running; running → paused; paused → resumed; stop; switch work; same-work select; switching transaction error.
- Multiple sessions for a target across days, and actual versus local totals without double counting.
- Search input remains focused with caret position while timer counts; dropdown keyboard navigation and recovery after live list update; row key stable.
- Long, unusual Unicode client titles and work titles; malicious HTML is text, not DOM. Truncation reveals full value to assistive technology.
- No client data; no matching search results; no favorites; no budget; budget unknown; budget zero; time/monetary budget; overrun; partial budget permissions.
- Local save, confirmed external entry, pending and uncertain submission, stale integration, no integration, no network, revoked identity; no fake `Connected`.
- Onboarding sample versus local mode, session review, CSV/JSON export, multi-interval correction, destructive data deletion confirmation.
- The **same state** across popup, panel, review and settings; reopen after browser restart, MV3 worker suspension, and theme switch. Side panel and popup can coexist without duplicate timer sources.
- Theme light/dark/system, minimum widths, 100/150/200% browser zoom, long localization, OS high-contrast/forced colors, visible `:focus-visible`, reduced motion and keyboard-only flows.

## 7. Prohibited patterns → required replacements → tests

| Disallowed pattern / where | Approved replacement | How to catch it |
|---|---|---|
| Rainbow/aurora gradients, purple-to-cyan CTA, shimmering glass across panel | Solid/tonal surfaces, one violet active accent, clear button text | Audit screenshot at 320/360/480 in dark/light and search CSS for unapproved `linear-gradient`, `backdrop-filter` |
| Floating oversized cards for each client or work item | Compact one-line/two-line rows with subtle separators, active row highlighting | 20-row visual density review and scrolling performance E2E |
| Beveled/notched borders and glowing outlines copied from R0 | Ordinary consistent 10–14px groups and single meaningful active rail | Compare R0 reference map and all card variants, no arbitrary `clip-path` or border pseudo art |
| Shadows as the only grouping cue | Rhythm, surface tone, meaningful separators and headings | Check light/dark and forced-color screenshots |
| Tiny grey labels to emulate mockup atmosphere | Legible tested secondary tokens and text scaling | Rendered-composite contrast >=4.5:1 ordinary text; 200% zoom; inspector/a11y |
| Decorative numbers, fake percentages, meaningless chart rings | Only true elapsed duration and correctly scoped Karbon/local budget values | Fixture tests for no-budget/unavailable and screenshots with no spurious metrics |
| Mixed fonts, font experiments, italic fintech headline, extreme letter spacing | Consistent system sans + tabular timer numerals | Font token audit; screenshot comparison across platforms |
| Generic template headers, AI stars/sparkles, gradients and hero illustrations | Minimal HourHop header and immediate work interaction | Visual inspection that first active/idle view centers real work |
| Hidden hover-only actions, icons without labels, stripped outlines | Text-primary actions, focus-visible ring, keyboard/assistive labels | Keyboard E2E and axe/a11y checks |
| Over-designed dashboard in transient toolbar popup | Current time and controls + explicit open-panel button | Real Chrome popup closes/reopens without losing state; click behavior tested |
| Frequent entire-tree redraw to update seconds | Isolated `TimerDisplay` update and keyed rows | Hold search focus for 60 ticks and assert caret/input unchanged |
| Blue/green `Synced` after local persistence | `Saved locally`; `Confirmed in Karbon` only after verified receipt | No false-positive sync tests, disconnected fixtures |
| Duplicate theme/control values per entrypoint | One `tokens.css` and shared component modules | CSS literal allowlist and import-graph CI test |
| Copying reference logo, exact Nike card, proprietary images, or Karbon mark | Original HourHop design / neutral shapes; third-party compatibility in text only if cleared | Asset provenance and store metadata review |

Exceptions: a **single** original, licensed branded illustration/gradient in a separately approved About/onboarding moment may be considered later if it adds a proven value and passes motion/contrast/performance tests. Do not apply any generic 'no gradients' rule beyond the narrow primary work interface.

## 8. Acceptance tests and evidence

`KWS-031` and `KWS-036` require actual browser UI evidence after the *last* UI change, not just documentation or a Storybook mock:

1. **R0 adaptation audit:** compare uploaded original with the side panel (idle, running, paused, switching, compact budget), popup, review and settings. Mark specific adopted/rejected traits. A polished screenshot alone is not sufficient; actions have to work.
2. **Capture matrix:** real unpacked extension Chrome screenshots at 320, 360, 400 and 480 CSS px (where browser permits), 100%, 150%, 200% zoom; light/dark; long titles, missing budgets, running, paused, selected row, error, offline/stale/uncertain, focus. No hidden controls, overflow, inaccessible scroll or missing interaction on cramped screens.
3. **A11y:** WCAG 2.2 AA **target**, keyboard-only Start/Pause/Stop/Switch/Search/Review, stable focus after redraw, screen-reader names/states, meaningful hover and reduced motion. Contrast >=4.5:1 for normal text, >=3:1 for large text and applicable non-text controls; inspect the *rendered composite*, including borders over hover/selected surfaces. WCAG 2.4.13 Focus Appearance is **AAA**, but we adopt a clearly visible tokenized ring as a product rule rather than falsely calling it an AA requirement.
4. **Component/token consistency:** test AST/import boundaries to prohibit duplicated primitives; reject unexplained raw CSS color/font/radius/motion literals outside tokens; audit output bundles for unapproved SVG/fonts/assets.
5. **Extension-specific runtime:** verify actual side-panel open controls, popup lifecycle, `default_popup` versus `action.onClicked` behavior, worker restart, focus retention on time ticks and rehydration, and actual Chrome action click paths.
6. **Design critique:** compare before/after user tasks: current work visible without scrolling, work-switch action obvious and achieved in one selection, list density and readability, no deceptive budget or sync status, no visual drift between popup/panel/review/settings. Record mismatches tied to screenshot/build SHA and fix feasible cases.

### Evidence and provenance

Design methodology source: permanent Project Source `Design-Systems-101-v1.0.md` (not copied into app). Research references and why they apply are documented in `myDocs/research.md`; original R0 image and mapping are in `myDocs/references/`. Consult Chrome, WCAG and WXT docs anew for version-sensitive implementation details. **Do not claim WCAG conformance or approved design until tested in a real browser.**

## 9. Governance and change control

App owner approves visual direction and final public name. A design-system change updates the one canonical token/component source, the relevant human-readable rule here, and affected real E2E snapshots/tests in the same change. Any style exception is scoped with reason, a positive alternative and measurable check. New UI surfaces (onboarding, settings, popup, review) are included in the affected-surface inventory before cross-cutting changes. Preserve supplied reference source bytes unchanged; never claim image-perfect reproduction of a competitor concept.

## 10. Implementation record (0.1.0, 2026-11-19)

- **Token authority:** `src/ui/tokens.css` now owns every exact value. The section 4 seeds were adopted unchanged for the shared roles and resolved per theme with CSS `light-dark()` driven by `color-scheme` (so the extension requires Chrome 123+). Theme choice is System, Dark or Light in Settings. `tests/ui-guards.test.ts` rejects raw colour, pixel, timing and font literals outside `tokens.css`, raw controls outside `src/ui/components.tsx`, gradients, `backdrop-filter`, `clip-path` and keyframe animation.
- **Toolbar action (section 3.2):** the popup design was kept. The `Open work switcher` button calls `chrome.sidePanel.open({ windowId })` synchronously in its click handler, with the window id fetched when the popup mounts. `e2e/timer.spec.ts` opens the real toolbar popup with `chrome.action.openPopup()`, clicks the button with a trusted CDP mouse event and asserts that the side panel target appears and the popup closes. If `chrome.sidePanel` is missing, the button opens the same workspace in a tab.
- **R0 audit (adopted):** ink and charcoal layering, one violet accent used only for running state, selection, primary action and focus, a single left rail on the active timer and active row, white primary and cool grey secondary text at tested contrast, compact rows with separators, generous but bounded section spacing.
- **R0 audit (rejected, verified absent):** logos and brand imagery, reward cards and metrics, notched or clipped borders, iridescent or gradient buttons, floating tabs, oversized vertical gaps, glow, and faint low-contrast copy. No R0 file is in the bundle (`e2e/package-audit.spec.ts` compares hashes).
- **Accepted gap:** 200% zoom inside a 360 px panel leaves 180 CSS px, below the 320 px floor in section 3.1, and overflows horizontally. 150% and 200% zoom at 320 CSS px or wider pass.
