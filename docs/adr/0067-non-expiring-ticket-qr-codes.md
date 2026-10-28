# ADR 0067: Non-expiring printable ticket QR codes

Status: Accepted

## Decision

Ticket admission QR codes have no time expiry. Patrons may print or save tickets well before an
event. A receipt read reuses the stored credential and does not rotate it after 15 minutes. New
ticket scan envelopes and stored credentials use `expiresAt: 0` to denote no expiry. Only
`ticket_scan` verification ignores expiry, including older signed envelopes whose nonce still
matches the order. Previously rotated codes cannot be recovered.

Signatures, hostname-resolved Organization binding, purpose, issuance time, stored nonce, paid
status, and included-event checks remain enforced. Other signed-link purposes retain bounded expiry.
Ticket receipt access links retain their existing policies.

## Consequences

Printed codes remain usable without refreshing the receipt. Refunded orders remain invalid. Repeated
scans retain their existing validation and audit behavior. No schema migration or provider operation
is required. Rolling back reinstates the old timeout and is incompatible with newly issued
zero-expiry codes; reapply this change to restore their admission behavior.
