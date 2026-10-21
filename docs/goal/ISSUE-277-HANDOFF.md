# Issue 277 implementation handoff

Updated October 20, 2026.

Issue: <https://github.com/wesochuck/choir-management-cloudflare/issues/277>.

## Immediate status and next action

**Implementation is local and uncommitted. Staging build flag configured.** Source defaults to
normalization OFF unless `VITE_PRACTICE_LOUDNESS_ENABLED=true` is supplied at build time. For
staging testing, `scripts/deploy-staging-local.mjs` and `.env.staging.local` now configure
`VITE_PRACTICE_LOUDNESS_ENABLED=true` by default during staging qualification and deployment,
allowing operator testing and physical-device matrix validation on staging while preserving the
default-off baseline elsewhere. No hosted resources, production, real messages or charges were
changed. The starting Git working tree was clean; the current feature/test/documentation and
dependency changes were made locally. Nothing has been staged, committed, pushed or submitted as a
PR.

**WebKit playback investigation resolved:** The previously observed WebKit second-track failure
(`currentTime === 0` after Next track) was diagnosed. The root cause was that after the PWA shell
caching service worker (`sw.js`) activated and claimed clients, Playwright WebKit stopped
intercepting synthetic media fixture requests through `page.route()`. The second track fetch fell
through to the local dev server which returned 404, producing an audio element error and halting
playback. Blocking the shell caching service worker in the test via
`test.use({ serviceWorkers: "block" })` (matching `member-directory-mobile.spec.ts` and
`qr-logo.spec.ts`) allows Playwright's routing layer to reliably intercept synthetic media fixture
requests across track transitions without altering real Web Audio or IndexedDB logic.

Results with `serviceWorkers: "block"` in `apps/web/e2e/loudness.spec.ts`:

- Default-off baseline (`npm run test:e2e -- loudness.spec.ts --project=webkit-smoke --workers=1`):
  **6 passed / 0 failed** across Chromium desktop, mobile Chromium (Pixel 7), and desktop WebKit.
- Enabled mode
  (`VITE_PRACTICE_LOUDNESS_ENABLED=true npm run test:e2e -- loudness.spec.ts --project=webkit-smoke --workers=1`):
  **6 passed / 0 failed** across all three browser projects; gain node and single-source assertions
  PASS.
- Normal default-off build artifacts were restored with `npm run build`.
- Browser-free canonical qualification gate (`npm run check:ci`) completed **all 19 steps
  successfully**.

These remain headless engine tests, **not physical iOS/Android, lock-screen, Bluetooth or Safari app
qualification**. Keep the feature disabled by default until physical qualification passes.

## What is implemented

- Pinned browser-only `mpg123-decoder` 1.0.3 and `bravoh-loudness` 0.1.0. No server analyzer, paid
  service, Cloudflare Container, new database, or FFmpeg runtime dependency.
- One lazy module Worker contains both decoder and meter. `analyzeMp3Stream` uses <=64 KiB
  compressed decoder calls and discards bounded PCM batches. It caps compressed input at 20 MiB,
  decoded duration at two hours; client terminates a file's worker after ten minutes or
  cancellation. MP3 only; other allowed audio still uploads/plays unchanged.
- Strict original MPEG1 Layer III frame/header reader skips bounded ID3 metadata, validates frame
  boundaries and original mono/stereo layout/sample rate, rejects truncated/inconsistent streams.
  Forced-stereo decoder output is reduced to one meter channel for original mono.
- Constant gain helper targets -18 LUFS, -1 dBTP ceiling, bounded maximum boost of 18 dB; invalid or
  absent analysis uses unity. No compression, limiting or rewriting originals.
- Forward-only Organization schema **120**: nullable `private_files.r2_version`, `audio_loudness`
  records/leases/provenance, `(status,file_id)` index for claims, five-row status counters
  maintained by triggers. Counts do not repeatedly scan the job table. No D1 changes.
- Upload finalization stores the actual R2 PUT version. Attachments enqueue analysis durably inside
  their existing transaction, independent of whether browser analysis finishes.
