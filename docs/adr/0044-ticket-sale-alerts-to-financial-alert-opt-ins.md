# Ticket Sale Alerts to Financial-Alerts Opt-Ins

When a ticket purchase is confirmed, the buyer receives the confirmation email and administrators
receive nothing automatically. The `receive_financial_alerts` profile flag existed, was editable in
roster configuration, and defaulted off — but no code read it to send anything.

Every confirmed ticket purchase now sends a Ticket Sale Alert email to each member with financial
alerts enabled, including complimentary and $0 orders, and including the acting administrator when
they created the order themselves. Each alert carries the event, quantity, amount paid, buyer name
and email, and a link to the order. Delivery follows the existing queued, idempotent per-purchase
notification pattern: alert sending can never fail the purchase, recipients resolve at send time so
flag toggles take effect immediately, and alerts appear in communications message history like other
ticket notifications.

Considered options: keeping buyer-only notifications (rejected — leaves the opt-in flag as a dead
toggle that promises something it never delivers); notifying every administrator on each sale
(rejected — noisy for popular events with no opt-out); daily digest batching (rejected — loses the
real-time operational awareness the alert exists for).

**Why:** The dormant flag was the codebase's own statement of intent that _some_ administrators want
sale awareness. Opt-in scoping keeps it quiet by default while giving treasurers and box office
staff a real-time record; full detail is safe because recipients can already see all of it in the
orders UI, and including the actor keeps the alert a complete record rather than a spot-checked one.
