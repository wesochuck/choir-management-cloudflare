# Incomplete checkout reminder operations

The feature is an optional Organization communication. Owners and Administrators control it under
Settings → Payments. Subjects and wording are in Communications → Templates. Communications history
shows scheduled, sent, skipped, and failed reminders and safe explanations.

## Disable and resume

Disable **Send incomplete checkout reminders** and save. The server increments the settings
generation and wakes the Organization scheduler. Existing candidates and jobs fail eligibility
immediately; the scheduler marks affected records skipped in bounded batches. A provider call that
already crossed the final check cannot be recalled.

Re-enabling applies only to new checkout starts. Historical candidates do not resume. Recipient
opt-outs and the shared rolling 30-day cooldown survive disable/re-enable and history cleanup.

## Delivery failures

Check Communications history first. Recipient opt-out, general unsubscribe, provider suppression,
event cutoff, unavailable inventory, newer checkout, and frequency-limit skips are intentional. Do
not manually resend a reminder through a campaign to bypass these checks.

The queue retries failures before the send claim using existing bounded backoff. Once claimed, an
uncertain provider outcome consumes the cooldown conservatively and must not trigger a second
provider send. The control-plane provider-route ledger can reconcile a known accepted message on
queue replay. An abandoned in-flight claim is marked failed after 15 minutes by bounded scheduler
cleanup; its cooldown remains. Do not infer a charge or a successful donation from an email state.

Real sending uses the existing Organization email provider lane and safety settings. Local and
preview environments remain fake/capture-only; staging restrictions and recipient allowlists stay in
force. No Stripe dashboard recovery automation is configured by this feature.

## Retention and private links

Recovery links expire seven days after send preparation, shortened by ticket-sales closure. Current
terms and availability are checked again when a fresh checkout is submitted. Saved choices never
reserve inventory or transfer an old artwork attachment. Recovery exposes the saved email to anyone
holding the link; do not paste a real link into logs, tickets, screenshots, or template previews.

Reminder records and their saved recovery details expire 90 days after terminal status. Minimal
email-keyed preference, newest-attempt, and cooldown state remains so cleanup cannot re-enable
contact or revive an older attempt. Original payment records and provider safety suppression keep
their existing retention rules. The separate stop credential follows the one-year unsubscribe-link
policy; an expired credential never expires an opt-out already recorded.

## Rollback preparation

Organization migrations 134–136 add reminder state/templates and justified queue/cleanup indexes.
Control-plane migration 0025 expands the email-provider route source-kind constraint. Keep these
forward migrations in place during Worker rollback; do not delete preferences or rewrite migration
history.

Before promoting a version that does not recognize `checkout_reminder` jobs:

1. Disable reminders for each affected Organization using the current version's authorized setting.
2. Allow the current scheduler/consumer to mark waiting reminders skipped and acknowledge queued
   reminder jobs. Verify there are no reminder jobs waiting in the queue or dead letters, including
   retry-delayed messages. Preserve unrelated jobs and minimal deduplication/preference state.
3. Resolve any in-flight send conservatively before rollback; record accepted provider outcomes
   where available. Never test whether an unknown email was sent by sending it again.
4. Follow the guarded staging rollback procedure and retained immutable Worker Version. Older
   consumers reject unknown job kinds, so do not use a version rollback as a queue-draining method.

Any hosted mutation or deployment requires separate authorization and authenticated environment
context. Local acceptance tests prove disabled/stale jobs cannot claim sends and schema expansion
preserves existing payment records; hosted queue draining is an operational prerequisite, not a
claimed result of local tests.
