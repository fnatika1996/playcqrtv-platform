# CQRTV Design System — v1.0

Status: **baseline of the existing live interface + agreed rules for future work**.  
Product: **CQRTV / playcqrtv.com**, competitive CS2 matchmaking and player profiles.  
Updated: **2026-11-15**.  
Owner approval: **required for any new or changed page design before implementation**.

> IMPORTANT: This document standardizes the existing visual language. It does **not** authorize a redesign of already approved pages. Current source code is the truth for existing behavior; new values below are targets for future/approved work, not a claim that every old element already complies.

## 1. Style direction

- Dark, compact esports UI: serious, readable, high-contrast and functional.
- CQRTV orange is the **single primary brand accent**; avoid purple, blue, bright gradients or unrelated colors for primary actions.
- Restrained borders, subtle depth, consistent alignment and predictable interactive states.
- Use orange to signal primary action, current selection, progress and brand emphasis; do not paint whole pages orange.
- Prefer clear player/match data hierarchy over decoration. No unapproved animation, blur, glow or background imagery.
- Do not add geographic labels such as “Moldova” to the CQRTV logo without a separate design approval.
- Do not replace the existing logo, illustration or icon pack without explicit approval.

## 2. Color tokens

These are grounded in the current :root of index.html (some supporting neutrals also appear as literal colors in current CSS).

| Semantic name | Hex | Usage |
| --- | --- | --- |
| background / --bg | #101113 | Page background |
| surface / --panel | #17191D | Cards, dialogs, side panels |
| surface-raised / --panel2 | #1C1E23 | Alternate panel surface |
| field background | #202227 | Inputs, secondary buttons, inset blocks |
| border / --line | #292B30 | Regular panel separators |
| border-strong | #35373D | Form outlines |
| text / --text | #F3F3F2 | Main readable text |
| text-muted / --muted | #8B8E96 | Secondary text; verify contrast at small sizes |
| brand-primary / --orange | #FF7629 | Main CTA, active states, brand |
| brand-light / --orange2 | #FF9A4C | Highlights and carefully controlled hover accents |
| brand-hover | #FF8B44 | Existing primary button hover |
| success / --green | #85D493 | Success / valid |
| danger / --red | #F07171 | Error / destructive / lost match |

Suggested aliases for any future token consolidation (do not silently restructure the current CSS):

~~~css
:root {
  --bg: #101113;
  --panel: #17191d;
  --panel2: #1c1e23;
  --line: #292b30;
  --text: #f3f3f2;
  --muted: #8b8e96;
  --orange: #ff7629;
  --orange2: #ff9a4c;
  --green: #85d493;
  --red: #f07171;
  --radius: 12px;

  /* Proposed semantic aliases; introduce only during an approved refactor */
  --cqrtv-field: #202227;
  --cqrtv-border-strong: #35373d;
  --cqrtv-brand-hover: #ff8b44;
  --cqrtv-radius-sm: 8px;
  --cqrtv-radius-md: 12px;
  --cqrtv-radius-lg: 16px;
}
~~~

**Accessibility:** maintain sufficient contrast for text and important non-text controls. Treat WCAG 2.2 AA as the target (generally 4.5:1 for normal text, 3:1 for large text and relevant UI boundaries). Avoid relying on orange/green/red alone to convey a result; add icon and/or label. Check contrast rather than assuming all current small metadata text passes.

## 3. Typography

The live site already imports **Lexend Deca** and **Teko** using Google Fonts:

- **Lexend Deca**: primary interface, body, forms, buttons and readable data labels; weights 400 / 500 / 600 / 700 / 800 as loaded.
- **Teko**: large esports/display headings, prominent ELO numbers and brand labels; weights 500 / 600 / 700 as loaded. Avoid Teko for long copy and small form hints.
- Fallbacks: use existing --font-ui and --font-display stacks from index.html, not a newly invented family.
- UI body baseline: 14px, line-height about 1.5–1.6. For new text-heavy views, consider 16px on mobile.
- Helper/secondary text target: at least 12px when legibility matters. Several legacy widgets currently use 9–11px; treat that as technical debt, not a mandate to repeat it.
- Headings: page title ~28–38px in Teko; card title ~17–20px Teko; forms/dialog title ~30–36px Teko, responsive. Size is driven by visual hierarchy and mockup.
- Do not force all-uppercase text. Keep casing and localization appropriate to the actual label.
- Define tabular numerals where available for numeric comparisons, and use consistent spacing in CS2 stats.

## 4. Spacing, sizing and radii

