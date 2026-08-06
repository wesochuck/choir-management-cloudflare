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

If a row says **Retry pending**, do not submit another retry. The source reset or queue acceptance
was not fully confirmed; inspect the originating notification or job before taking another action.
