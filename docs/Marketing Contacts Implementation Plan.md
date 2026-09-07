# Marketing Contacts, Lists, Imports, and Unified Communication Recipients

## Goal

Add a first-class **Contact** system for people who are not necessarily Organization Profiles,
allowing organizations to:

- Maintain marketing/community contacts separately from the choir roster.
- Import contacts from CSV.
- Organize contacts into Lists.
- Track where contacts came from.
- Track email/SMS marketing status without treating import itself as consent.
- Send Organization Communications to selected Contacts/Lists.
- Respect unsubscribe/suppression across all communication paths.
- Deduplicate recipients safely.
- Eventually associate ticket buyers and donors with the same Contact identity instead of treating
  transaction IDs as pseudo-profile IDs.
- Optionally link a Contact to an Organization Profile without turning the Contact into an
  authenticated user or roster record.

The work should be delivered incrementally. Do not implement this as one large PR.

---

# Core Architectural Decisions

## Contact is not an Organization Profile

Do **not** import marketing contacts into `profiles`.

A Contact:

- belongs to exactly one Organization;
- lives in that Organization's Durable Object;
- does not grant authentication or Organization Membership;
- does not automatically appear on the roster;
- may optionally reference an Organization Profile through `profile_id`;
- may have an email address that is specifically used for communications rather than authentication.

## Contact identity

Use a stable UUID for every Contact.

Normalize email for matching:

```text
trim
lowercase
```

Normalize phone for matching:

- Use E.164 format (e.g., `+12345678900`).

Preserve the originally entered/displayed email separately.

Do not use fuzzy name matching for automatic deduplication.

Do not automatically merge households.

## Consent and suppression

Importing a contact does not automatically mean the person consented to marketing.

Keep consent/status channel-specific.

Recommended statuses:

```text
unknown
subscribed
unsubscribed
```

Track email and SMS independently.

An existing unsubscribe or suppression must always win over an imported `subscribed` value unless an
explicit future administrative resubscribe workflow is designed.

Do not silently remove suppression during an import.

## Lists

Lists are organization-owned collections of Contacts.

Examples:

- Newsletter
- 2026 Concert Audience
- Former Members
- Community Partners
- Donors
- September 2026 Import

Contacts may belong to multiple Lists.

## Recipient deduplication

The final communication audience must be deduplicated by normalized delivery destination:

- Email sends: normalized email.
- SMS sends: normalized telephone number.

If the same person is selected because they are a Member, Contact, Donor, and Ticket Buyer, they
should receive one copy per channel.

Suppression/unsubscribe status wins regardless of which audience caused the person to be selected.

---

# Section 1 — Domain Model and Shared Contracts

**Scope:** contracts/domain only. No UI and no production behavior changes yet.

## Add Contact contracts

Create shared schemas/types for approximately:

```ts
Contact {
  id
  firstName
  lastName
  displayName
  email
  normalizedEmail
  phone
  profileId
  source
  createdAt
  updatedAt
}
```

At least one useful contact method should be required when appropriate.

Avoid forcing `firstName` and `lastName` if only a display name is known.

## Add Contact communication preference contracts

Prefer a separate model rather than one global marketing flag:

```ts
ContactCommunicationPreference {
  contactId
  channel: "email" | "sms"
  status: "unknown" | "subscribed" | "unsubscribed"
  source
  observedAt
}
```

## Add List contracts

```ts
ContactList {
  id
  name
  description
  createdAt
  updatedAt
}

ContactListMembership {
  contactId
  listId
  createdAt
}
```

## Add request/response schemas

Include:

- create contact
- update contact
- delete/archive contact
- list/search contacts
- create/update/delete list
- add/remove Contacts from list
- bulk add/remove list membership
- export contacts to CSV

Use bounded array sizes.

## Tests

Required:

- Valid Contact parsing.
- Invalid Contact parsing.
- Null/undefined/omitted optional-field matrix.
- Email normalization.
- Phone normalization if introduced.
- Channel status validation.
- Contact requiring acceptable identity/contact information.
- List-name validation.
- Bulk-operation maximum limits.
- Public package export tests.

## Completion criteria

No persistent data or application routes are changed.

All existing tests remain green.

---

# Section 2 — Organization Store Schema and Contact Persistence

**Scope:** Durable Object schema plus persistence layer.

Create a new **forward-only** Organization schema migration.

