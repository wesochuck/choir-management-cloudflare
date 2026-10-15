# Runbook: Canonical Hostname WAF Protection & Drift Reconciliation

This runbook documents the procedures for operating, monitoring, and rolling back the Cloudflare WAF
Custom Rule that blocks requests to unconfigured Choir Manager product subdomains.

---

## 1. Architecture & Design

### Defense in Depth

The platform enforces two independent controls against unconfigured tenant subdomains:

1. **Cloudflare WAF Custom Rule (Edge):** Blocks or logs requests to wildcard product subdomains
   (`*.musicsite.org` or `*.staging.musicsite.org`) before reaching the Worker when the hostname is
   not in the active canonical allowlist.
2. **Application Tenancy Resolution (`resolveOrganization`):** Checks `organization_domains` in D1
   and returns HTTP 404 `not_found` when no active organization exists for the request hostname.

### Source of Truth

The authoritative source of truth for allowed canonical hostnames is `organization_domains` in
control-plane D1:

```sql
SELECT hostname
FROM organization_domains
WHERE kind = 'canonical'
  AND status <> 'disabled'
ORDER BY hostname;
```

- Both `active` and `pending` canonical hostnames are included to ensure freshly provisioned
  organizations are never blocked at the edge.
- Customer-owned Cloudflare-for-SaaS domains (`custom_public`) are excluded from this rule and
  handled separately by Cloudflare for SaaS.
- Production and staging namespaces are strictly partitioned: the production expression explicitly
  excludes `staging.musicsite.org` and `*.staging.musicsite.org`.

---

## 2. Environment Configuration

The firewall behavior is controlled by environment variables and secrets:

| Variable                           | Description                  | Allowed Values                          | Default                                   |
| ---------------------------------- | ---------------------------- | --------------------------------------- | ----------------------------------------- |
| `CANONICAL_HOSTNAME_FIREWALL_MODE` | Provider mode                | `cloudflare-inline`, `disabled`, `fake` | `fake` (local/staging), `disabled` (prod) |
| `CLOUDFLARE_WAF_RULE_ACTION`       | WAF Rule action              | `block`, `log`                          | `log` in staging, `block` in production   |
| `CLOUDFLARE_WAF_ZONE_ID`           | Cloudflare Zone ID           | Zone hex string                         | `06291d6d14ca953912365e8f2df2eea8`        |
| `CLOUDFLARE_WAF_API_TOKEN`         | Least-privilege API token    | Secret token                            | Configured in Worker secrets              |
| `CLOUDFLARE_WAF_RULESET_ID`        | Optional explicit ruleset ID | Hex string                              | Discovered via entrypoint if omitted      |
| `CLOUDFLARE_WAF_RULE_ID`           | Optional explicit rule ID    | Hex string                              | Discovered by rule description if omitted |

---

## 3. Rollout & Promotion Plan

### Step 1: Staging Monitor Mode (`log`)

1. In staging, set `CLOUDFLARE_WAF_RULE_ACTION="log"`.
2. Deploy staging Worker.
3. Trigger reconciliation via `POST /api/platform/waf/sync` or wait for the scheduled tick.
4. Verify Cloudflare Logpush / HTTP request logs:
   - Legitimate tenant requests (e.g. `*.staging.musicsite.org`) should NOT trigger the rule.
   - Probes to unconfigured subdomains (e.g. `random-test.staging.musicsite.org`) appear as
     `action: log` in Cloudflare Security Events.
   - Apex `staging.musicsite.org` is not blocked.

### Step 2: Production Promotion (`block`)

1. Once zero false positives are confirmed in staging, enable
   `CANONICAL_HOSTNAME_FIREWALL_MODE="cloudflare-inline"` and `CLOUDFLARE_WAF_RULE_ACTION="block"`
   in production secrets.
2. Run reconciliation via Platform Admin or wait for scheduled tick.
3. Verify that requests to unconfigured subdomains return Cloudflare 403 Blocked, while legitimate
   configured organizations and customer-owned custom domains serve traffic normally.

---

## 4. Operational Inspection & Manual Drift Repair

### Checking Current State

Authorized platform administrators can query the current expected expression and D1 hostnames:

```bash
GET /api/platform/waf/status
```

Response includes:

- `hostnames`: List of canonical hostnames selected from D1.
- `expectedExpression`: Formatted Cloudflare WAF expression.
- `expressionLength`: Total characters in the expression.
- `mode`, `action`, `ruleId`, `zoneId`.

### Immediate Manual Reconciliation

To immediately synchronize Cloudflare WAF with D1:

```bash
POST /api/platform/waf/sync
```

Or run alongside full platform maintenance:

```bash
GET /api/platform/maintenance/run?syncFirewall=true
```

---

## 5. Rollback Procedures (Fail-Safe)

If the WAF rule causes unexpected blocking of legitimate traffic:

### Option A: Toggle Action to `log` (Monitor Mode) via API

Send a `PATCH` request to Cloudflare Rulesets API to set the rule action to `log`:

```bash
curl -X PATCH \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/${RULESET_ID}/rules/${RULE_ID}" \
  -H "Authorization: Bearer ${CLOUDFLARE_WAF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"action": "log"}'
```

### Option B: Disable the Rule via Cloudflare Dashboard or API

In the Cloudflare Dashboard:

1. Navigate to **Security** > **WAF** > **Custom rules**.
2. Locate **Managed Choir Manager Canonical Hostname Firewall**.
3. Toggle the rule status to **Disabled**.

Via API:

```bash
curl -X PATCH \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/${RULESET_ID}/rules/${RULE_ID}" \
  -H "Authorization: Bearer ${CLOUDFLARE_WAF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"enabled": false}'
```

### Option C: Disable in Worker Configuration

Set `CANONICAL_HOSTNAME_FIREWALL_MODE="disabled"` in the Worker environment variables / secrets to
disable automated synchronization.
