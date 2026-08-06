# Email feedback rollout

This runbook qualifies Cloudflare Email Sending feedback for staging before the legacy inbound DSN
route is removed. The application now treats Cloudflare Email Sending events as the provider
lifecycle source of truth and keeps local queue execution status separate from provider status.

## Staging resources

- Sending domain: `mail.staging.musicsite.org`
- Feedback queue: `choir-management-email-events-staging`
- Feedback dead-letter queue: `choir-management-email-events-dlq-staging`
- Worker environment: `staging`
- Current staging destination allowlist: the value of `PLATFORM_EMAIL_ALLOWED_RECIPIENTS` in
  `apps/worker/wrangler.jsonc`

Create the two queues if they do not already exist, then deploy the staging worker so both queues
have consumers:

```sh
npx wrangler queues create choir-management-email-events-staging
npx wrangler queues create choir-management-email-events-dlq-staging
npx wrangler deploy --config apps/worker/wrangler.jsonc --env staging
```

The create commands are idempotent only when the named queue already exists in the account; treat an
"already exists" response as confirmation and continue.

## Create the Email Sending subscription

Create one active event subscription on `choir-management-email-events-staging`, using Email Sending
as the source and `mail.staging.musicsite.org` as the sending domain. Select all six event types:

- `message.delivered`
- `message.deferred`
- `message.bounced`
- `message.failed`
- `message.rejected`
- `message.complained`

Use the Cloudflare API for creation. The current Wrangler CLI does not expose the Email Sending
source or its domain selector, and the dashboard flow may fail before collecting the required zone
ID. Do not substitute a generic queue subscription command: the sending domain and zone selector are
required here.

Set `CLOUDFLARE_API_TOKEN` from the approved secret store or authenticated deployment environment;
never put it in this runbook, a shell script, or command history. Resolve the account ID, zone ID,
and queue ID from the target environment, then submit:

```sh
curl "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/event_subscriptions/subscriptions" \
  -X POST \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @- <<JSON
{
  "name": "staging-email-feedback",
  "enabled": true,
  "events": [
    "message.delivered",
    "message.deferred",
    "message.bounced",
    "message.failed",
    "message.rejected",
    "message.complained"
  ],
  "source": {
    "type": "email.sending",
    "zone_id": "${CLOUDFLARE_ZONE_ID}",
    "domain": "mail.staging.musicsite.org"
  },
  "destination": {
    "type": "queues.queue",
    "queue_id": "${EMAIL_FEEDBACK_QUEUE_ID}"
  }
}
JSON
```

For production, use the production sending domain, zone ID, queue ID, and subscription name only
after explicit release approval. Resolve each production identifier independently; never copy the
staging values into a production request.

Confirm the resulting subscription is scoped to `mail.staging.musicsite.org`; do not accept a
subscription that covers only a different sending domain. Verify it with:

```sh
npx wrangler queues subscription list choir-management-email-events-staging
```

Email Sending subscriptions are domain-scoped and do not receive Email Routing events. The old DSN
route therefore remains separate until the qualification below passes. See the
[Cloudflare event subscription docs](https://developers.cloudflare.com/email-service/platform/event-subscriptions/),
[event schemas](https://developers.cloudflare.com/queues/event-subscriptions/events-schemas/), and
[subscription management docs](https://developers.cloudflare.com/queues/event-subscriptions/manage-event-subscriptions/),
and the
[Cloudflare subscription API](https://developers.cloudflare.com/api/resources/queues/subresources/subscriptions/methods/create/).

## Backfill and deploy checks

Apply the control-plane migration and the organization migration as part of the normal staging
deployment. For staged notification rows with an existing Cloudflare `provider_message_id`, create a
corresponding route row with the correct organization, source kind, source ID, and normalized
recipient. Rows without a route are deliberately treated as accepted-but-untracked; do not invent a
provider message ID for them.

Before qualification, confirm:

```sql
SELECT source_kind, state, count(*)
FROM email_provider_routes
GROUP BY source_kind, state;

SELECT state, count(*)
FROM email_provider_events
GROUP BY state;

SELECT email_normalized, reason, active
FROM email_recipient_suppressions
WHERE active = 1;

SELECT queue_name, message_id, event_id, provider_message_id, last_seen_at
FROM email_feedback_dead_letters
ORDER BY last_seen_at DESC;
```

The scheduled five-minute reconciliation sweep should be running. Pending events may remain pending
while their route is absent; after a route is added, the next sweep should correlate and process the
event. Unknown provider-send outcomes must remain unknown and must not be resent automatically.

## Qualification matrix

Run one send from each native Cloudflare Email Sending source: campaign, ticket, audition, payment,
platform authentication/invitation, and test email. Use only recipients in the staging allowlist.

For at least one route, inject or observe each event type and verify the following:

| Event                                       | Provider record              | Suppression                                 | Local retry behavior             |
| ------------------------------------------- | ---------------------------- | ------------------------------------------- | -------------------------------- |
| delivered                                   | `delivered`                  | no change                                   | no retry action                  |
| deferred                                    | `deferred` with SMTP details | no                                          | no provider retry                |
| bounced, hard                               | `bounced` with reason/codes  | global and organization/profile suppression | no blind resend                  |
| bounced, exhausted soft                     | `bounced` with reason/codes  | global and organization/profile suppression | no blind resend                  |
| complained                                  | `complained`                 | global and organization/profile suppression | no blind resend                  |
| rejected, recipient/spam/suppression reason | `rejected`                   | global and organization/profile suppression | no blind resend                  |
| rejected, non-recipient reason              | `rejected`                   | record only                                 | no blind resend                  |
| failed                                      | `failed`                     | record only                                 | existing local retry stays local |

Also verify duplicate events are harmless, an out-of-order delivered event does not clear a bounce
or complaint, a recipient mismatch is rejected, a cross-organization route is rejected, an unmatched
event remains pending, and an event that exhausts bounded retries appears in the dead-letter table.

Confirm a suppressed recipient is blocked by both organization sends and platform sends. Confirm the
UI/API show provider status beside the existing local queue status and that retry actions still
apply only to local failures.

## DSN cutover gate

The Worker no longer deploys the legacy inbound DSN parser or bounce endpoint. Keep the external
Cloudflare Email Routing catch-all rule unchanged until all of the following are true:

1. The staging subscription is active for `mail.staging.musicsite.org`.
2. All six event types have been observed and correlated.
3. Suppression, ownership validation, duplicate handling, and terminal-state precedence pass.
4. The pending-event sweep and dead-letter inspection pass.
5. No staged route or event depends on the DSN parser.

After the gate passes, remove the Cloudflare Email Routing DSN rule and watch the feedback queue and
dead letters for one normal operating window. Production remains inert and unsubscribed until
separately approved.
