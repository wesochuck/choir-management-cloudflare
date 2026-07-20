# Isolate Organization Data in Durable Objects

The Cloudflare application will store global identity and control-plane records in D1 and route each
Organization's operational records to one SQLite-backed Durable Object identified by the
Organization ID. Roster, events, music, communications, ticketing, payments, settings, and other
domain data remain inside that Organization object; files use Organization-prefixed R2 keys, and
asynchronous work carries an explicit Organization ID.

**Why:** Organization-at-a-time access and the accepted scale envelope favor structural isolation
over a shared database that depends on every query remembering an Organization predicate. This makes
accidental cross-Organization SQL access substantially harder and gives each Organization a strongly
consistent coordination point, trading conventional shared-database reporting and migrations for
versioned per-object migrations, explicit backup/export tooling, and queued handling of bulk work.