Use a 4px spacing rhythm for new UI, primarily: **4 / 8 / 12 / 16 / 24 / 32 / 40 / 48px**. Larger screen sections may use 64px. Avoid arbitrary one-off gaps unless the approved mockup needs them.

- Default content card: 18px desktop padding / 15–16px mobile padding; 1px border, 12px radius.
- Dense rows or chips: 8–12px internal spacing.
- Between major columns/cards: ~16px desktop, ~12px mobile.
- Default field, outlined button: 8–9px radius.
- Regular card / navigation surfaces: 10–12px radius.
- Dialog: 16px radius.
- Icon-only controls: at least 44×44px **tap target** on touch interfaces; visible icon may remain 16–20px.
- Main buttons and form fields: target 44px tall. Legacy compact desktop actions may be shorter if previously approved; do not copy <44px touch targets to new mobile views.
- Border typically 1px. Shadows restrained: use existing dark shadows, with orange emphasis only for important focus/primary elements.

## 5. Buttons and controls

### Primary action
- Solid #FF7629 background, dark foreground around #1A130F, bold label.
- Default target height 44px, radius 8px; hover #FF8B44.
- One visually dominant primary CTA per local panel/flow.
- States: default, hover, focus-visible (clear 2px ring), pressed, loading, disabled. Disable duplicates while a request is pending; feedback must remain visible.
- Do not modify existing authentication, forms or payment behavior as a by-product of styling.

### Secondary / outline
- Background #202227, border around #383A40, light text; hover background ~#25272C and stronger border. Less emphasis than primary.
- For ghost/icon buttons, preserve clear hit area, tooltip/accessible name, visible keyboard focus.

