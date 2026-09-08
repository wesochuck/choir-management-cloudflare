# Browser E2E fixtures

Shared mocked-API layer for Playwright specs. `auth.spec.ts` was split by behavior on top of these
helpers; new mocked suites should reuse them instead of inlining `page.route(...)` setup.

## Layout

- `builders.ts` — contract-aware payload builders. Every builder validates through its
  `@choir/contracts` schema and serves the input unchanged, so a contract change fails next to the
  fixture definition instead of letting a stale mock stay green. Request-driven echo routes
  (PUT/POST handlers reflecting the browser body) are the deliberate exception: their shape is owned
  by the live request.
- `session.ts` — identity surface: health, current session, OTP/password sign-in, recovery,
  sign-out, `/account/*` security and session endpoints.
- `organization.ts` — membership surface: account organizations, auth-status, module state, setup
  status, platform MFA status, and the invitation lifecycle.
- `apiMocks.ts` — workspace composers: `installOrganizationApi` (session + organization +
  roster/events/attendance/seating/singer/donations collections with mutable handles) and
  `installPlatformAdminMocks` (`/platform/*` journeys).
- `fullstack.ts` — full-stack helpers (`bootstrapFullstack`, `pollFullstackOtp`,
  `signInWithFullstackOtp`, `uniqueFullstackName`). Only `*.fullstack.spec.ts` suites import it.

## Example

```ts
const api = await installOrganizationApi(page, { role: "administrator", strict: true });
api.donations.set([buildDonation({ buyerName: "Ada Donor" })]);
// ... test steps ...
api.assertNoUnexpectedRequests();
```

Specs express only differing behavior. Spec-specific routes may be registered after install; later
`page.route(...)` registrations shadow earlier ones, including the strict guard.

## Mock scope rules

- Fully-mocked suites pass `{ strict: true }` and finish with `api.assertNoUnexpectedRequests()`.
  The guard records any app `/api/**` request that reaches no registered mock and serves a 404; the
  assertion fails the test with the leaked URLs. Add the missing mock to the fixture layer instead
  of widening the spec.
- Full-stack suites (Phase 3 smoke tests that reach the real local Worker/D1) do the opposite:
  minimal interception, stubbing only external/provider boundaries such as payment or email. Those
  suites must NOT use `installOrganizationApi` or `{ strict: true }`; name them
  `*.fullstack.spec.ts` so the two styles stay distinguishable.

## Full-stack suites (`*.fullstack.spec.ts`)

Full-stack specs reach the real local Worker, CONTROL_DB D1, and the test Organization's Durable
Object through the preview proxy. They prove frontend/Worker contract agreement that mocked suites
cannot detect: live responses are parsed with `@choir/contracts` schemas, and UI assertions run
against Worker-persisted state (including after a reload).

- Seeding: `POST /api/local/fullstack-bootstrap` resets exactly one deterministic tenant
  (`organization-fullstack` / `fullstack.admin@example.test`), implemented in
  `apps/worker/src/routes/localFullstackSeed.ts`. That module answers 404 unless
  `APP_ENV === "local"`, so staging and production have no test backdoor. Cleanup is built in:
  bootstrap deletes the test tenant's control-plane rows before re-inserting them, and specs use
  `uniqueFullstackName()` so per-run entities never collide with rows left by earlier runs. No
  manual cleanup is needed; no other Organization, user, or session is touched.
- Sign-in: the one-time code travels through `PLATFORM_EMAIL_MODE=capture` (no real email leaves the
  machine) and is read back through the local-only `GET /api/local/fullstack-otp` seam, then entered
  through the real sign-in UI.
- Providers: local `wrangler.jsonc` already isolates them (`EXTERNAL_EFFECTS_MODE=fake`,
  `CUSTOM_DOMAIN_PROVIDER_MODE=fake`, `PLATFORM_EMAIL_MODE=capture`), and the chosen journeys use
  offline paths only (manual cash/check donations, rehearsal events). No `page.route(...)`
  interception is registered for app APIs; only genuinely third-party browser beacons may be ignored
  per spec, documented at the top of that spec.