Do not modify an already-applied migration.

## Suggested tables

### `contacts`

Fields approximately:

```text
id
first_name
last_name
display_name
email
normalized_email
phone
normalized_phone
profile_id nullable
source
created_at
updated_at
```

Indexes:

```text
normalized_email
normalized_phone
profile_id
display_name
```

Consider uniqueness carefully.

A good V1 rule is:

```text
unique normalized email when normalized_email is non-null
```

within the Organization Contact collection.

The application should give the user a useful duplicate result rather than surfacing a raw SQLite
constraint error.

### `contact_communication_preferences`

```text
contact_id
channel
status
source
observed_at
updated_at
```

Unique:

```text
(contact_id, channel)
```

### `contact_lists`

```text
id
name
description
created_at
updated_at
```

### `contact_list_memberships`

```text
contact_id
list_id
created_at
```

Unique:

```text
(contact_id, list_id)
```

Use foreign keys/cascades where consistent with existing Organization schema conventions.

## Store operations

Implement strongly typed OrganizationStore RPC methods for:

- `listContacts`
- `getContact`
- `createContact`
- `updateContact`
- `deleteContact` (If implementing hard delete, ensure commerce records use `ON DELETE SET NULL` for
  `contact_id`. Alternatively, use soft-delete via `archived_at` to preserve audit history.)
- `listContactLists`
- `createContactList`
- `updateContactList`
- `deleteContactList`
- `addContactsToList`
- `removeContactsFromList`

Keep SQL implementation outside React/API route code.

## Audit behavior

Contact/list mutations should produce the same class of append-only audit evidence as comparable
administrative changes.

Avoid storing unnecessary sensitive before/after values in audit text.

## Tests

Use **real migrated SQLite schemas**, not mocked SQL.

Test:

- migration from current schema;
- fresh database migration;
- migration idempotency;
- CRUD;
- normalized-email duplicate detection;
- nullable email;
- linked `profile_id`;
- nonexistent profile reference handling;
- list creation;
- duplicate list membership;
- list removal;
- Contact deletion/list-membership behavior;
- pagination;
- search;
- bounded result sizes;
- transaction rollback on failure.

## Performance test

Seed thousands of Contacts and verify:

- list/search does not perform N+1 queries;
- list membership lookup does not perform O(N²) scans;
- email lookup uses indexed normalized values.

---

# Section 3 — Contact API and Authorization

**Scope:** authenticated Worker/API surface.

Expose the Contact and List functionality through the existing organization-scoped API architecture.

Do not allow a supplied Organization ID to determine storage.

Organization must continue to be resolved from the validated organization/host context.

## Routes

Follow the repository's existing route style, approximately:

```text
GET    /api/contacts
POST   /api/contacts
GET    /api/contacts/:id
PATCH  /api/contacts/:id
DELETE /api/contacts/:id

GET    /api/contact-lists
POST   /api/contact-lists
PATCH  /api/contact-lists/:id
DELETE /api/contact-lists/:id

POST   /api/contact-lists/:id/members
DELETE /api/contact-lists/:id/members
```

Exact route names should follow current conventions.

## Tests

Test:

- authorized Organization administrator;
- unauthorized user;
- user with membership in Organization A attempting Organization B;
- changed host with reused Contact ID;
- malformed UUID;
- malformed request body;
- oversized bulk request;
- Contact not found;
- List not found;
- duplicate contact;
- typed API error serialization.

Include adversarial cross-tenant tests.

## Completion criteria

Contacts can now be fully managed through API calls.

Do not build Communications integration yet.

---

# Section 4 — Contacts and Lists UI

**Scope:** browser management UI.

Add a first-class **Contacts** area separate from the roster.

## Contacts page

Suggested desktop columns:

```text
Name
Email
Phone
Lists
Email Status
Source
Updated
Actions
```

Use the shared `DataTable`.

All meaningful data columns should be sortable.

Preserve DataTable's mobile card presentation.

Provide:

- search;
- list filtering;
- email-status filtering;
- source filtering;
- Add Contact;
- Edit Contact;
- Delete Contact;
- bulk Add to List;
- bulk Remove from List;
- Export Contacts to CSV.

## Contact editor

Fields:

```text
First name
Last name
Display name
Email
Phone
Source
Linked Organization Profile
Email marketing status
SMS marketing status
Lists
```