- Owner/Administrator-only start/claim/renew/result/status routes use existing
  `authorizeCalendarRoute(context,true)` and direct typed DO RPC. Organization identity, ready file,
  actual R2 version/metadata/size, attachment, actor, claim and algorithm version are checked. Claim
  and result routes perform bounded R2 HEAD outside DO transactions. One active two-minute
  Organization lease; renewal every 30 seconds; stale leases recover. Results commit idempotently.
- Admin browser uploads analyze their own local File after attachment; upload jobs are serialized.
  Backfill uses the existing authenticated private-file stream. Start/Resume, Pause, Retry failed,
  confirmed Reanalyze all and bounded polling are in Music Library Settings, behind the same flag.
- Public and authenticated member projections carry optional ready measurements for authorized file
  IDs. Member All tracks and Set lists, main public player, both attached-file preview components
  and Set List previews share the gain path. Batch lookups avoid per-track HTTP requests.
- IndexedDB bytes store the authorized response's `x-audio-content-version`. URL leases carry the
  version. Cached playback normalizes only when cached-byte and measurement versions match; old
  unversioned caches still play at unity. Existing 300 MiB policy remains intact. No new signed
  token persistence was added; pre-existing token metadata keys are explicitly a separate follow-up.
- Gain hook reuses one source per DOM audio element, handles conditional empty/nonempty elements and
  Strict Mode cleanup, primes/resumes context in play/row/part gestures, uses 50 ms automation
  ramps, and preserves native user volume/Media Session. Visibility/pageshow/devicechange attempt
  resumption. Partial connection fallback is tested in simulation, not claimed universally safe on
  real phones.
- Both CSP policies add only `'wasm-unsafe-eval'`, preserving nonce and Cloudflare integrations.
- File reclamation now checks `DELETE ... RETURNING id` rather than `rowsWritten === 1`: the new
  cascade/trigger writes otherwise made a successful deletion appear to fail in Workerd.
- Existing audit findings were fixed with Hono 4.13.13 and Vite 8.1.6 (including a root override for
  a vulnerable transitive Vite copy). Latest audit: zero vulnerabilities. Package lock updated.

## File map

- `packages/contracts/src/loudness.ts`, `music.ts`, `player.ts`, barrel and export snapshot:
  contracts.
- `packages/domain/src/loudness.ts` and test: constant gain/configuration.
- `apps/web/src/account/loudness/`: parser, analyzer, Worker, client orchestration, admin panel,
  synthetic MP3 fixtures and FFmpeg reference JSON.
- `apps/worker/src/organization/loudnessStore.ts` and test: scoped state/leases/results/counters.
- `apps/worker/src/organization/schema/migrations.ts`: additive migration 120.
- `apps/worker/src/organization/OrganizationStore.ts`: typed RPC methods.
- `apps/worker/src/routes/organizationAudioLoudness.ts`: protected endpoints; registered through
  `organizationMusicCatalog.ts`.
- `apps/worker/src/storage/privateFiles.ts`, `organization/organizationStore/files.ts`,
  `routes/helpers/fileHelpers.ts`: R2 upload version, cascade-safe reclamation, authorized version
  header.
- `apps/worker/src/organization/music/{crud,trackAttachment,index}.ts`, `playerStore.ts`,
  `routes/publicEngagement.ts`: pending jobs and authorized projection enrichment.
- `apps/web/src/public/player/{PublicPracticePlayer,useLoudnessGain,usePlayerOffline,api,types}.ts*`:
  playback, parser/offline transport; relevant tests added/updated.
- `apps/web/src/offline/mediaStore.ts` and test: byte-version binding and lease metadata.
- Account preview/upload/catalog/settings/member-practice files: plumbing (see `git diff --stat`).
- `apps/web/e2e/loudness.spec.ts`: real codec/WASM/CSP test plus actual shared-player graph test.
- `scripts/generate-loudness-fixtures.py`, `benchmark-loudness-browser.mjs`: reproducible
  verification.
- `scripts/check-csp*`, `route-probe-plan.mjs`: CSP gates and safe staging route probe
  classification.
