# Forward recovery for populated ticket URL migrations

Accepted: Keep migration 113 unchanged. Organization migration hooks run before their statement
lists. Migration 113 attempted to backfill `ticket_url_names` in its hook, before its statement
created that table. Empty Organizations could apply it, but populated Organizations failed their
constructor migration barrier. The staging qualification caught the resulting public API failures
and restored the prior Worker version.

Migration 114 creates the same table with `IF NOT EXISTS` inside its hook before backfilling. It
preserves any names already allocated by migration 113. It declares `supersedes: [113]` so the
runner skips pending execution of the broken migration. When 114 completes, the runner records both
migration versions in the same transaction, retaining existing version timestamps. Failure rolls
back schema, backfill, and all new version markers together. Other migrations retain their existing
hook-before-statements execution order.

This is a forward-only recovery: no applied migration SQL is rewritten and no existing names or
operational records are removed. Older Worker code can still use the recovered table and sees 113 as
applied. An older frontend still cannot resolve readable names, as described in ADR 0052. Regression
tests must exercise the real runner on a populated pre-113 schema, including the original failure
and recovery, as well as an Organization where 113 already succeeded.
