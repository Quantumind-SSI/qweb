# QuantumindSSI Qweb Project Notes

Static HTML site for QuantumindSSI products and services. 19 pages, no build
step for the front end, deployed to Azure Static Web Apps.

## Design system

All styling lives in `css/`. Load order matters and is the same on every page:

| File | Owns |
|---|---|
| `tokens.css` | Colour ramp, type scale, spacing, radii, elevation, motion, z-index, HUD metrics. **The only file permitted to contain a raw value.** |
| `base.css` | Reset, document defaults, typography, focus, motion/print preferences |
| `layout.css` | Page shell, containers, grid system, flex primitives, section rhythm |
| `hud.css` | Cockpit chrome: frame, rails, bars, brackets, ticker, readouts, spec lists |
| `components.css` | Nav, footer, buttons, cards, forms, dialogs, tables, badges, hero |
| `compat.css` | Bridges legacy variable names and component classes onto the system |
| `patterns.css` | Generated. Component rules that were duplicated across 3+ pages |

Page-specific CSS stays in a `<style>` block in that page, after the system
links so it cascades on top.

### Rules

- **Never hardcode a colour, size, radius or duration.** Use a token. If a
  token does not exist, add it to `tokens.css`.
- **Never use `outline: none`** without an equivalent visible focus indicator.
  `base.css` provides `:focus-visible` globally; do not override it.
- Text must clear **4.5:1** against its background. The token ramp is verified
  against `--bg-void`, `--bg-base`, `--surface-1` and `--surface-2`.
- Grids use the `.grid--*` utilities. Do not write inline
  `style="grid-template-columns: …"`.

### The HUD, and why it never overlaps content

`--hud-rail` and `--hud-bar` in `tokens.css` size the fixed cockpit chrome
**and** the padding the document reserves for it (`body` rule in `layout.css`).
One pair of numbers, two consumers — they cannot drift apart.

Below 900px both tokens collapse to `0` and `.hud` is hidden, so mobile gets
the full viewport.

Layering is a named scale (`--z-below` … `--z-tooltip`). The HUD sits at
`--z-hud` (200): above the page, below the nav (300), below every overlay.

## JavaScript

`js/` is dependency-free and progressive — every page reads and works without it.

| File | Purpose |
|---|---|
| `config.js` | Runtime config. **Gitignored**, generated at deploy time. See `config.template.js`. |
| `api.js` | Posts form submissions to `/api`. Also provides `db` / `formFeedback` shims for pages still using the old call style. |
| `qssi.js` | Nav drawer (focus trap, Escape, scroll lock), `aria-current`, clock, ticker pause, backdrop, dialogs, form handling, `depthFX` 3D tilt + cursor light |
| `assistant.js` | Athenoir widget. Renders only when `QSSI_CONFIG.athenoir.enabled`. Talks to the same-origin `/api/chat` proxy — the inference endpoint and key are server-side only. |

### The 3D layer (depth & light)

Interactive surfaces tilt toward a fine pointer and catch a travelling
specular; the index hero floats a wireframe cube over a receding grid floor.

- All magnitudes live in `tokens.css` under `--depth-*` / `--light-size` /
  `--cube-size`. Nothing else may hardcode a perspective, angle or radius.
- `[data-tilt]` = instrument surfaces that rotate toward the cursor
  (`--tilt-x` / `--tilt-y` / `--tilt-lift`); `[data-light]` = cards that only
  catch the specular (`--mx` / `--my`). Use `data-tilt` with restraint — one
  cluster per page is the rule, not every card.
- `js/qssi.js` `depthFX()` feeds the custom properties: one shared rAF loop
  that runs **only while a surface is tracked**, lerp easing, fine pointers
  only (`(hover: hover) and (pointer: fine)`), disabled under
  `prefers-reduced-motion`. No JS → the page is flat but fully intact.
- Motion is transform/opacity only — compositor-friendly, no paint triggers.

Display type is Chakra Petch (`--font-display`), applied to `h1`/`h2` only;
body is DM Sans, data is Space Mono. If a display font needs emphasis inside
a heading, use colour (`font-style: normal`), not italics — Chakra Petch has
none.

## Local development

```bash
python3 serve.py            # http://localhost:8080/
```

`serve.py` resolves extensionless routes and serves `404.html` with a 404
status, matching Azure Static Web Apps.

For the API, run Azure Functions Core Tools separately:

```bash
cd api && npm install && func start
```

Copy `api/local.settings.json.example` to `api/local.settings.json` and fill in
the storage and ACS connection strings.