- [ADR 0059](../adr/0059-browser-analysis-for-practice-loudness.md): owner's architecture decision.
- [Qualification runbook](../runbooks/practice-loudness-qualification.md): rollback, pending device
  matrix, fixture generation and detailed benchmark evidence.

## Passing verification

`npm run check:ci` completed **all 19 steps successfully**. Log:
`/tmp/choir-loudness-final-gate.log`.

- 1,929 unit tests, 820 UI tests, 547 Workerd integration tests.
- Audit zero vulnerabilities; lockfile sync, DO RPC/runtime, formatting, lint, Knip, CSP, spacing,
  alignment, typecheck, 933 contract exports and 328 route registrations passed.
- Deployable build, artifact manifest creation and hash verification passed.
- Earlier CI attempts exposed issues that were fixed; use the final log above, not older partial
  logs.
- `git diff --check` passed.
- Focused real Chromium/mobile analyzer tests passed before the expanded enabled suite above.
- New test file additions/last changes were also formatted and linted directly. Rerun focused checks
  and the canonical gate after further application fixes.

No `npm run check:release`, staging evidence probe or deployment ran: no promotion was requested,
physical-device gates remain open, and the current-branch WebKit source-transition test fails in
both flag modes.

## Audio and resource evidence

Sixteen synthetic MP3 fixtures cover 32/44.1/48 kHz, mono/stereo, CBR/VBR, ID3, high intersample
peaks, level changes, silence and missing Xing headers. Sample counts match FFmpeg exactly.
Measurements meet the issue's ±0.2 LU / ±0.3 dBTP tolerances; chunk sizes 137 B / 32 KiB / 64 KiB
agree to ten decimal places. Truncation/cancellation reject safely. FFmpeg 7.1 is only a local
fixture generator/reference. Broader EBU Tech 3341 fixtures and representative actual choir
recordings are still release gates.

Chromium 149 benchmark: 20,800,448 compressed bytes, 5,200 seconds mono at 32 kHz, exactly
166,400,000 samples, completed in 20.309 s; main-thread 50 ms timer ticked 405 times. Peak worker JS
heap ~3.8 MiB and CDP backing storage ~184.2 MiB. Backing storage includes ArrayBuffers/WASM/garbage
awaiting GC; this is a substantial admin-browser cost, not a resident-memory or Safari guarantee.
Shorter stereo benchmarks are in the runbook. Singer playback performs no expensive analysis.

Temporary evidence: `/tmp/choir-loudness-long-benchmark.log`,
`/tmp/choir-loudness-benchmark-heap.log`, `/tmp/choir-loudness-comparison.log`. Local FFmpeg
executable used: `/tmp/choir-ffmpeg/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1`.

## Resume checklist

1. Read this handoff, root/scoped AGENTS, ADR 0059 and the qualification runbook; inspect Git
   status.
2. WebKit second-track failure diagnosed and resolved: Playwright's `page.route` in WebKit was
   bypassed once the PWA shell service worker activated. Blocking the SW in `loudness.spec.ts` via
   `test.use({ serviceWorkers: "block" })` lets route mocks intercept media fetches across tracks.
   Tests pass across all three browser engines (6/6 in both baseline and enabled modes).
3. Preserve passing Chromium behavior, offline version checks, native volume, context/source
   lifecycle, and unchanged original bytes.
4. Default-off generated artifacts restored with `npm run build`. Full 19-step `npm run check:ci`
   passed cleanly. Before any push to main/promotion, use the complete canonical
   `npm run check:release`, not an ad-hoc replacement.
5. Complete broader reference/choir fixtures and Safari/resource qualification. Record physical iOS
   Safari and Android Chrome baseline versus normalized lock-screen/background/Bluetooth/OS
   transport/offline behavior. Headless tests cannot close that matrix.
6. Actual staging CSP response/module Worker/WASM verification remains pending and requires an
   explicitly authorized guarded staging release. Never use direct Wrangler deployment or
   production.
7. Review the full diff before making one cohesive commit/PR if requested. Include package manifests
   and lockfile together. Do not discard current work or create GitHub workflows.
