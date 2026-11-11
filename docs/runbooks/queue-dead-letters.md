# Queue dead-letter operations

Platform Administrators can review queue dead letters from **Platform → Organizations → Queue dead
letters**. The page intentionally stores only operational metadata; the original Cloudflare Queue
message payload has already been acknowledged and is not recoverable from this screen.

## Retry a job

Choose **Retry job** only after correcting or confirming the cause of the failure. The Worker checks
the source Organization job, restores its source record to a retryable state, and creates a new
normal queue attempt. This can send an email again, so duplicate delivery is possible if the
original external effect actually succeeded before the queue failure was recorded.

The retry action is unavailable for malformed messages, missing source records, completed jobs, or
jobs at the safety limit. Use the originating feature's retry action or create a new source send in
those cases.

## Dismiss a record

Choose **Dismiss record** after reviewing a failure that does not need another attempt. Dismissal
removes the incident from **Needs review**, retains the record and reason in the audit history, and
does not delete or alter the originating job. **All records** shows dismissed and retried incidents.
Submitting the dismissal again is idempotent: it returns the existing dismissed action and does not
create a second dismissal audit event.

If a row says **Retry pending**, do not submit another retry. The source reset or queue acceptance
was not fully confirmed; inspect the originating notification or job before taking another action.

## Cancel an obsolete ticket notification

Organization administrators can open **Communications → Messages → View details** on a ticket
confirmation, reminder, or refund notification. Details identify the exact order, buyer, recipient,
refund status, job attempts, provider result, and last update. A missing provider result is not
proof that the provider never accepted an email.

For an unsent notification, enter a cancellation reason and choose **Cancel notification**, then
confirm. Cancellation preserves the order and notification, records the actual actor and reason in
Audit History, and displays the notification as **Skipped**. Repeating cancellation does not create
another audit event. Sent notifications, notifications with a recorded provider message, and jobs
claimed within the last 15 minutes cannot be canceled. An email already in flight cannot be
recalled.

Refund transactions suppress pending confirmations and reminders while keeping the separate refund
receipt eligible for delivery. Delivery also checks the authoritative refund state before sending.
Job failures update the notification to **Failed**; normal queue retries can still proceed with the
original job identity. Canceled notifications remain suppressed on replay and cannot be reopened by
the platform dead-letter retry action.

Organization migration 141 repairs historical pending notifications for refunded orders and failed
jobs once. Ongoing cleanup happens in refund/failure transitions, without recurring history scans.
The migration uses existing states and indexes and is compatible with the prior Worker. Rollback
does not undo the repaired states or cancellation audit history; older interfaces may label
suppressed notifications as Sent. Never reset a canceled notification merely to tidy its history.
