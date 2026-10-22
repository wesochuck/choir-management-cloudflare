# Permanent Staging Deployment Runbook

The sole staging release path runs locally from an authenticated maintainer workstation. GitHub
Actions is disabled; the local command requires complete release qualification before deployment.
This path does not authorize a production deployment.

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
`origin/main`. It reuses a matching recent successful `npm run check:release` qualification, or runs
the complete gate (browser-free CI plus the Chromium E2E suite) when evidence is unavailable or
invalid. It copies and verifies the qualified build as one immutable release artifact, verifies the
staging email-feedback subscription, captures the active rollback version, applies forward-only D1
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

### Reusing local release checks

After a successful full gate on a clean committed checkout, `check:release` saves
`.wrangler/releases/qualification.json`. Deployment can reuse this record for four hours measured
from the start of the gate, including time spent running checks. It verifies the same checkout,
commit, lockfile, Node version/platform, dependency installation identity, build/test environment,
local `.env*`/`.dev.vars*` configuration, and the complete Worker/web artifact file hashes. Local
configuration values are hashed; their contents are never saved in the record. A changed commit,
dirty tree (including untracked files), dependency reinstall, missing/changed build files, invalid
record, or expired evidence causes the entire gate to run again. Copying artifacts for upload
rehashes them against the qualification record before any hosted resource is changed.

An explicit `npm run check:release` always runs every check and invalidates old evidence before
starting, so a failed rerun cannot reuse an earlier success. A successful run on uncommitted work
does not create reusable evidence. Commit first, run `npm run check:release`, push, then deploy to
avoid repeating qualification. The record is local to that checkout; a different machine must
qualify independently. It is a trusted workstation cache, not a signed attestation of dependency
contents or authorization to deploy.

The normal feature-to-staging sequence is:

1. Run focused tests and relevant static/browser checks while developing.
2. Commit the candidate locally; do not push yet.
3. Run `npm run check:release` once on that clean commit. It already includes `check:ci`, the
   deployable build, integration tests, and desktop/mobile Chromium tests. If it fails, fix and
   commit the changes, then qualify the new clean commit.
4. Push the qualified commit to `main`.
5. When staging deployment is authorized, run `npm run deploy:staging -- --yes` from the same
   checkout within the four-hour window. Look for “Reusing verified check:release evidence”.

Standalone qualification and staging deployment share effective release build defaults through
`scripts/release-environment.mjs`, including `VITE_PRACTICE_LOUDNESS_ENABLED=true`. An explicit
value (including `false`) takes precedence and must match across qualification and deployment. Do
not reinstall dependencies, rebuild artifacts, or change build/test settings between these steps
unless you intend to qualify again. No extra manual full-gate invocation is needed before deployment
when the receipt still matches.

When evidence cannot be reused, the command reports the affected input categories (such as commit,
dependency installation, local configuration, or build/test environment), expiration, missing
evidence/artifacts, or artifact verification failure. Diagnostics never print configuration values.

To force fresh checks during deployment:

```bash
npm run deploy:staging -- --yes --force-release-checks
```

Fresh checkout/remote checks, Cloudflare identity and email configuration checks, migrations,
trigger updates, deployed-build API qualification, and rollback readiness always run. Reuse skips
the local full gate and the Chromium installation check; it never substitutes for staging health
qualification and never creates a production-promotable staging receipt by itself.

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
