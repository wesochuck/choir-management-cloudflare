# Permanent Staging Deployment Runbook

The default staging release path runs locally from an authenticated maintainer workstation. GitHub
Actions remains an optional, manually dispatched secondary path when hosted runners are available.
Neither path authorizes a production deployment.

## Default local release

1. Sign in to the correct Cloudflare account with Wrangler. Keep credentials in Wrangler's supported
   encrypted profile or keyring; never place them in the repository.
2. Ensure `main` is clean, pushed, and exactly synchronized with `origin/main`.
3. Run:

   ```bash
   npm run deploy:staging -- --yes
   ```

The command refuses a dirty tree, a branch other than `main`, or a local commit that differs from
`origin/main`. It runs the complete local CI mirror and Chromium E2E suite, builds and hashes one
immutable release artifact in a temporary directory, verifies the staging email-feedback
subscription, captures the active rollback version, applies forward-only D1 migrations and
version-external triggers, uploads an inactive Worker Version, and only then shifts staging traffic.

After promotion it qualifies the exact `BUILD_VERSION`, direct Worker health and readiness, both
seeded Organization hosts, and the safe anonymous API boundary. A real qualification failure shifts
traffic back to the captured Worker Version. The temporary artifact is removed afterward. A
non-sensitive local provenance record is written under `.wrangler/releases/`, which is ignored by
Git.

Routes, queue consumers, schedules, and Workflow triggers are not Worker-versioned. Automatic code
rollback cannot revert those settings. Keep trigger changes backward compatible and follow
`docs/runbooks/rollback.md` if a trigger change is the source of an incident.

## Optional hosted release

The `Deploy staging` GitHub Actions workflow is manual-only. It downloads and verifies the exact
artifact produced by a successful CI run, then follows the same version-upload, traffic-shift,
qualification, and rollback sequence. Supply the successful CI run ID and full release commit SHA
when dispatching it.

Do not use `wrangler deploy` for promotion. Do not point the local command or the hosted workflow at
the production environment. Production requires its separate approval contract.
