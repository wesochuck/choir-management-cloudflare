# Cloudflare Cost Monitoring and Billing Alerts

This guide documents the procedures for monitoring database and platform usage across Cloudflare D1,
Durable Objects SQLite, and Workers, configuring proactive billing alerts, and conducting monthly
diagnostic cost reviews.

Application-level `db_cost` logs serve as diagnostic samples for detecting query regressions and
anomalous scans; Cloudflare's dashboard analytics and invoices remain the sole authoritative source
of billable usage truth.

---

## 1. D1 Usage Notifications

D1 charges for rows read and rows written beyond plan allowances. D1 usage notifications are a
**mandatory production configuration** to detect runaway scans before monthly invoice generation.

### Setup Instructions

1. Navigate to the **Cloudflare Dashboard** > **Notifications** > **Add**.
2. Select **D1** under the storage products.
3. Configure separate notification policies for both metrics:
   - **Rows Read**: Set tiered thresholds (e.g., 50% and 80% of monthly expected quota or free
     allowance).
   - **Rows Written**: Set tiered thresholds (e.g., 50% and 80% of monthly write allowance).
4. Direct alerts to the operational on-call email list or Slack webhook channel.
5. Choose thresholds materially below included or budgeted monthly volume so the team has adequate
   runway to investigate and deploy optimizations or query limits.

---

## 2. Account Budget Alerts

Cloudflare account budget alerts monitor aggregated monthly spend across all billable services.

### Setup Instructions