### Dangerous and status actions
- Use semantic red (#F07171) for destructive actions, never the orange primary by default. Require an appropriate confirmation for irreversible actions.
- Success uses green (#85D493) plus text/icon, not green alone.

### Inputs, selects, country picker, passwords
- Target height 44px, background #202227, border #35373D, light text, radius 8px.
- Persistent visible label (do not use placeholder as sole label), helper text and inline error/validation.
- Focus-visible state at least 2px distinguishable ring; error border/status plus text description.
- Native keyboard navigation and screen reader semantics are mandatory for custom country listboxes, filters and dialogs.
- Password visibility toggle must be keyboard-operable and have accessible label/state.
- Preserve login, signup, nickname checks, email verification, reset, agreements and API contracts.

## 6. Cards and page structure

- Standard card: background #17191D, 1px solid #292B30, radius 12px, padding 18px desktop / ~15px mobile.
- Nested stat tile: subtle darker/lighter surface (e.g. #1B1D21 or #202227) with minimal border. Do not nest multiple shadows unnecessarily.
- Important cards (ELO, matchmaking queue) may use existing orange-tinted gradient accents, but do not invent saturated colors or oversized glows.
- Keep title / metadata / action aligned consistently. Use sensible wrapping and min-width: 0 in flex/grid children so long player names or map names cannot force horizontal scrolling.
- Tables, match results and statistics must remain legible on narrow viewports; prioritize content, stack secondary data where needed rather than clipping.
- Preserve existing profile banner / avatar language and the CQRTV orange brand mark unless approved otherwise.
- Use the **existing 18 selected SVG icons** extracted by the GitHub workflow from “Icon Play CQRTV.rar”; reuse before adding a different icon set.

## 7. Responsive rules

The current index.html uses breakpoints at **1120px, 760px and 390px**. Keep these as the baseline when editing existing pages; avoid introducing a parallel breakpoint scheme without reason and approval.

| Width | Intended layout |
| --- | --- |
| >1120px | Full desktop: topbar, left icon rail (~62px), main column and right sidebar (~258px); main content max width ~1500px. |
| 761–1120px | Compact desktop/tablet: left rail (~58px), main content; right sidebar is hidden or intentionally moved if approved. |
| <=760px | Mobile: 60px topbar, no fixed left rail, single main column, smaller spacing, touch-accessible controls. Two-column stat tile layout may remain if legible. |
| <=390px | Small phone: single-column critical forms, compact header, no cut-off dialogs/actions, content wraps. |

Additional non-negotiables:
- Test at **1440px, 1024px, 760px, 390px, 375px, and 320px**; test a tall and short phone viewport.
- No horizontal body scrolling, overlapping controls or clipped buttons. Horizontal scroll may be used only for a clearly signaled tab strip or consciously approved data region.
- Ensure dialogs fit viewport: current signup target is width min(760px, viewport−28px) with scrollable max-height. On small phones, use safe padding, accessible close button and enough room for keyboard.
- Test with a virtual keyboard open and with 200% zoom; don't hide errors below inaccessible clipped areas.
- Preserve reading order when stacking grids. Do not shrink text until it becomes illegible just to retain desktop geometry.
- Prefer CSS grid/flex and responsive sizing rather than fixed widths. Check 44×44px tap targets on touch devices.

## 8. Motion, feedback and accessibility

- Transition durations normally 150–220ms for hover, focus and small overlays; use longer only when justified and approved.
- Respect prefers-reduced-motion and do not use continuous animated decoration as a substitute for status.
- All actions must work with keyboard; dialogs must have correct focus/close behavior, and status messages use appropriate aria-live semantics.
- Include empty, loading, error, success, disabled and long-text states in new components.
- Avoid icon-only semantics, unlabelled controls, color-only error reporting and hidden scroll positions.
- In authentication and privacy-sensitive screens, prioritize clarity over decorative effects.

## 9. Component checklist / reference mapping

| Component | Existing source reference | Rule for future work |
| --- | --- | --- |
| Site navigation | index.html: .topbar, .brand, .rail, .topnav | Retain dark layout and orange active indicator |
| Primary/outline buttons | index.html: .primary-btn, .outline-btn | Reuse patterns and tokens before inventing variants |
| Cards / stat blocks | index.html: .card, .stat, .elo-card | Consistent surfaces, spacing, borders and data hierarchy |
| Signup modal | index.html: .signup-dialog, .signup-field, .signup-actions | Do not rewrite registration business logic; keep keyboard/phone use |
| Country picker | index.html: .country-picker | Accessible country choice, readable flags/names, no trapped scroll |
| Auth / reset | auth.html | Preserve semantics and validation; harmonize visuals only with approval |
| Icon set | .github/workflows/deploy.yml | Reuse 18 selected SVG icons before external libraries |

## 10. Mandatory ChatGPT → approval → Codex workflow

1. **Observe first**: inspect current page/code and collect the required screen states.
2. **Design first**: ChatGPT proposes a desktop and mobile visual mockup plus states; this proposal is **not yet approval to code**.
3. **Owner approval**: wait until the owner explicitly confirms the design. If visual requirements are unclear, ask targeted questions or offer variants.
4. **Implementation spec**: translate the approved mockup into precise Codex instructions: dimensions, spacing, tokens, component states, responsive rules and permitted files.
5. **Implement in a feature branch**: Codex follows this document, reuses existing patterns and changes only the approved scope. Do not “improve” unrelated screens.
6. **Verify**: visually compare desktop and mobile with mockup; test keyboard, touch, long text, form errors, and regressions. Summarize any unavoidable deviation.
7. **Review, then deploy**: project deploys on push to main. Keep unapproved UI changes off main; merge only when approved.

**Source of truth precedence for visual work:**
1) explicit **latest approved mockup / owner instruction** for the specific page; 2) this design system for everything not explicitly overridden; 3) existing component patterns and CSS. If these conflict materially, flag the conflict rather than silently guessing.

## 11. Release and maintenance

- Canonical documents: root AGENTS.md (Codex execution rules) and this file (visual standard).
- Current implementation is primarily inline CSS/HTML in index.html and auth.html; a future shared stylesheet/token migration must be proposed separately and approved.
- For every new component/page, reuse existing tokens/classes where practical; don't add duplicate but near-identical styles or new fonts.
- Keep screenshots and textual acceptance criteria with each approved change/PR. Give visual changes a brief before/after summary.
- Do not modify GitHub Actions deployment, backend contracts, secrets or infrastructure for a design-only task.
- Version this document when an **approved** brand/design decision changes; record why. Do not silently replace the brand palette or typography.

## 12. Suggested acceptance criteria for all new UI tasks

- [ ] Matches the latest owner-approved desktop and mobile mockups.
- [ ] Uses CQRTV colors, Lexend Deca / Teko and agreed spacing scale.
- [ ] Reuses components and icons, no arbitrary new design language.
- [ ] Responsive at 1440 / 1024 / 760 / 390 / 375 / 320px; no unwanted clipping.
- [ ] Buttons, inputs, dialogs and menus are keyboard/touch accessible, with visible focus.
- [ ] Loading, empty, error, validation, long-text and disabled states are covered.
- [ ] Existing login/registration/CS2 flows are not broken by design changes.
- [ ] Owner-reviewed branch/PR before merging into auto-deployed main.
