# Cloudflare Email Sending Feedback Runbook

This runbook records the repository's current provider procedure. Cloudflare APIs and Wrangler
capabilities can change; verify the current authoritative Cloudflare documentation and API schema
before modifying a hosted subscription.

## Invariants

- Native Cloudflare Email Sending event subscriptions are the authoritative delivery-feedback path.
- Do not add an inbound `email()` bounce handler, DSN parser, heuristic bounce detector, catch-all
  bounce route, or obsolete bounce endpoint for Email Sending feedback.
- Reserve the Worker's `email()` handler for explicitly requested Email Routing or inbound-mail
  behavior.
- Treat subscriptions as account-level provider configuration, separate from `wrangler.jsonc`.
- Use a scoped API token from the approved secret store or an authenticated Wrangler session. Never
  print, commit, or place the token in a tracked file.

## Subscription Shape

The current setup uses:

`POST /accounts/{account_id}/event_subscriptions/subscriptions`

```json
{
  "source": {
    "type": "email.sending",
    "zone_id": "<sending-zone-id>",
    "domain": "<verified-sending-domain>"
  },
  "destination": {
    "type": "queues.queue",
    "queue_id": "<feedback-queue-id>"
  },
  "events": [
    "message.delivered",
    "message.deferred",
    "message.bounced",
    "message.failed",
    "message.rejected",
    "message.complained"
  ]
}
```

The Email Sending source requires a sending-domain selector. Do not assume a generic Wrangler or
dashboard creation flow exposes every required field.

## Qualification

1. Resolve the staging account, zone, verified sending domain, feedback queue, and dead-letter queue
   from authenticated environment context.
2. Create or update the subscription through the supported Cloudflare API.
3. Read the subscription back through the API.
4. Confirm queue subscription state with:

   ```bash
   npx wrangler queues subscription list <queue-name>
   ```

5. Qualify the Worker using the repository's staging release process.

## Production Boundary

Production configuration is out of scope while the repository goal remains staging-only. A future
production change requires explicit release approval and independently resolved production account,
zone, sending domain, queue, dead-letter queue, allowlists, subscription, and credentials. Never
reuse staging identifiers or secrets.