Use existing dialog/form patterns.

Dirty dialogs must protect unsaved changes.

Destructive deletion needs explicit confirmation.

## Lists management

Support:

- create list;
- rename;
- description;
- view members;
- remove members;
- delete list.

Deleting a List must not delete its Contacts.

## Accessibility requirements

Test:

- keyboard-only operation;
- sortable table headers;
- focus movement;
- dialog focus trap;
- Escape behavior;
- dirty-dialog confirmation;
- form labels;
- validation association;
- icon-only control accessible names;
- status not conveyed by color alone;
- screen widths representative of mobile;
- light theme;
- dark theme;
- 200% browser zoom.

Avoid horizontally unusable tables on mobile.

## Browser tests

At minimum:

1. Create Contact.
2. Edit Contact.
3. Duplicate email error.
4. Create List.
5. Add Contact to List.
6. Filter by List.
7. Remove Contact from List.
8. Delete List without deleting Contact.
9. Delete Contact.
10. Cross-Organization navigation cannot expose another Organization's Contacts.
11. Export Contacts to CSV.

---

# Section 5 — CSV Contact Import

This should be its own substantial section.

Do **not** implement CSV import as a synchronous loop inside a browser request.

The repository already expects bulk work to be bounded and asynchronous.

## Import flow

### Step 1 — Upload

User chooses CSV.

Server validates:

- content type where meaningful;
- maximum byte size (e.g., 5MB recommended V1 limit);
- maximum rows (e.g., 10,000 rows recommended V1 limit);
- header count;
- field length limits;
- valid UTF-8;
- safe CSV parsing.

Store temporary import data in an Organization-scoped location.

Never create an R2 key without the Organization namespace.

### Step 2 — Analyze

Produce:

- detected column names;
- sample rows;
- total row count;
- invalid row count;
- probable duplicate count.

### Step 3 — Map

Allow fields such as:

```text
First Name
Last Name
Display Name
Email
Phone
Email Marketing Status
SMS Marketing Status
Consent/Status Source
Source
Ignore
```

Allow the user to assign all imported contacts to one or more Lists.

### Step 4 — Preview

Show:

```text
New contacts
Existing contacts matched
Contacts to update
Invalid rows
Duplicates within file
Suppressed/unsubscribed contacts
```

### Step 5 — Confirm

Only confirmation starts the actual mutation job.

### Step 6 — Process asynchronously

Processing must be:

- idempotent;
- retryable;
- bounded;
- resumable or safely restartable;
- attributed to the Organization.

## Import deduplication

Primary matching:

```text
normalized email
```

Optional secondary matching:

```text
normalized phone
```

Do not automatically merge on name alone.

When a duplicate exists:

- update only fields allowed by the selected import policy;
- preserve Contact ID;
- preserve List memberships;
- add newly selected List memberships;
- never overwrite `unsubscribed` with `subscribed` merely because CSV says subscribed;
- never clear active suppression.

## Import policy

Default behavior should be conservative:

```text
Blank imported value -> do not erase existing value
Imported unknown -> do not downgrade existing subscribed/unsubscribed status
Imported subscribed -> cannot override existing unsubscribe/suppression
Imported unsubscribed -> may unsubscribe the Contact
```

## Import result

Return/report:

```text
rows read
contacts created
contacts updated
duplicates within file
duplicates already existing
rows skipped
rows invalid
unsubscribed/suppressed preserved
list memberships added
```

Provide downloadable error CSV if the project already has a safe export pattern suitable for reuse.

## Import tests

Test:

- simple CSV;
- quoted commas;
- quoted newlines;
- Unicode;
- BOM;
- missing header;
- duplicate header;
- empty file;
- too-large file;
- too many rows;
- enormous single field;
- malformed rows;
- duplicate email inside same CSV;
- duplicate against database;
- email case differences;
- surrounding spaces;
- retrying same job;
- duplicate queue delivery;
- job crash halfway through;
- invalid mapping;
- user cancels before confirmation;
- import into multiple Lists;
- import `subscribed` over existing `unsubscribed`;
- cross-tenant job replay;
- cross-tenant R2 key substitution.

## Critical idempotency test

Process the exact same confirmed import job twice.

Expected:

```text
Contact count does not increase on second run.
List membership count does not increase.
Consent/suppression does not regress.
```

---

# Section 6 — Communications Audience Integration

