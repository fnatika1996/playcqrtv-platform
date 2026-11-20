# CQRTV icon usage map

The authoritative icon source is the owner-provided `Icon Play CQRTV.rar`. The builder selects only the 38 reviewed SVG entries in `assets/icons/cqrtv/admin-icon-manifest.json` and generates `assets/icons/cqrtv/ui/<file>`, `admin-icon-map.json`, and `admin-icon-sprite.svg`. The generated SVG directory is a build artifact; CI audits it after archive extraction.

## Approved mapping changes

| UI location | Archive SVG | Source in `Icon Play CQRTV.rar` | Reason / check |
|---|---|---|---|
| Home — desktop side rail | `home.svg` | `Essentional UI/Home--playcqrtv.svg` | Exact Home meaning; visually distinct from Matches |
| Home — mobile bottom tab | `home.svg` | `Essentional UI/Home--playcqrtv.svg` | Same Home action as desktop |
| Matches — desktop rail and mobile tab | `gamepad.svg` | `Electronic Devices/Gamepad--playcqrtv.svg` | Kept as the game/match action |
| Teams — desktop rail | `users.svg` | `Users/Users-Group-Rounded--playcqrtv.svg` | Group of players; replaces account-security shield |
| Players — disabled desktop rail item | `user.svg` | `Users/User--playcqrtv.svg` | Player directory/person; separate from profile identity |
| Settings — desktop rail | `settings.svg` | `Settings Fine Tuning/Settings-Minimalistic--playcqrtv.svg` | Gear/settings replaces reorder glyph |
| Registration hero CTA | `invite.svg` | `Users/User-Plus-Rounded--playcqrtv.svg` | Create-account action |
| Registration submit | `invite.svg` | `Users/User-Plus-Rounded--playcqrtv.svg` | Same create-account action |
| Registration password controls | `eye.svg`, `eye-closed.svg` | `Security/Eye--playcqrtv.svg`, `Security/Eye-Closed--playcqrtv.svg` | Preserve existing show/hide states and accessible button |
| Registration close and success | `close.svg`, `check.svg` | `Essentional UI/Close-Circle--playcqrtv.svg`, `Essentional UI/Check-Circle--playcqrtv.svg` | Archive equivalents for close and success status |
| Registration Support role, primary + secondary | `shield.svg` | `Security/Shield-Check--playcqrtv.svg` | Archive source is a shield with check; it matches the existing support glyph's meaning and rendered silhouette |
| Profile Settings sidebar and panel heading | `settings.svg` | `Settings Fine Tuning/Settings-Minimalistic--playcqrtv.svg` | Settings affordance uses settings icon |
| Profile Edit action | `edit.svg` | `Messages Conversation/Pen--playcqrtv.svg` | Kept for the actual edit action |

All other semantically correct archive usages remain unchanged. In particular, the approved five-person hero art, navigation layout, and four large feature illustrations remain unchanged.

## Inline SVG exceptions

The blocking audit scans production HTML and rejects an unapproved inline SVG. The current small allowlist is intentionally explicit:

| Page / selector | Count | Treatment |
|---|---:|---|
| `index.html .feature-illustration` | 4 | Large decorative matchmaking, ELO, tournament, and statistics scenes. These are illustrations, not UI glyphs; retain as approved page art. |
| `index.html .role-option[data-role="awper|entry|rifler|igl"] .role-icon` | 8 total (2 per role) | Role-specific AWPer, Entry, Rifler, and IGL glyphs have no semantic match among the 38 selected archive SVGs. Preserve their distinct meaning. Support is not exempt because `shield.svg` is an appropriate match. |
| `index.html .country-picker-chevron` | 1 | Simple downward disclosure mark; no downward-chevron alias exists in the selected manifest. Keep the small existing stroke mark instead of substituting a misleading archive icon. |
| `auth.html .verify-icon` | 1 | Existing larger email-verification success emblem; decorative status artwork retained. |

Counts are enforced so the exceptions cannot silently expand. New inline UI icons require a separately documented and approved exception or an archive mapping.

## Manifest `usedBy` field

The `usedBy` values in the JSON manifest are descriptive metadata and do **not** control extraction, runtime lookup, or sprite generation. Existing entries that say “Existing public site path compatibility” record why an alias remains in the curated pack; they are not a complete inventory of rendered instances. The rows above are the current canonical page-to-icon map. This P0 updates `usedBy` for the icons whose actual usage changed; the builder continues to use only each entry's `key`, `file`, and `source`.

## Verification

`scripts/check-cqrtv-icon-usage.mjs` runs after RAR extraction in the non-production browser QA job. It checks every manifest file exists in the generated directory, all app-owned icon paths resolve to a manifest alias and generated file, sprite references/map/symbols agree with the manifest, and production HTML contains only the inline exceptions above. Its negative tests prove that a missing generated icon and an undocumented inline SVG fail CI.

The existing browser QA produces homepage screenshots at 1440, 390, and 320 px (and other breakpoints), plus locale fixtures for RU/EN/RO and guest/synthetic-member states. It checks the rendered Home/Matches SVG symbols, Settings cog mapping, registration role glyph, and accessible show/hide controls. These are isolated QA fixtures; they do not send real registrations or email.
