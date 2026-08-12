# Worker Rollback Runbook

Rollback changes code, not history. Never delete or rewrite an applied D1 or Organization-store
migration.

1. Stop new promotion activity and record the affected environment, version ID, request IDs, and
   symptom without copying secrets or tokens.
2. Confirm the previous Worker version supports every already-applied expansion migration.
3. Use `wrangler versions deploy <version-id>@100%` to shift traffic to the last known-good version.
   The guarded local staging command and hosted promotion workflows capture that version before
   every traffic change and perform this rollback automatically when API qualification fails.
4. Verify `/api/health`, `/api/ready`, auth entry, two-Organization isolation probes, queue backlog,
   dead letters, Durable Object errors, and published projection reads.
5. Keep forward-written columns/tables intact. If a data correction is required, ship a new reviewed
   forward migration or bounded repair Workflow.
6. Record the rollback version, reason, duration, data compatibility assessment, and follow-up
   owner.

Do not roll production as part of the active goal. The permanent-staging qualification must rehearse
this procedure and prove old/new code compatibility before production approval exists.

Routes, queue consumers, schedules, and Workflow triggers are not part of a Worker Version. If one
of those changes caused the incident, restore a compatible trigger configuration from a reviewed
forward commit; never assume a code-version rollback also reverted triggers.
