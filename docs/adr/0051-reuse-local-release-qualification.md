# 0051: Reuse verified local release qualification for staging

Status: Accepted

Date: 2026-10-16

## Context

Maintainers must run `check:release` before pushing main. The staging release command runs the same
gate again even when deploying the exact tested commit and build from the same workstation. This
repeats audits, static checks, all tests, and the build without adding new evidence.

## Decision

Amend ADR 0013's local staging gate invocation to permit reuse of a complete successful local
qualification within four hours of gate start. An explicit `check:release` always executes the
entire gate; only staging deployment may reuse its evidence.

A receipt is recorded atomically only after both browser-free qualification and desktop/mobile
Chromium E2E succeed, with focused tests forbidden throughout. It requires clean committed inputs
before and after the run, unchanged build artifacts, and matching checkout/commit, lockfile,
runtime, dependency installation identity, selected build/test environment, and local environment
configuration hashes. The receipt embeds the complete verified build manifest. It is stored in the
ignored `.wrangler/releases/qualification.json`, separately from staging deployment receipts.
Dependency identity uses npm's installed lockfile hash/metadata and the installation directory
identity, not an attestation of every installed dependency byte. The workstation remains trusted.

Before starting a new gate, remove the prior receipt. Missing, malformed, future-dated, expired, or
mismatched evidence falls back to the full gate. Dirty development runs remain supported but cannot
publish reusable evidence. Copying the qualified build for upload verifies the receipt's manifest
again, preventing changes between reuse and artifact preparation. Maintainers may force fresh
deployment checks with `--force-release-checks`; there is no unconditional skip option.

The staging command still requires clean main equal to origin/main and always executes fresh
provider checks, migrations/triggers, deployed-version and API qualification, and rollback logic.
Production promotion rules and its requirement for a successful staging receipt are unchanged.

## Consequences

The normal commit → qualify → push → deploy sequence runs the expensive gate once. A changed commit
or installation, changed/missing artifact, another checkout, or an expired receipt requires fresh
qualification. Dependency audit freshness is bounded to four hours. No hosted data/schema migration
is needed, and deleting the local qualification receipt forces the previous full-gate behavior. The
evidence is a workstation cache, not a portable cryptographic attestation.