Only begin after Contacts and imports are stable.

## Expand audience contracts

Current audience concepts should become approximately:

```text
Members
Contacts
Ticket Buyers
Donors
```

When Contacts is selected, allow:

- all eligible Contacts;
- selected Lists;
- selected Contact IDs;
- optionally source/status filters.

## Introduce real recipient identity

Stop assuming every communication recipient is a Profile.

Replace that assumption with a discriminated recipient subject.

Example:

```ts
type CommunicationRecipientSubject =
  | { kind: "profile"; profileId: string }
  | { kind: "contact"; contactId: string }
  | { kind: "ticket_purchase"; purchaseId: string }
  | { kind: "donation"; donationId: string };
```

This can be an expand/contract migration.

Do not break existing scheduled messages or historical records.

Later sections should eliminate the transaction-specific recipient kinds.

## Audience construction

Build each selected audience independently.

Then merge recipients using a Map keyed by normalized destination.

Example conceptually:

```text
email:<normalized-email>
sms:<normalized-phone>
```

Do not perform repeated `.find()` calls through growing recipient arrays.

## Precedence

For any resulting recipient:

1. active unsubscribe/suppression wins;
2. explicit `unsubscribed` wins;
3. provider suppression/bounce state wins where applicable;
4. valid subscribed/eligible audience remains;
5. duplicate audience membership does not generate duplicate delivery.

## Communications UI

Audience selection should clearly support:

```text
Members
Contacts
Ticket Buyers
Donors
```

Selecting Contacts exposes List selection.

Example:

```text
Contacts
  Lists:
    ☑ Newsletter
    ☑ 2026 Concert Audience
    ☐ Community Partners
```

Show recipient counts before sending where existing architecture supports previews.

## Tests

Test combinations:

```text
Member only
Contact only
Member + Contact same email
Contact in two selected Lists
Contact + Ticket Buyer same email
Contact + Donor same email
All four audiences same email
```

Each must result in one email delivery.

Also test:

- different emails for same display name remain separate;
- suppression from either relevant identity blocks delivery;
- SMS dedupe;
- missing email;
- missing phone;
- invalid destination;
- selected empty List;
- 500-recipient boundary;
- overall delivery maximum;
- authorization;
- cross-tenant audience IDs.

---

# Section 7 — Contact-Aware Unsubscribe and Suppression

Do not bolt Contact unsubscribe handling onto Profile-only code with fake IDs.

## Signed unsubscribe subject

Extend unsubscribe tokens to carry a typed recipient subject.

For example:

```text
profile
contact
```

Token must continue to enforce:

- Organization binding;
- expiry where applicable;
- purpose;
- signature;
- tamper detection.

## Contact unsubscribe

When a Contact unsubscribes from email:

1. mark email preference `unsubscribed`;
2. create/update the appropriate suppression record;
3. preserve an audit-safe event;
4. prevent future marketing email regardless of List membership.

Unsubscribing must **not**:

- delete the Contact;
- remove them from Lists;
- change ticket/donation history;
- change Organization Profile membership.

## Provider Webhooks (Bounces/Spam Complaints)

When the email provider reports a hard bounce or spam complaint:

1. securely receive the webhook;
2. resolve the email to the correct Organization and Contact;
3. mark email preference `unsubscribed` or `bounced`;
4. record the provider's suppression reason.

## Tests

Test:

- valid Contact unsubscribe;
- duplicate unsubscribe;
- expired token;
- modified contact ID;
- token from Organization A replayed on Organization B;
- Contact remains in List;
- future audience preview excludes Contact;
- future send excludes Contact;
- CSV re-import cannot silently resubscribe Contact.

---

# Section 8 — Convert Ticket Buyers and Donors to Contact Identity

This is intentionally later.

The Contacts feature should not depend on this conversion.

## Expand commerce schema

Add nullable:

```text
contact_id
```

to appropriate ticket purchase and donation records.

Do this in a forward-only migration.

Do not immediately remove existing buyer-name/email fields.

Those remain historical transaction data.

## Contact resolver

Create one shared domain/service operation:

```text
resolveOrCreateContact(...)
```

Matching priority:

1. existing `contact_id`;
2. normalized email;
3. normalized phone if appropriate;
4. create Contact.

Never merge solely because names match.

