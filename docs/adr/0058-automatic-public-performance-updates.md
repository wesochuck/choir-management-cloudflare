# ADR 0058: Automatic public Performance updates

Status: Accepted

Supersedes the manual schedule republication requirement in ADR 0057.

After an Organization has published its website once, successful event creation, editing, archiving,
and cancellation refresh its public Performance snapshot before the mutation response returns.
Public visibility and ticketing rules remain authoritative in the Organization store. Hidden,
archived, and canceled Performances are excluded. Private notes never enter the snapshot. A website
that has never been published still requires its initial explicit publication.

Automatic refresh reuses only the settings from the current, Organization-bound published snapshot,
never the administrative draft. Website copy, appearance, navigation, and footer edits retain the
explicit Publish saved draft action. The automatic refresh publishes a new immutable version and
copies validated Organization-scoped media through the existing bounded Worker-side publisher.
Public requests continue reading R2 snapshots rather than querying the Durable Object.

The store checks the expected published version when preparing an automatic update. Activation uses
an R2 conditional write against the previous current-object ETag, preventing an older publication
from overwriting a concurrently activated version. Automatic updates retry publication conflicts at
one layer, at most three attempts, rereading current settings and event state each time. Other
failures propagate through the existing event service error response; an event mutation already
persisted in the store is not rolled back if publication fails. Saving it again retries refresh.

No routes, database migrations, providers, or recurring jobs are added. Existing immutable versions
and the private draft remain intact. Rollback restores the prior manual schedule update behavior;
previously published snapshots remain readable.