- Hostname: specs drive the local Worker origin directly (`http://localhost:8787`, which serves both
  `/api/*` and the built SPA) because the preview proxy rewrites the Host header to `127.0.0.1`,
  which is not a canonical auth hostname. Organization routes resolve the tenant from the request
  hostname, and only `localhost` hostnames are canonical auth hosts when `PRODUCT_BASE_DOMAIN` is
  `localhost`.
- Commands: `npm run test:e2e:fullstack` runs just these suites on the Chromium projects (forced to
  one worker: the files share a single tenant, so parallel workers would reset each other's OTP
  rate-limit counters); `npm run test:e2e` runs everything (mocked + full-stack) on the Chromium
  projects. Cross-engine runs are opt-in (see "Cross-browser smoke" below).

## Cross-browser smoke (Phase 6)

Desktop/mobile Chromium stays the normal fast path. `npm run test:e2e` and
`npm run test:e2e:fullstack` pin `--project=chromium --project=mobile-chromium`, so routine runs
never silently grow when a new engine project is added.

The `webkit-smoke` Playwright project (`playwright.config.ts`, Desktop Safari device, which carries
`defaultBrowserType: "webkit"`) runs a small `@webkit-smoke`-tagged critical-path set on the Safari
engine: 7 tests covering the highest-risk journeys from the plan (mobile navigation, music playback,
forms/dialogs, mobile-viewport layout), with both mocked and full-stack styles plus axe scans
represented.

| Spec                                | Tagged test                                                          | Why it is in the smoke set                                                    |
| ----------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `foundation.spec.ts`                | renders the accessible foundation at desktop and mobile widths       | Anonymous layout baseline at both widths, mocked, viewport-agnostic           |
| `player.spec.ts`                    | renders practice player with artwork, track navigation, and set list | Music playback transport, voice-part sheet dialog, responsive set-list branch |
| `accessibility-axe.spec.ts`         | open mobile navigation has no serious accessibility violations       | Mobile nav drawer at an explicit 390px viewport plus axe                      |
| `accessibility-axe.spec.ts`         | practice player has no serious accessibility violations              | Player accessibility-tree coverage on WebKit                                  |
| `accessibility-axe.spec.ts`         | record-donation modal has no serious accessibility violations        | Forms/dialog focus and labeling coverage on WebKit                            |
| `health-session.fullstack.spec.ts`  | serves the anonymous landing page from the real Worker               | Full-stack contract check against the real Worker, no mocks                   |
| `manual-donation.fullstack.spec.ts` | records an offline donation that survives a reload                   | Full-stack forms/dialog flow with persistence across reload                   |

Commands:

- `npm run test:e2e` — Chromium projects only (fast path, unchanged default).
- `npm run test:e2e:webkit` — WebKit smoke only. The `scripts/run-e2e-webkit.mjs` wrapper passes
  extra args through to Playwright and, on failure, points at the install command below. Needs
  `npx playwright install webkit` once per machine.
- `npm run test:e2e:all-browsers` — Chromium projects plus the WebKit smoke set.
- `npm run check:release` stays Chromium qualification. The plan explicitly does not require every
  engine on every run, so WebKit smoke is an opt-in/periodic check, not a release gate.

To reproduce one browser-specific failure:

```text
npm run test:e2e:webkit -- apps/web/e2e/player.spec.ts -g "renders practice player"
```

Engine-agnostic notes: the tagged tests use only portable APIs (`page.route` fulfillment,
`addInitScript` media mocks, `setViewportSize`, axe scans). Clipboard permissions
(`clipboard-read`/`clipboard-write`) are granted per Chromium project in `playwright.config.ts`
because WebKit rejects them as unknown permissions; that scoping is also why the setlists clipboard
test stays Chromium-only. The player spec branches on `testInfo.project.name.includes("mobile")`;
`webkit-smoke` takes the desktop branch at the Desktop Safari viewport, matching its device.
Deliberately excluded from the smoke set: the setlists clipboard test
(`context.grantPermissions(["clipboard-read", "clipboard-write"])` is Chromium-oriented), the
`auth.admin-navigation` drag-and-drop `DataTransfer` journey (a long Chromium-owned suite), and the
`responsive.audit` breakpoint ladder (already covered on Chromium).

