# Stable readable ticket sales URLs

Accepted: Public concert and bundle sales links use `/tickets/{name}` and `/tickets/bundles/{name}`.
Existing GUID URLs remain supported indefinitely. Checkout, orders, receipts, signed tokens, and
provider metadata retain their existing IDs and contracts.

Allocate a lowercase, hyphenated name once from the title. Normalize accents, bound the base to 100
characters, reserve routing words and the legacy hexadecimal ID namespace, and use a readable
fallback for titles without ASCII letters or digits. Duplicate names receive numbered suffixes.
Renaming or rescheduling a performance or bundle never changes its URL.

Organization schema migration 113 introduces `ticket_url_names` inside each Organization Durable
Object and backfills existing performances and bundles in creation order. The primary key supports
resource lookup, the unique name key prevents ambiguous URLs within each route namespace, and the
base/suffix key supports indexed allocation without repeatedly scanning a growing table. All
allocation occurs synchronously within existing write or migration transactions. Reservations
survive deletion so an old link cannot be assigned to a different sale. Names are independent
between Organizations and between performance and bundle route namespaces.

Expose optional nullable `ticketSlug` output fields in event, bundle, and public projection
contracts. Older immutable projections remain valid and generate GUID links until republished;
current commerce projections expose readable names immediately after migration. Public pages resolve
either identifier only within their hostname-resolved Organization projection and pass the existing
GUID to checkout. Unknown names show an unavailable page.

Rollback keeps the additive table and existing GUID paths usable. An older frontend cannot resolve
new readable links, so a full rollback requires retaining the compatible frontend or promptly
rolling forward. Do not reverse migration 113. No hosted resources change as part of implementation.
