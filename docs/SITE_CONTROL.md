# CQRTV Site Control

## Admin workflow

Open `/admin/site-control` from the CQRTV admin dashboard. The editor requires an active, verified administrator session and uses the existing admin CSRF token and same-origin checks.

The public mode is stored in PostgreSQL:

- `open` serves the normal CQRTV site.
- `coming_soon` serves the configurable pre-launch page.
- `maintenance` serves its own configurable title, subtitle, status and description.

The initial migration inserts `open`, so deploying the feature does not close the public site. Changing the date/countdown never changes the mode automatically. The settings are read on each request, so a saved update takes effect without rebuilding or restarting Docker.

## Enforcement and recovery

Caddy asks the API gate before serving public static files. For a closed mode it rewrites every public file route to `site-closed.html`; public API requests are separately rejected by the API. Only health, the public landing settings/media endpoints, admin login assets and authenticated admin routes remain available. A valid admin session can preview the normal site while it is closed. A forged request header cannot select the mode: Caddy removes it before the auth subrequest, and the gate returns the canonical mode.

If the database or settings row is unavailable or invalid, public static access stops at the gate and protected APIs return an error; admin login and health checks remain reachable for recovery. Do not expose the internal API port publicly.

## Editable content and assets

Page copy and social links are stored in `site_control_settings` and `site_control_social_links`. Only enabled links are returned publicly, and URLs must be credential-free HTTPS URLs. Public copy is rendered with text nodes, not HTML.

Uploaded background images and social icons are stored as PostgreSQL bytea assets. The API accepts PNG, JPEG and WebP only, verifies their file signatures, and limits each file to 2 MiB. SVG uploads and arbitrary file paths are rejected. Existing CQRTV pack icons remain available as presets. Replaced/unlinked assets are cleaned up where they are no longer referenced. Include site-control assets in routine PostgreSQL backup/restore validation.

The landing page uses CSS-only background motion, can disable it in settings, and respects `prefers-reduced-motion`. Its information dialog supports keyboard focus, Escape, close button and backdrop click. No third-party game or stock artwork is bundled.

## Verification

PR CI uses a disposable PostgreSQL schema plus a mocked Caddy gate for browser checks. The mock is test-only; it does not contact Hostinger, production databases, email, or the live site. Responsive Playwright screenshots are uploaded as a workflow artifact. A green CI run does not replace the separately approved production release.
