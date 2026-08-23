# Donor Name and Email Autocomplete — Design

Date: 2026-08-23 Status: Approved design, pending implementation plan

## Overview

The Manual Donation dialog lets Organization Administrators record offline gifts. Typing a donor
name today is manual memory work even when the person already exists in the Organization's data as a
past donor (patron), a ticket buyer, or a member. This feature adds an accessible autocomplete to
the Donor name field that suggests known people from those three sources and fills both the donor
name and the donor email when one is chosen.

## Goals

- Suggest people while the administrator types in the Donor name field of `ManualDonationModal`.
- Draw suggestions from three existing in-memory sources: patrons (`/api/organization/patrons`),
  ticket buyers (`/api/organization/tickets/orders`), and members (`/api/singer/directory`).
- Merge the same person across sources into one suggestion keyed by email.
- Show source context per row: `Donor`, `Ticket buyer`, `Member` badges plus lifetime giving for
  donors.
- Fill both Donor name and Donor email on selection; both fields stay editable afterward.
- Ship a reusable, fully keyboard-accessible `Autocomplete` primitive in `@choir/ui`.

## Non-Goals

- No server-side search endpoint; no Worker, contract, schema, migration, or parity-ledger changes.
- No autocomplete on the tribute notification email or any other field.
- No persistence of recently used donors beyond what the three sources already provide.
- No changes to online donation checkout or Stripe flows.

## Requirements

1. When the manual donation modal opens, the client gathers:
   - patrons already loaded by DonationsManager;
   - ticket orders fetched lazily via the existing typed API `listOrganizationTicketOrders()`;
   - member directory profiles fetched lazily via `listOrganizationDirectory()`.
2. A failed lazy fetch degrades silently: suggestions use whichever sources loaded. Autocomplete is
   an affordance and must never block recording a gift or surface an error notice.
3. Suggestions filter as the administrator types: case-insensitive substring match on name or email,
   ranked deterministically, maximum 8 rows.
4. Selecting a suggestion (click or Enter) sets both form fields and closes the popup. Subsequent
   edits keep working normally. Escape with the popup open dismisses only the popup and, following
   ARIA list-autocomplete cancel semantics, restores the last accepted suggestion label when one
   exists in the current selection history; typed text with no prior selection is left untouched.
   The popup's Escape never triggers a host dialog's discard-changes confirmation.
5. Each row displays `Name — email` with badges for every matching source and lifetime giving
   formatted as money when the merged person includes patron data.
6. The listbox supports ArrowUp/ArrowDown/Home/End/Enter/Escape, click selection, active-option
   highlighting, and click-outside dismissal without taking focus from the input.

## Tenancy (non-negotiable)

Suggestions are strictly constrained to the active Organization. Data from one Organization must
never be offered as a suggestion inside another Organization's workspace:

- All three sources are existing Organization-scoped endpoints. Each resolves the Organization
  server-side from the validated request hostname against the authoritative registry
  (`resolveCanonicalOrganizationId` in the route guard) and authorizes membership before reading; no
  client-supplied Organization ID participates anywhere in the flow.
- The client builds the suggestion index exclusively from responses already scoped to the currently
  active Organization session; it never passes an Organization identifier of its own.
- The index lives only in component memory for the lifetime of one modal open. Nothing persists to
  storage, caches, or module-level state, so switching Organizations cannot observe another
  Organization's donors, buyers, or members.
- This feature introduces no new endpoints, storage, or provider calls, so it widens no tenancy
  surface. The repository's existing adversarial isolation coverage remains authoritative.

## Architecture

### 1. Domain helpers — `packages/domain/src/donorSuggestions.ts`

Pure functions and structural types only (no imports from `@choir/contracts`, matching existing
domain conventions):

```ts
type DonorSuggestionSource = "buyer" | "donor" | "member";

interface DonorSuggestionPatronInput {
  readonly email: string;
  readonly name: string;
  readonly totalDonatedCents: number;
}
interface DonorSuggestionTicketBuyerInput {
  readonly buyerEmail: string;
  readonly buyerName: string;
}
interface DonorSuggestionMemberInput {
  readonly displayName: string;
  readonly email: string; // may be ""
}
interface DonorSuggestion {
  readonly email: string;
  readonly key: string;
  readonly name: string;
  readonly sources: readonly DonorSuggestionSource[]; // canonical order donor, buyer, member
  readonly totalDonatedCents: number | null;
}
function buildDonorSuggestions(
  patrons: readonly DonorSuggestionPatronInput[],
  buyers: readonly DonorSuggestionTicketBuyerInput[],
  members: readonly DonorSuggestionMemberInput[],
): DonorSuggestion[];
function filterDonorSuggestions(
  suggestions: readonly DonorSuggestion[],
  query: string,
): DonorSuggestion[];
```

