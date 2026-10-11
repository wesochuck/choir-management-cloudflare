# Permanent Staging Deployment Runbook

The sole staging release path runs locally from an authenticated maintainer workstation. GitHub
Actions is disabled; the local command runs the complete release checks before deployment. This path
does not authorize a production deployment.

## Default local release

1. Sign in to the correct Cloudflare account with Wrangler. Keep credentials in Wrangler's supported
   encrypted profile or keyring; never place them in the repository.
2. Ensure `main` is clean, pushed, and exactly synchronized with `origin/main`.
3. Run:

   ```bash
   npm run release:staging -- --yes
   ```

   `npm run deploy:staging -- --yes` remains an alias for the same implementation.

The command refuses a dirty tree, a branch other than `main`, or a local commit that differs from
`origin/main`. It runs the complete local release gate (`npm run check:release`: browser-free CI
plus the Chromium E2E suite), builds and hashes one immutable release artifact, verifies the staging
email-feedback subscription, captures the active rollback version, applies forward-only D1
migrations and version-external triggers, uploads an inactive Worker Version, and only then shifts
staging traffic.

After promotion it qualifies the exact `BUILD_VERSION`, direct Worker health and readiness, both
seeded Organization hosts, and the safe anonymous API boundary. A real qualification failure shifts
traffic back to the captured Worker Version. Only a complete success retains the qualified bytes
under `.wrangler/releases/artifacts/<sha>/` and writes a separate staging receipt
`.wrangler/releases/staging-<sha>.json` tying together the commit SHA, lockfile hash, artifact
manifest hash, staging Worker version and deployment IDs, `BUILD_VERSION`, release-gate evidence,
and qualification time. Failed or rolled-back attempts never create a promotable receipt, and a
second staging run for the same SHA replaces the persistent artifact only after its own successful
qualification. The temporary build directory is removed afterward. All release records under
`.wrangler/releases/` are ignored by Git and must never contain secrets.

`npm run check:ci` is the browser-free subset of qualification. `npm run check:release` is the full
standalone release qualification command (check:ci plus the Playwright Chromium E2E suite); run it
before any promotion that does not go through the staging deploy command below.

Routes, queue consumers, schedules, and Workflow triggers are not Worker-versioned. Automatic code
rollback cannot revert those settings. Keep trigger changes backward compatible and follow
`docs/runbooks/rollback.md` if a trigger change is the source of an incident.

Do not use `wrangler deploy` for promotion. Do not point the local command at the production
environment. Production promotion reuses the retained staging artifact via
`npm run release:promote -- --yes` (see `docs/runbooks/production-deployment.md`) and never
rebuilds; staging success alone never promotes production automatically.

## Authentication cookie compatibility

Staging uses the `choir-management-staging` cookie namespace, scoped to the staging product domain.
It ignores older `choir-management` cookies, including cookies inherited from a parent domain, so
stale browser state cannot mask a new staging sign-in. Local and production cookie names are
unchanged. The first promotion of this namespace requires existing staging users to sign in once;
clearing browser storage is unnecessary. Passkey registrations and account data are unchanged.

There is no database migration. Rolling back to a version using the previous namespace may require
another sign-in; older cookies are deliberately left untouched to avoid modifying parent-domain
sessions. Staging qualification helpers recognize both namespaces and verify the session with the
server before reusing cached credentials.
