# Historical Plan Classification

Classification is based on committed baseline code/tests, not on a plan's completion language. An
implemented or partially implemented document contributes only the behavior present in executable
evidence. PocketBase mechanics and superseded component internals are not Cloudflare parity
requirements.

| Historical document                                                | Classification | Executable evidence or disposition                                |
| ------------------------------------------------------------------ | -------------- | ----------------------------------------------------------------- |
| `2026-06-12-public-landing-page.md`                                | implemented    | Public landing route/view and view tests                          |
| `2026-06-14-web-awesome-remaining-items.md`                        | superseded     | UI behavior remains; Web Awesome implementation does not          |
| `2026-06-15-roster-photo-lightbox.md`                              | implemented    | Profile photo service/UI behavior                                 |
| `2026-06-15-shoelace-full-coverage.md`                             | superseded     | UI behavior remains; Shoelace implementation does not             |
| `2026-06-15-ticket-qr-verification-design.md`                      | implemented    | Ticket validation endpoint and tests                              |
| `2026-06-15-ticket-qr-verification.md`                             | implemented    | Ticket scan route, endpoint, and tests                            |
| `2026-06-16-comprehensive-refactor-design.md`                      | partial        | Resulting domain/UI behavior matters; proposed refactors do not   |
| `2026-06-16-comprehensive-refactor.md`                             | partial        | Preserve only code/test-backed outcomes                           |
| `2026-06-16-responsive-data-table.md`                              | implemented    | `DataTable` mobile-card behavior and tests                        |
| `2026-06-16-tanstack-query-full-sweep.md`                          | implemented    | Query hooks/keys and integrity tests                              |
| `2026-06-16-tanstack-query-migration.md`                           | implemented    | Query-based baseline services/hooks                               |
| `2026-06-17-past-performances-page-design.md`                      | implemented    | Public past-performances view and tests                           |
| `2026-06-17-past-performances-page.md`                             | implemented    | Public route/view and tests                                       |
| `2026-06-17-tailwind-class-scanner-design.md`                      | irrelevant     | Repository tooling, not product behavior                          |
| `2026-06-17-tailwind-class-scanner.md`                             | irrelevant     | Legacy lint mechanics are not copied                              |
| `2026-06-20-form-control-alignment-design.md`                      | implemented    | Recognizable alignment remains a visual-parity detail             |
| `2026-06-20-form-control-alignment.md`                             | implemented    | Baseline component/layout behavior                                |
| `2026-06-20-repertoire-history-single-source-of-truth.md`          | implemented    | Report service/history tests and CSV contract                     |
| `2026-06-22-donations-view-refactor.md`                            | implemented    | Donations route/view/service tests                                |
| `2026-06-27-admin-singer-directory-toggle-design.md`               | implemented    | Directory settings/service/view tests                             |
| `2026-06-27-admin-singer-directory-toggle-plan.md`                 | implemented    | Directory visibility behavior                                     |
| `2026-06-30-performer-label-design.md`                             | implemented    | Performer-label utilities and tests                               |
| `2026-06-30-performer-label-plan.md`                               | implemented    | Performer label applied to baseline UI/exports                    |
| `2026-07-01-brevo-email-provider-design.md`                        | partial        | Email-provider settings/delivery exist; Cloudflare adapter is new |
| `2026-07-01-brevo-email-provider-plan.md`                          | partial        | Preserve provider behavior, not PocketBase transport              |
| `2026-07-02-audio-duration-auto-detect-plan.md`                    | implemented    | Duration auto-fill logic and tests                                |
| `2026-07-02-duration-mismatch-detection-plan.md`                   | implemented    | Music duration mismatch behavior/tests                            |
| `2026-07-05-patron-communications-plan.md`                         | implemented    | Donor/patron recipient resolver and tests                         |
| `2026-07-07-admin-url-warning-banner-plan.md`                      | partial        | Preserve only warning behavior found in rendered baseline         |
| `2026-07-11-first-run-experience-design.md`                        | implemented    | Setup journey, module/readiness services, and tests               |
| `2026-07-11-first-run-experience.md`                               | implemented    | Setup route and resumable steps                                   |
| `2026-07-13-communications-phase-1-mobile-send-flow.md`            | implemented    | Responsive communication wizard components/tests                  |
| `2026-07-13-communications-phase-2-drafts-settings.md`             | implemented    | Draft/template/settings services and tests                        |
| `2026-07-13-communications-phase-3-delivery-visibility.md`         | implemented    | Delivery summary/retry endpoints and UI                           |
| `2026-07-13-communications-ui-ux-polish-design.md`                 | implemented    | Baseline communication interaction evidence                       |
| `2026-07-13-communications-ui-ux-polish.md`                        | implemented    | Baseline components and tests                                     |
| `2026-07-13-pocketbase-request-hook-continuation-design.md`        | irrelevant     | PocketBase-only safety mechanism                                  |
| `2026-07-13-pocketbase-request-hook-continuation.md`               | irrelevant     | PocketBase-only implementation                                    |
| `2026-07-14-pocketbase-router-middleware-callback-scope-design.md` | irrelevant     | PocketBase generator architecture                                 |
| `2026-07-14-pocketbase-router-middleware-callback-scope.md`        | irrelevant     | PocketBase generator architecture                                 |
| `abandoned-stripe-checkouts-plan.md`                               | implemented    | Stale payment cleanup task/tests                                  |
| `attendance-view-refactoring-plan.md`                              | implemented    | Attendance view components/hooks/tests                            |
| `compose-panel-refactor-v2-plan.md`                                | implemented    | Current communications compose components                         |
| `compose-panel-refactoring-plan.md`                                | superseded     | Replaced by v2/current executable behavior                        |
| `donations_view_design_reference.md`                               | implemented    | Donations visual/interaction reference where code-backed          |
| `music-piece-modal-hook-plan.md`                                   | implemented    | Current music modal hooks/tests                                   |
| `pockethost-deploy-runbook.md`                                     | irrelevant     | PocketHost operations are not a Cloudflare requirement            |
| `pockethost-maintenance-runner-plan.md`                            | partial        | Scheduled behaviors remain; PocketHost transport does not         |
| `public-chorus-landing-page-design.md`                             | implemented    | Public landing visual/interaction evidence                        |
| `public-rsvp-refactoring-plan.md`                                  | implemented    | Public RSVP components/hooks/tests                                |
| `qr-code-logo-overlay.md`                                          | partial        | Preserve only logo/QR behavior present in executable baseline     |
| `refactoring-plan.md`                                              | superseded     | Internal organization is not parity; current behavior wins        |
| `rsvp-endpoints-split-plan.md`                                     | implemented    | Split RSVP endpoint sources/tests                                 |
| `seating-refactoring-plan.md`                                      | implemented    | Current seating behavior/tests                                    |
| `setlist-refactoring-plan.md`                                      | implemented    | Current set-list components/hooks/tests                           |
| `settings-service-refactoring-plan.md`                             | implemented    | Split settings services/tests                                     |
| `setup-wizard-plan.md`                                             | superseded     | Replaced by implemented first-run experience                      |
| `shoelace-wrapper-pattern.md`                                      | superseded     | Interaction/accessibility remains; component primitive does not   |
| `singer-modal-refactoring-plan.md`                                 | partial        | Preserve code-backed profile workflows, not modal internals       |
| `tanstack-query-migration.md`                                      | implemented    | Current query behavior and shared keys                            |
| `ticketing-implementation-plan.md`                                 | implemented    | Ticketing routes, services, hooks, migrations, and tests          |
| `ticketing-view-split-plan.md`                                     | implemented    | Current ticketing tabs/components                                 |

Accepted legacy ADRs 0001 and 0002 are copied as behavioral entries in the parity matrix through
their executable reminder-roster and performer-credit snapshot tests. Cloudflare ADRs 0003–0015
remain normative architecture rather than historical parity claims.

## August 1 refactor classification note

The PocketBase-era alias inventory was verified against current callers, tests, probes, and the
Worker route set. RSVP/quick-RSVP/unsubscribe/token aliases, legacy checkout aliases,
player-playlist, ticket validation and scan-context aliases, singer RSVP, bulk attendance/RSVP
aliases, legacy refund/resend/communication aliases, manual queue processing, calendar download, and
synchronous `organization/export.json` were hard-removed with no redirects. The forwarding helpers
and legacy buyer-email fallbacks were removed as well.

Remaining behavior was normalized to canonical namespaces for module state, queue settings,
maintenance, dues cash/refund, donation refund, health fingerprint, player tokens, public donation
checkout, public RSVP, and public player playlist. The feature matrix and expected route set were
updated in the same change; the resulting matrix contains 181 entries.