## Backend — fully on Azure

Forms POST to `/api/enquiry` (Azure Functions v4, `api/src/functions/`). The
function validates against a field allow-list, applies a honeypot and a
per-IP throttle, writes to **Azure Table Storage**, then emails the team via
**Azure Communication Services**. A failed email never fails the submission.

**No storage credential is ever sent to the browser.** Supabase is gone: a
previous version committed a live anon JWT in `supabase-client.js` and wrote
to the database directly from the client.

| Form key | Azure Table |
|---|---|
| `sales-enquiry`, `fbc`, `local-ai` | `SalesEnquiries` |
| `contact`, `faq` | `ContactSubmissions` |
| `preorder` | `Preorders` |
| `waitlist` | `HeimdallWaitlist` |
| `community` | `CommunitySignups` |
| `careers` | `JobApplications` |

`/api/chat` is the Athenoir proxy (`api/src/functions/chat.js`): it bounds
the request (32KB body, 20 messages, 2,000 chars each), throttles per IP,
and forwards to the configured HTTPS deployment with an optional bearer
key — the endpoint URL and key never reach the browser, so the CSP stays
`connect-src 'self'`.

Entities use a `YYYY-MM` PartitionKey and a reverse-tick RowKey, so partitions
stay small and the newest submission sorts first.

`js/api.js` shims the old `db.from(table).insert()` / `formFeedback()` calls
onto this API, so page-level form code did not need rewriting.

### Reading submissions

Azure Portal → storage account → Storage browser → Tables, or:

```bash
az storage entity query --table-name SalesEnquiries \
  --connection-string "$(az storage account show-connection-string \
    -n <account> -g rg-quantumindssi-web --query connectionString -o tsv)"
```

## Deployment — Azure Static Web Apps

- `staticwebapp.config.json` — routing, cache headers, CSP and security headers
- `.github/workflows/azure-static-web-apps.yml` — CI/CD, generates `js/config.js`,
  blocks the build if a JWT is found in tracked source

### Required Azure configuration

Static Web App → **Configuration → Application settings** (server-side only):

| Setting | Purpose |
|---|---|
| `AZURE_STORAGE_CONNECTION_STRING` | storage account holding the tables |
| `ACS_CONNECTION_STRING` | Azure Communication Services |
| `ACS_SENDER` | `DoNotReply@<domain>` |
| `NOTIFY_EMAIL` | where enquiries are delivered |
| `ATHENOIR_ENDPOINT` | HTTPS inference URL for the `/api/chat` proxy |
| `ATHENOIR_API_KEY` | optional bearer token for the inference deployment |
| `ATHENOIR_MODEL` | model id for the proxy (default `unsloth/Llama-3.2-3B-Instruct`) |

Provisioned resources (resource group `rg-quantumindssi-web`, West Europe):

| Resource | Name |
|---|---|
| Static Web App (Standard) | `swa-quantumindssi` |
| Storage account | `stqssiweb…` |
| Communication Services | `acs-quantumindssi` |
| Email Communication Services | `ecs-quantumindssi` |

GitHub repository → **Settings → Secrets and variables**:

| Name | Type | Value |
|---|---|---|
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | secret | deployment token from the Azure portal |
| `ATHENOIR_ENABLED` | variable | `true` / `false` — the only Athenoir value the browser sees |
| `SUPPORT_EMAIL` | variable | fallback contact address |

## Tools

```bash
python3 tools/migrate.py [page.html]   # port a page onto the design system
python3 tools/dedupe.py                # regenerate css/patterns.css
```

Both are idempotent.

## QA scripts (Playwright)

Playwright is declared in the root `package.json`. One-time setup:

```bash
npm install                        # JS package (browsers not included)
npx playwright install chromium    # browser binary for the scripts below
```

Run against the local server:

```bash
npm run serve   # terminal 1 — http://localhost:8080/
npm run audit   # terminal 2 — layout, contrast, images, console errors
npm run shot    # terminal 2 — full-page screenshots to /tmp/qweb-shots
```

## SEO files

`robots.txt` and `sitemap.xml` live at the repo root and are served as-is.
The sitemap lists the 18 public pages by their canonical extensionless URLs
(`https://quantumindssi.com/<slug>`). When a page's content changes, update
its `<lastmod>`; when adding or removing a page, update the sitemap in the
same commit.

## Originals

`img-orig/` holds the pre-optimisation source images. Site assets are WebP;
regenerate from `img-orig/` if you need a different size.
