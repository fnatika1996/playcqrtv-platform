# CQRTV localization authoring contract

CQRTV UI supports Russian (ru), English (en), and Romanian (ro). Translation is authored and reviewed in the repository; runtime machine translation is not used.

## Add UI text

- Give each new visible string a stable semantic key such as profile.matchmaking.empty_state. Add that key and reviewed text to all three locale catalogs in assets/i18n.mjs.
- In static HTML, use data-i18n="key" for leaf text and data-i18n-placeholder, data-i18n-title, data-i18n-aria-label, or data-i18n-alt for translatable attributes. Keep a Russian fallback in markup where it helps first paint.
- In a new dynamic component, use window.CQRTVI18n.t(key, params, safeFallback) when composing text, or call window.CQRTVI18n.bind(root) after adding a subtree that carries those data attributes. Rebind after changing values or attributes while the component is active.
- Keep interpolation placeholders identical across locales. Use Intl.DateTimeFormat, Intl.NumberFormat, and Intl.PluralRules for locale-sensitive values.
- Never translate user-authored nicknames, social labels, URLs, custom announcements, or freeform admin content. Mark a custom-data subtree with data-i18n-ignore when it could otherwise be interpreted as UI.

## CI contract

The account CI discovers every root HTML entrypoint automatically and checks its locale metadata, localization runtime import, static UI text, and accessible/translatable attributes. It checks dictionary key parity, interpolation parameters, fixed client/server messages, semantic key references, and browser-rendered text. A new raw human-readable label without catalog coverage fails CI. A newly added semantic binding with no RU/EN/RO catalog entries also fails CI. The regression test covers both a rejected raw addition and an accepted fully translated new-page fixture.

The checker has a deliberately small content allowlist for product/proper names: CQRTV, CS2, Counter-Strike 2, ELO, Steam, FACEIT, the CQRTV copyright mark, the ID/K/D table metrics, and the locale codes RU/EN/RO. It does not allowlist arbitrary page copy. User-generated content is excluded only where the UI marks it with data-i18n-ignore or the existing custom-content selectors.

At runtime, an unknown semantic key keeps its deliberate fallback and emits cqrtv:i18nmissing; on localhost or with ?i18nDebug, the missing key is also logged to the console. CI treats unresolved keys as failures.
