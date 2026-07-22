# Signed-Link Behavior Contract

The Cloudflare rebuild does not preserve PocketBase token bytes or outstanding links. It does
preserve each flow's purpose, authorization, expiry/revocation semantics, and host/Organization
binding.

## Required envelope

Every newly issued signed value is versioned and contains:

- the authoritative Organization ID;
- one exact purpose;
- the subject identity/profile where applicable;
- the resource ID where applicable;
- issued-at and expiry timestamps for bounded links;
- revocation material or version where the flow is revocable;
- an unpredictable nonce when replay must be single-use.

The Worker selects the Organization from the validated hostname first. Verification rejects a token
whose Organization differs from that hostname even when the signature is otherwise valid. A
client-supplied Organization ID never chooses a Durable Object or R2 prefix.

Signatures use a versioned, purpose-separated key derived from a deployed secret. Verification must
decode with explicit size limits, reject unknown versions/algorithms, compute the expected
signature, and compare fixed-length bytes in constant time. Logs and audit summaries never contain a
full token or signature.

## Flow matrix

| Purpose          | Subject/resource                            | Expiry and replay                                         | Revocation                                                   |
| ---------------- | ------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| RSVP             | Profile + event                             | bounded; repeat reads/updates allowed while active        | event/link version and profile access state                  |
| Poll             | Profile + poll                              | bounded by poll/archive policy; response changes allowed  | poll archive/revocation state                                |
| Player           | event/set list and authorized profile scope | short-lived; repeat media reads allowed                   | event/set-list publication or link version                   |
| Audition         | audition inquiry                            | bounded; only allowed status/scheduling actions           | audition status/link version                                 |
| Unsubscribe      | Profile + communication channel             | bounded; idempotent repeated unsubscribe                  | not applicable after successful idempotent preference change |
| Calendar feed    | Profile                                     | long-lived feed credential                                | explicit per-profile calendar-feed version reset             |
| Ticket scan      | ticket                                      | valid until event/refund/void; scan transition idempotent | refund, void, event policy, or explicit ticket revocation    |
| Private download | actor/session + file                        | very short-lived and single-purpose                       | authorization and file state are rechecked                   |

The Organization campaign-email unsubscribe flow is implemented with a one-year signed envelope
bound to the hostname-resolved Organization and Profile. Delivery snapshots retain only the URL
needed by the provider adapter. The public endpoint applies the email preference and suppression
idempotently, rejects cross-Organization replay, and never returns token contents in its response or
audit event. Other signed-link flows in this matrix remain independently tracked parity work.

## Required adversarial tests

- malformed, oversized, truncated, unknown-version, and expired tokens;
- signature mismatch and timing-safe fixed-length comparison;
- token replay on another Organization hostname;
- resource substitution and subject substitution;
- revoked calendar feed, archived poll, refunded/void ticket, and removed membership;
- custom-public-host use of an authenticated-only purpose;
- duplicate scan/unsubscribe delivery remains idempotent;
- no full token appears in logs, errors, metrics, or audit payloads.
