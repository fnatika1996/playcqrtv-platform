# CQRTV localization authoring contract

CQRTV UI supports Russian (ru), English (en), and Romanian (ro). Translation is authored and reviewed in the repository; runtime machine translation is not used.

## Add UI text

- Give each new visible string a stable semantic key such as profile.matchmaking.empty_state. Add that key and reviewed text to all three locale catalogs in assets/i18n.mjs.
- In static HTML, use data-i18n="key" for leaf text and data-i18n-placeholder, data-i18n-title, data-i18n-aria-label, or data-i18n-alt for translatable attributes. Keep a Russian fallback in markup where it helps first paint.
- In a new dynamic component, use window.CQRTVI18n.t(key, params, safeFallback) when composing text, or call window.CQRTVI18n.bind(root) after adding a subtree that carries those data attributes. Rebind after changing values or attributes while the component is active.
- Keep interpolation placeholders identical across locales. Use Intl.DateTimeFormat, Intl.NumberFormat, and Intl.PluralRules for locale-sensitive values.
- Never translate user-authored nicknames, social labels, URLs, custom announcements, or freeform admin content. Mark a custom-data subtree with data-i18n-ignore when it could otherwise be interpreted as UI.

## Legacy compatibility boundary

The current server and browser still contain legacy UI strings that are recognized by the RU source text they historically used. Those unchanged literals are frozen in `docs/i18n-legacy-html-baseline.json` by exact file and exact value. The baseline is a compatibility inventory, not an authoring pattern: CI rejects any new string literal in the covered source modules or inline scripts, even if the same raw text is added to the catalog. New user-facing copy must use a stable semantic key and an authored RU/EN/RO catalog entry, with `t(key, params, fallback)` or an explicit `data-i18n*` binding. Dynamic HTML is inspected for each bound text node and translatable attribute; one bound element does not exempt unbound siblings.

The only reason to extend the source-literal inventory is a reviewed non-human code value (for example, an API route, SQL fragment, CSS selector, or event name). Such an entry must be demonstrably non-visible UI. Existing legacy raw-text translation is compatibility behavior while those older call sites remain; it is not the contract for new components. The runtime emits `cqrtv:i18nmissing` and can log missing translations in local/debug QA.

Source discovery walks the repository for app-owned `.js` and `.mjs` modules before linting; it does not rely on a hand-maintained client/server filename list. It includes nested browser assets, server routes, password policy, API response and mail code, and any new module elsewhere in the application tree. Explicit tooling exclusions are `qa/**`, `ops/**` (staging/generated snapshots), `api/test/**`, `node_modules/**`, `.git/**`, plus only the catalog literal prefix in `assets/i18n.mjs` (its runtime code is linted separately), the owner bootstrap CLI `api/scripts/grant-admin.mjs`, and `scripts/build-cqrtv-admin-icons.mjs`. Catalog parity/reference checks cover the excluded localization module; the other exclusions do not serve application UI. Adding a new production source directory requires changing the discovery roots and its regression fixture.

## CI contract

The account CI discovers every root HTML entrypoint automatically and checks its locale metadata, localization runtime import, static UI text, and accessible/translatable attributes. It checks dictionary key parity, interpolation parameters, fixed client/server messages, semantic key references, and browser-rendered text. A new raw human-readable label without catalog coverage fails CI. A newly added semantic binding with no RU/EN/RO catalog entries also fails CI. The regression test covers both a rejected raw addition and an accepted fully translated new-page fixture.

The checker has a deliberately small content allowlist for product/proper names: CQRTV, CS2, Counter-Strike 2, ELO, Steam, FACEIT, the CQRTV copyright mark, the ID/K/D table metrics, and the locale codes RU/EN/RO. It does not allowlist arbitrary page copy. User-generated content is excluded only where the UI marks it with data-i18n-ignore or the existing custom-content selectors.

At runtime, an unknown semantic key keeps its deliberate fallback and emits cqrtv:i18nmissing; on localhost or with ?i18nDebug, the missing key is also logged to the console. CI treats unresolved keys as failures.