1. Navigate to **Manage Account** > **Billing** > **Billable Usage** or **Notifications** > **Add**.
2. Select **Billing / Usage Alert**.
3. Configure multiple escalating dollar thresholds rather than a single high ceiling (for example,
   `$25`, `$50`, `$100`, and `$200` depending on the organization's normal baseline spend).

### Important Operating Constraints

- **Budget alerts are strictly informational:** Cloudflare budget alerts **do not stop, throttle, or
  cap usage**. Workers, D1, DOs, and R2 will continue serving requests and accumulating charges even
  after an alert triggers.
- **Reporting latency:** Spend alerts are calculated from processed billing pipeline data, which may
  be delayed by several hours to a full billing cycle. They cannot stop instantaneous volumetric
  spikes.
- **Not a substitute for application rate limiting:** Edge rate limiting (WAF / Cloudflare rate
  limits) and Durable Object transactional rate limiting (such as `checkPublicCheckoutRateLimit`)
  remain the first and authoritative line of defense against abusive consumption.

---

## 3. Durable Objects Analytics & Storage Monitoring

Each tenant organization runs inside a dedicated Durable Object backed by Durable Object SQLite
storage.

### Where to Review DO Metrics

1. In the Cloudflare Dashboard, go to **Workers & Pages** > **Durable Objects**.
2. Select the `OrganizationStore` namespace.
3. Review the **Metrics** tab for:
   - **Requests / Invocations**: Detect unexpected spikes in organization activation.
   - **Storage Usage (GB)**: Track overall SQLite disk utilization per DO.
   - **WebSocket / CPU Time**: Verify hibernation and short request execution times.
4. In Worker Analytics (`apps/worker`), monitor DO subrequest volume and CPU execution duration.

---

## 4. Application `db_cost` Structured Diagnostics

Selected high-risk queries in D1 and Durable Object SQLite emit structured diagnostic logs under the
event name `"db_cost"`.

### Log Structure

```json
{
  "event": "db_cost",
  "operation": "organization_sqlite.scheduler.fee_reconciliation",
  "store": "organization_sqlite",
  "rowsRead": 12,
  "rowsReturned": 4,
  "rowsWritten": 0,
  "warning": false
}
```

### Warning Rules

- **Absolute Rows Read**: Emits a warning when `rowsRead >= 500`.
- **Absolute Rows Written**: Emits a warning when `rowsWritten >= 100`.
- **Scan Ratio**: Emits a warning when `rowsRead >= 50` and `rowsRead / rowsReturned >= 20`
  (indicating a scan that examined many rows to filter down to very few).

### Filter Query in Cloudflare Logpush / Tail

To view high-cost query regressions:

```text
json.event = "db_cost" AND json.warning = true
```

---

## 5. Monthly Diagnostic Checklist

Perform this lightweight review at the start of each billing cycle:

1. **D1 Read/Write Trends:**
   - Inspect **D1** > `choir-management-control-db` > **Metrics**.
   - Check month-over-month growth in daily rows read and rows written.
2. **Durable Objects Growth:**
   - Review DO storage size across the `OrganizationStore` namespace.
   - Inspect whether inactive tenant DOs remain hibernated.
3. **Application `db_cost` Warnings:**
   - Query logs for any persistent `warning: true` events from `d1.email_change.reconcile`,
     `d1.email_feedback.reconcile`, `organization_sqlite.scheduler.fee_reconciliation`, or
     `organization_sqlite.rate_limit.checkout`.
4. **Table Growth Checks:**
   - In D1, verify `email_provider_events` and `email_change_requests` retention/cleanup.
   - In Durable Objects, verify `public_rate_limit_buckets` (pruned after 24 hours), `job_ledger`,
     and `scheduled_job_outbox`.
5. **Index Justification:**
   - Verify all existing indexes on D1 and Durable Object SQLite are actively supporting access
     paths and not adding dead write overhead.
6. **Correlated Service Costs:**
   - Check Workers requests, Queues operations (`JOBS_QUEUE`), and R2 bandwidth to verify they align
     with expected user activity.

---

## 6. Durable Object Runaway-Work Circuit Breaker

To prevent runaway alarm execution loops and queue dispatch failures from generating excessive
Worker execution time and billable invocations, each tenant's `OrganizationStore` Durable Object
includes an automated scheduler circuit breaker.

> [!IMPORTANT] **Operating Boundary:** This circuit breaker is an application-level
> background-processing protection mechanism. It does **not** serve as a hard Cloudflare invoice
> spending cap, nor does it cap or throttle inbound HTTP requests. Cloudflare's billing dashboard
> and invoice notifications remain the authoritative billing threshold mechanism.

### Trip Conditions

The scheduler circuit breaker trips to `open` state under either of two conditions:

1. **Runaway Batch Loop:** When an organization processes **> 30 consecutive full batches** (300
   jobs at `OUTBOX_BATCH_SIZE = 10`) without settling into a quiet or backlogged non-full state.
   This indicates a cascading recursive job loop.
2. **Consecutive Dispatch Failures:** When **5 consecutive `queue.sendBatch()` dispatches** fail
   (e.g., downstream queue unavailability or schema validation failures).

### Circuit Behavior & Alarm Cooldown

- **15-Minute Cooldown:** When tripped, the circuit enters `open` state and sets a 15-minute alarm
  cooldown (`CIRCUIT_BACKOFF_MS = 900_000`). All immediate 1-second continuation wakes and 60-second
  retry wakes are suspended.
- **Alarm Immunity:** External calls to `wakeOrganizationAlarm()` and `ensureOrganizationAlarm()`
  cannot defeat an active cooldown while the circuit is open.
- **Critical Flow Exemption:** Inbound member payments, checkout flows, and Stripe webhook
  reconciliation operate independently and are not blocked by the scheduler circuit breaker.

### Half-Open Probing & Automatic Recovery

- When the 15-minute cooldown expires, the circuit enters `half_open` state on the next scheduled
  alarm.
- The scheduler executes a single bounded probe batch:
  - If the probe batch succeeds, the circuit returns to `closed`, reset counters to 0, and resumes
    normal backlog processing.
  - If the probe batch fails or encounters dispatch errors, the circuit immediately trips back to
    `open` with a renewed 15-minute cooldown.

### Structured Diagnostic Logs

Circuit transitions emit high-visibility structured logs:

- `scheduler_circuit_opened`: Emitted with `level: "error"` when the circuit trips. Includes
  `reason`, `consecutiveFullBatches`, `consecutiveDispatchFailures`, `cooldownMs`, and `resumeAt`.
- `scheduler_circuit_probe`: Emitted with `level: "info"` when entering `half_open` to attempt a
  probe batch.
- `scheduler_circuit_closed`: Emitted with `level: "info"` when the probe batch succeeds and normal
  scheduling resumes.

### Operator Manual Override & State Inspection

Operators can inspect and clear the circuit breaker:

- **State Inspection:** `GET /internal/scheduler/state` (via internal DO RPC or platform maintenance
  endpoint) returns `circuitState`, `consecutiveFullBatches`, `consecutiveDispatchFailures`,
  `tripCount`, `openedAt`, `resumeAt`, and `lastTripReason`.
- **Operator Override / Reset:** An authorized operator can force-reset the circuit breaker and
  execute an immediate scheduler pass via:
  ```text
  POST /api/platform/maintenance/run?reset=true
  ```
  This immediately sets `circuitState = "closed"`, clears failure counters, and runs a scheduler
  pass with `operatorOverride = true`.

---

## 7. Authoritative Billing Source of Truth

- **Invoices & Billing Dashboard:** The **Cloudflare Billable Usage** page and official monthly
  invoice are the definitive source of truth for all charges.
- **Diagnostic Role:** Logged metrics and `db_cost` telemetry provide immediate visibility into
  operational behavior, but must always be reconciled against the Cloudflare billing portal.
