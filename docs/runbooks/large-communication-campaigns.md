# Large communication campaigns

Organization communications support 10,000 recipients per message, including event Promotion and
messages started from Contacts. Both-channel messages can create 20,000 delivery rows. One review
and confirmation queues the campaign; delivery proceeds in batches of 50 rows using the normal
Organization outbox and delivery queue.

## Review and monitoring

The full supported audience is previewed with normal deduplication and suppression. An overflow
warning blocks sending rather than silently selecting a subset. A commerce source with more than
10,000 matching orders must be narrowed even when multiple orders belong to one person. Saving a
draft does not send. Large generic campaigns and all event promotions save a draft and obtain a
short-lived signed review before confirmation. Changes to content, channel, recipients, or draft
revision require reviewing again.

The queued campaign owns a fixed snapshot of delivery rows. New Contacts are not added afterward.
Email/SMS consent is rechecked before provider work. Progress and recipient details use the existing
communication history and paginated delivery views. Provider acceptance is distinct from confirmed
provider delivery; provider feedback retains its existing meaning.

Queue retries resume the same batch and preserve recorded successes. Provider throttling and
transient failures use the existing bounded queue retry/backoff and dead-letter handling. Use the
normal failed-delivery retry action for terminal recipient failures. An unknown provider result must
be investigated through the existing provider-route records before manually resending; the
application must not promise exactly-once delivery when a provider outcome is ambiguous.

## Migration and rollback

Migration 138 adds `communication_deliveries.delivery_job_id` and the index used for batch claims
and continuation. Do not reverse the migration or delete delivery rows to roll back application
code.

A pre-batch Worker cannot safely process a large campaign or batch continuation. Before promoting a
previous Worker Version that lacks ADR 0078, stop new campaign submissions and allow active delivery
jobs and their continuations to drain. Confirm that no delivery rows remain `queued` or `processing`
and that no pending/retryable `communication_delivery` outbox jobs remain. Previously started
campaigns cannot be canceled using the existing cancel-before-delivery action; if they cannot drain,
keep the batch-capable Worker and use a forward fix. Keep the expanded schema in place after a code
rollback. Hosted inspection or promotion still requires authenticated, explicitly authorized staging
context and the staging deployment runbook.

## Local verification

`apps/worker/test/communicationsLargeCampaign.integration.test.ts` exercises 10,000-recipient
Promotion and generic campaigns, 20,000 dual-channel deliveries, overflow rejection, persisted batch
resumption, replay, Organization isolation, full summary counts, and late consent changes against
real local migrated SQLite. Run the normal web build before
`npm run test:integration:prepared -- apps/worker/test/communicationsLargeCampaign.integration.test.ts`.
All effects stay local/fake.