Merge rules:

- Key: lowercase email when non-empty; otherwise `name:` + lowercase trimmed name.
- Display name precedence: patron > ticket buyer > member display name (first non-empty).
- Email: first non-empty value in the same precedence order.
- `totalDonatedCents`: sum of contributing patrons; `null` when no patron participates.
- Duplicate orders from one buyer collapse into a single `buyer` contribution.

Filtering and ranking (deterministic):

1. Trim and lowercase the query; empty query yields no suggestions (the popup stays closed).
2. Keep entries whose name or email contains the query.
3. Rank tiers: name starts-with query, then email starts-with query, then substring-only match.
4. Within a tier: higher `totalDonatedCents` first (`null` treated as -1), then case-insensitive
   name comparison, then key ascending.
5. Return at most 8 suggestions.

### 2. UI primitive — `@choir/ui` `Autocomplete`

New `packages/ui/src/Autocomplete.tsx` implementing the ARIA 1.2 combobox pattern. The input keeps
focus throughout (`role="combobox"`, `aria-expanded`, `aria-controls`, `aria-autocomplete="list"`,
`aria-activedescendant` pointing at the highlighted `role="option"`). The popup is a plain listbox
positioned under the input inside the Dialog; Escape closes the open popup before the event can
reach the Dialog's dirty-close confirmation. Generic props keep it reusable:

```ts
interface AutocompleteOption {
  readonly id: string;
  readonly label: string;
}
props: {
  value: string;
  onValueChange(value: string): void;
  options: readonly AutocompleteOption[];
  onSelect(option: AutocompleteOption): void;
  renderOption?(option: AutocompleteOption): ReactNode;
  id?: string;
  ariaLabel?: string;
  disabled?: boolean;
  placeholder?: string;
  required?: boolean;
}
```

The primitive performs no filtering of its own; callers supply already-filtered options. Styling
uses existing tokens and works in light and dark themes.

### 3. Integration — `ManualDonationModal` and `DonationsManager`

- `DonationsManager` builds the suggestion index each time the modal opens: patrons come from its
  ready state; ticket orders and directory profiles are fetched lazily with graceful degradation.
  Results are cached until the modal closes.
- The modal receives `suggestions: readonly DonorSuggestion[]` and renders the Donor name field as
  the `Autocomplete`, mapping each suggestion to an option whose `renderOption` draws
  `Name — email`, source badges (`Donor`, `Ticket buyer`, `Member`), and money-formatted lifetime
  giving via the domain money formatter.
- On select, the modal sets `donorName` and `donorEmail`; both remain editable. All other fields,
  including tribute notification email and the anonymous checkbox, are unchanged.

### Known trade-off (accepted)

The member source uses `/api/singer/directory`, which respects member-directory visibility: members
who opted out of the directory or are On Break/Inactive do not appear. Administrators type those
names manually exactly as they do today. This avoids new backend surface; a future server search
endpoint can replace the data source behind the same primitive.

### Upgrade path

If suggestion quality ever outgrows the 500-record list limits, add a server-side search endpoint
and swap the index construction; the `Autocomplete` primitive and modal contract stay unchanged.

## Testing

- Unit (`packages/domain/src/donorSuggestions.test.ts`): merge dedupe by email across all three
  sources; name-keyed fallback for empty emails; display-name and email precedence; lifetime-giving
  summation; duplicate-order collapse; tier ranking and tie-breaking; 8-row cap; empty-query and
  no-match behavior; deterministic output ordering.
- E2E (`apps/web/e2e/donations.spec.ts`): mock `/api/organization/tickets/orders` and
  `/api/singer/directory`; verify the popup opens while typing, a patron-plus-buyer person merges
  into one row with both badges, selection fills name and email, keyboard navigation selects and
  dismisses correctly, and a degraded source (failed directory request) still leaves patrons usable.
  Existing manual-donation tests keep passing unchanged.
- Gates: full `check:ci`, `test:e2e`, plus `format`/`lint`/`typecheck`; parity checks confirm no
  route-surface drift.
- Tenancy: no new isolation tests are required because the feature adds no server surface; it
  composes existing Organization-scoped routes whose hostname resolution and cross-membership denial
  are already covered by the Worker integration suite. The spec-level constraint is that the client
  never supplies an Organization identifier and the index is memory-only per modal open.

## Risks

- Bundle size: one small component added to `@choir/ui` and two lazy fetches on modal open; both
  negligible against existing budgets, verified by the release build step.
- Accessibility regressions: mitigated by following the ARIA 1.2 combobox pattern and covering
  keyboard interaction in E2E.