Firefox is evaluated but deferred: WebKit covers the non-Chromium engine risk that matters for
Safari/iOS users, and no Firefox-specific product surface justifies the extra install, runtime, and
maintenance cost today. Firefox stays periodic-only: if a signal appears,
`npx playwright install firefox` plus a temporary project entry reproduces it, and only measured
signal promotes it to a smoke project.

When adding a test to the smoke set, append ` @webkit-smoke` to its title, keep the set small
(roughly 5–10 tests so routine runs stay fast), and update the table above.

## Spec inventory

Mocked (no live Worker dependency):

- `auth.admin-navigation.spec.ts`, `auth.attendance.spec.ts`, `auth.invitations.spec.ts`,
  `auth.organization-mfa.spec.ts`, `auth.platform.spec.ts`, `auth.routing.spec.ts`,
  `auth.seating.spec.ts`, `auth.session.spec.ts`
- `auditions.spec.ts`, `communications.spec.ts`, `donations.spec.ts`, `foundation.spec.ts`,
  `member-dashboard.spec.ts`, `mfa-prompt.spec.ts`, `modules.spec.ts`, `music-catalog.spec.ts`,
  `player.spec.ts`, `player-offline.spec.ts`, `polls.spec.ts`, `reports.spec.ts`,
  `resources.spec.ts`, `responsive.audit.spec.ts`, `roster-automation.spec.ts`,
  `roster-profile.spec.ts`, `setlists.spec.ts`, `setup-checklist.spec.ts`, `ticketing.spec.ts`

Accessibility scans (mocked, axe-based, run in both Chromium projects; the `@webkit-smoke` subset
below also runs on WebKit):

- `accessibility-axe.spec.ts` — WCAG 2 A/AA scans of sign-in, member dashboard, roster table,
  record-donation modal open, mobile navigation open, and the practice player. Serious and critical
  impacts fail unless they match the tolerated color-contrast baseline documented at the top of that
  spec (measured 2026-09-07: accent/secondary palette below 4.5:1 in the listed spots). New
  violations, and any contrast node matching no baseline entry, fail the run. The donations scan
  registers one spec-specific `tickets/orders` route after install for donor suggestions, per the
  shadowing rule above.

## Manual accessibility testing (not automated)

Automation cannot prove screen-reader usability, whether focus order feels intuitive, or whether
motion and timing are comfortable. Before each release, walk through this checklist manually on
desktop and on a small viewport, in both light and dark themes:

- Keyboard only: sign in, move through the member dashboard, open and close the mobile navigation,
  open the record-donation modal, and operate the practice player (play/pause, next/previous,
  voice-part sheet, rehearsal settings). Every action must be reachable and visible via focus alone,
  with focus restored sensibly on dialog close.
- Screen reader: confirm the sign-in form, roster table (including sort buttons and the mobile-card
  reading order), pagination controls, and player transport announce their names, states, and
  values.
- Contrast spot-check: the tolerated baseline above is light-theme only. Verify the same surfaces in
  the dark theme, where the accent/secondary tokens render on dark backgrounds.
- Reduced motion and zoom: enable reduced motion and 200% text spacing/zoom on the player and
  dashboard; content must remain usable without horizontal scrolling traps.

Full-stack (real local Worker/D1/DO, deterministic seed, minimal mocks):

- `health-session.fullstack.spec.ts` — anonymous landing, health/ready/session contracts,
  non-enumerating OTP request, wrong-code rejection, unauthenticated tenant-boundary problems.
- `auth-otp.fullstack.spec.ts` — email-code sign-in, administrator auth-status contract, session
  restoration across reload, sign-out.
- `admin-event.fullstack.spec.ts` — administrator event creation through the UI, persistence across
  reload, live event-list contract agreement, invalid-payload rejection.
- `manual-donation.fullstack.spec.ts` — offline (cash) donation recording through the UI,
  persistence across reload, live donation-list contract agreement, invalid-payload rejection.