**Update Policy:** When a transaction matches an existing Contact, do **not** overwrite the existing
Contact's fields (such as name or phone). Link the transaction to the Contact and preserve the
transaction's raw snapshot fields. This prevents a hurried ticket buyer's typo from overwriting a
curated marketing contact.

## New ticket purchases

When a paid transaction becomes eligible for communications/contact creation:

- resolve Contact;
- store `contact_id`;
- retain transaction snapshot fields.

## New donations

Same pattern.

## Existing data backfill

Implement bounded batches.

For each transaction:

- normalize email;
- find existing Contact using indexed lookup;
- create only when necessary;
- write `contact_id`.

Must be safely restartable.

## Replay/idempotency tests

Run backfill multiple times.

Expected:

```text
same Contacts
same contact_id values
no duplicate Contacts
```

Test transactions where:

- donor and ticket buyer share email;
- same person has ten purchases;
- different people share a name;
- same email differs only by case;
- missing email;
- invalid email;
- existing Contact already linked.

---

# Section 9 — Remove Commerce Pseudo-Profile Identity

After Section 8 is migrated and verified, simplify Communications.

Ticket Buyers and Donors should resolve to Contacts rather than treating transaction IDs as Profile
IDs.

Target model:

```text
Member -> Profile recipient
Ticket Buyer -> Contact recipient
Donor -> Contact recipient
Imported Contact -> Contact recipient
```

A person may still qualify through several audiences, but final destination dedupe sends one
delivery.

## Migration compatibility

Historical communication records should remain readable.

Do not destructively rewrite old delivery history merely to make historical rows match the new
model.

Use adapters for old records where necessary.

## Tests

Specifically add regression tests proving:

- purchase ID is never interpreted as a profile ID;
- donation ID is never interpreted as a profile ID;
- historical records still deserialize/display;
- current Ticket Buyer sends unsubscribe the resulting Contact correctly;
- current Donor sends unsubscribe the resulting Contact correctly.

---

# Section 10 — Unified Contact Detail View

Once commerce linkage exists, enhance Contact detail.

A Contact can show relationships such as:

```text
Organization Profile: Jane Smith
Lists:
  Newsletter
  Concert Audience

Activity:
  Ticket purchases: 4
  Donations: 2

Communication:
  Email: subscribed
  Last email: ...
```

Keep the source-of-truth records separate.

Do not turn Contact into a giant denormalized record.

Ticket data remains ticket data.

Donation data remains donation data.

Profile data remains profile data.

Contact acts as the relationship/communication identity.

---

# Section 11 — Final Regression, Accessibility, and Staging Qualification

Treat this entire project as a material change.

## Focused test suite

Before running the entire repository suite, create a focused Contacts suite covering:

### Persistence

- migrations;
- CRUD;
- lists;
- consent;
- deduplication.

### Import

- parser;
- mapping;
- preview;
- execution;
- replay.

### Communications

- audience selection;
- dedupe;
- suppression;
- unsubscribe.

### Commerce

- Ticket Buyer linking;
- Donor linking;
- backfill;
- replay.

### Tenant isolation

- Contact;
- List;
- Import;
- Audience;
- Unsubscribe;
- Commerce linkage.

### Browser

- Contacts UI;
- Lists UI;
- CSV import;
- Communications selection;
- mobile;
- accessibility.

## Full repository verification

