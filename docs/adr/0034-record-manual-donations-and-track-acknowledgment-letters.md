# Record Manual Donations and Track Donor Acknowledgment Letters

Organization Administrators may manually record offline donations (such as checks, cash,
donor-advised funds, bank transfers, and offline credit card payments) and track whether a thank-you
or tax acknowledgment letter has been sent.

Manual donations are stored in the Organization Durable Object's `donations` table, recorded
immediately in `paid` status without initiating a Stripe Checkout Session or creating an external
payment intent. The donor email address is optional; when present, it links to or creates an
Organization `Patron` record to track cumulative giving history, and when omitted, the record
retains the donor's name and is displayed in all reports and CSV exports with `patronId: null`.

Refunding or voiding a manual donation updates its tenant-local status to `refunded` without
dispatching refund calls to external payment gateway APIs.

All donation records (both online and manual) support an updateable `thankYouSentAt` timestamp (null
when unsent) that Organization Administrators can view and toggle directly from the Donations
register and detail views without affecting financial totals or payment state.

**Why:** Choirs and community music organizations frequently receive checks and cash during
rehearsals, concerts, and annual appeal campaigns. Forcing these through online checkout is
impossible, and requiring donor email addresses causes administrative friction for older donors or
organizational grants. Dedicated thank-you letter tracking satisfies nonprofit donor stewardship and
tax-acknowledgment compliance without requiring external CRM tools.
