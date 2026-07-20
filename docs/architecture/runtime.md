# Runtime Boundaries

## Request entry

The Gateway Worker terminates every browser, API, webhook, queue, scheduled, and Workflow entry.
Request IDs and safe structured logging are established before domain work. Untrusted boundaries are
size-limited and validated with Zod.

For an Organization-scoped request the Worker:

1. normalizes and validates the hostname;
2. reads the versioned hostname route from KV when available, then confirms or repopulates it from
   authoritative D1 as required;
3. validates the session and Organization Membership or bounded Platform Administrator elevation;
4. derives the SQLite Durable Object ID exclusively from the resolved Organization registry ID;
5. invokes typed repository/domain behavior inside that object;
6. records an append-only audit event for administrative mutations.

A request-body, query-string, header, token, or form Organization ID cannot select storage.

## Public reads

Public routes use a versioned Published Projection stored beneath an Organization-prefixed R2 key.
The edge/cache pointer changes only after a complete new projection is written. Public traffic does
not serialize through the Organization Durable Object during bursts.

Custom public domains may serve only explicitly public and signed flows. Authentication, account,
member, administrative, and Platform Administrator routes redirect to or require the canonical
Organization product hostname.

## Background work

Each Organization store owns its scheduler state and next alarm. An alarm transaction writes stable
job/idempotency records, enqueues Organization-scoped jobs, and advances its next alarm. Provider
network calls never occur inside Durable Object transactions.

Queue delivery is at-least-once. A consumer claims the stable idempotency key inside the owning
Organization before any external effect, uses bounded concurrency/retries/backoff, records attempts,
and acknowledges only a terminal or already-completed result. Terminal failures remain visible in
the dead-letter queue.

Workflows coordinate resumable provisioning, custom domains, bounded fleet schema preparation, and
Organization Export. They do not bypass repository authorization or schema-version gates.

## Current foundation

The deployed foundation exposes `/api/health` and `/api/ready`, serves the Vite shell through
Workers static assets, has real isolated staging bindings, and keeps external effects in
fake/capture mode. Domain routes remain tracked as planned or partial in
`docs/parity/feature-matrix.yaml`.