Before treating the feature as staging-ready, run the repository's required checks, including:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
npm audit --audit-level=high
```

For a staging-bound/browser-visible change also run:

```bash
npm run check:ci
npm run test:e2e
```

Run parity checks if routes or parity evidence change:

```bash
npm run check:parity
npm run check:parity:implementation
```

Do not weaken an existing test, accessibility gate, size gate, tenant-isolation gate, lint rule, or
security check to make this feature pass.

---

# Suggested PR / Agent Work Breakdown

Keep these as separate cohesive changes.

### PR 1 — Contact domain and contracts

No persistent behavior.

### PR 2 — Contact/List schema and OrganizationStore

Real SQLite migration tests included.

### PR 3 — Contact/List API

Authorization and tenant-isolation tests included.

### PR 4 — Contacts/List management UI

Accessibility and browser tests included.

### PR 5 — CSV import foundation

Upload, parsing, analysis, mapping and preview.

### PR 6 — Async CSV import execution

Idempotency, retries, result reporting and Lists.

### PR 7 — Communications recipient identity expansion

Introduce typed recipient subject without changing current audience behavior unnecessarily.

### PR 8 — Contacts as communication audience

List targeting, dedupe and suppression.

### PR 9 — Contact unsubscribe/suppression

Signed-link and replay/isolation coverage.

### PR 10 — Ticket Buyer → Contact linkage

New transactions plus migration/backfill.

### PR 11 — Donor → Contact linkage

New donations plus migration/backfill.

### PR 12 — Remove commerce pseudo-profile behavior

Communications resolves Ticket Buyers/Donors through Contacts.

### PR 13 — Unified Contact detail/activity UI

Commerce/profile relationships shown safely.

### PR 14 — Final regression/parity/staging qualification

No feature expansion. Fix only issues discovered by qualification.

---

# Coding-Agent Rules for Every Section

Before changing code:

1. Read root `AGENTS.md`.
2. Read the applicable scoped `AGENTS.md`.
3. Inspect current implementations before introducing parallel patterns.
4. Inspect Git status and preserve unrelated work.
5. Use current repository conventions rather than inventing a second framework.

For each section:

1. Implement contracts/domain rules first.
2. Add migration/storage changes when required.
3. Add Worker behavior.
4. Add browser behavior last.
5. Add regression tests in the same change.
6. Run focused tests before repository-wide tests.
7. Fix root causes rather than loosening gates.

Every section must report:

```text
What changed
Tests added
Tests run
Migration implications
Rollback implications
Tenant-isolation risks
Accessibility risks
Performance risks
Remaining work
```

Do not deploy production.

Do not modify hosted provider configuration unless that exact action has separately been authorized.

---

# Important Regression Scenarios

These scenarios should survive all later refactoring.

## Scenario A — Imported marketing contact

```text
Jane Smith
jane@example.com
List: Newsletter
Email status: subscribed
```

Jane is **not** added to the choir roster.

## Scenario B — Unknown consent

CSV contains:

```text
Bob Jones
bob@example.com
```

No consent information exists.

Result:

```text
Contact created
Email marketing status = unknown
```

Do not infer subscription from presence in CSV.

## Scenario C — Previous unsubscribe

Existing:

```text
carol@example.com
unsubscribed
```

CSV contains:

```text
carol@example.com
subscribed
```

Result remains:

```text
unsubscribed
```

unless a separately designed explicit resubscribe mechanism is invoked.

## Scenario D — Multiple lists

One Contact belongs to:

```text
Newsletter
Donors
Concert Audience
```

Selecting all three Lists sends one email.

## Scenario E — Member and Contact

Jane is both:

```text
Organization Profile
Contact
```

and resolves to the same email destination.

Selecting Members + Newsletter produces one delivery.

## Scenario F — Ticket buyer and donor

Jane buys tickets and makes a donation using the same email.

Both commerce records resolve to Jane's Contact.

Selecting:

```text
Ticket Buyers
Donors
Newsletter
```

produces one delivery.

## Scenario G — Import replay

An async import worker executes twice.

The second execution creates:

```text
0 duplicate Contacts
0 duplicate List memberships
0 duplicate consent events requiring external effects
```

## Scenario H — Cross-tenant attack

Organization A has Contact ID X.

An authenticated administrator of Organization B submits X.

Result:

```text
not found / unauthorized according to existing API policy
```

No data about Organization A is exposed.

## Scenario I — Unsubscribe then import

Jane unsubscribes.

A later CSV import contains Jane as subscribed.

Result:

```text
Jane remains suppressed/unsubscribed.
```

## Scenario J — Historical commerce

A communication sent before Contact migration used historical Ticket Buyer/Donor recipient data.

After migrations:

```text
historical communication remains readable
new communications use Contact identity
```

---

# End-State Architecture

The desired model is:

```text
                    Organization Profile
                           |
                           | optional link
                           v
                       Contact
                    /     |      \
                   /      |       \
                Lists   Consent   Activity
                         /  \       /    \
                     Email SMS  Tickets Donations

                           |
                           v
                 Communication Audience
                           |
                           v
                  Recipient Resolution
                           |
                    destination dedupe
                           |
                  suppression filtering
                           |
                           v
                        Delivery
```

This keeps roster participation, commerce history, authentication, marketing identity, consent,
audience grouping, and message delivery as separate concepts while still giving the organization one
useful view of the person.
