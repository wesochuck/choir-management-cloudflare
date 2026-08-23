# Donor Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Suggest known donors, ticket buyers, and members while typing in the Manual Donation
dialog's Donor name field, filling name and email on selection.

**Architecture:** Pure merge/filter helpers in `packages/domain` build a suggestion index from three
existing Organization-scoped list APIs; a new accessible `Autocomplete` combobox primitive in
`@choir/ui` renders them; `ManualDonationModal` consumes both. No Worker, contract, schema, or
parity-ledger changes.

**Tech Stack:** TypeScript strict, React 19, Vitest, Playwright, BEM component CSS with design
tokens.

**Spec:** `docs/superpowers/specs/2026-08-23-donor-autocomplete-design.md`

---

### Task 1: Domain suggestion index (TDD)

**Files:**

- Create: `packages/domain/src/donorSuggestions.ts`
- Test: `packages/domain/src/donorSuggestions.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/domain/src/donorSuggestions.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildDonorSuggestions, filterDonorSuggestions } from "./donorSuggestions";

describe("buildDonorSuggestions", () => {
  it("merges one person across all three sources by case-insensitive email", () => {
    const suggestions = buildDonorSuggestions(
      [{ email: "marcus@example.test", name: "Marcus Meadows", totalDonatedCents: 5000 }],
      [{ buyerEmail: "MARCUS@example.test", buyerName: "Marcus M." }],
      [{ displayName: "Marcus Meadows", email: "marcus@example.test" }],
    );
    expect(suggestions).toEqual([
      {
        email: "marcus@example.test",
        key: "marcus@example.test",
        name: "Marcus Meadows",
        sources: ["donor", "buyer", "member"],
        totalDonatedCents: 5000,
      },
    ]);
  });

  it("keeps distinct people separate even with similar names", () => {
    const suggestions = buildDonorSuggestions(
      [
        { email: "jane.a@example.test", name: "Jane Adams", totalDonatedCents: 1000 },
        { email: "jane.b@example.test", name: "Jane Baker", totalDonatedCents: 2000 },
      ],
      [],
      [],
    );
    expect(suggestions.map((suggestion) => suggestion.name)).toEqual(["Jane Adams", "Jane Baker"]);
  });

  it("collapses duplicate orders from one buyer into a single buyer source", () => {
    const suggestions = buildDonorSuggestions(
      [],
      [
        { buyerEmail: "nora@example.test", buyerName: "Nora Noble" },
        { buyerEmail: "nora@example.test", buyerName: "Nora Noble" },
      ],
      [],
    );
    expect(suggestions).toEqual([
      {
        email: "nora@example.test",
        key: "nora@example.test",
        name: "Nora Noble",
        sources: ["buyer"],
        totalDonatedCents: null,
      },
    ]);
  });

  it("falls back to a lowercase name key when emails are missing", () => {
    const suggestions = buildDonorSuggestions(
      [],
      [{ buyerEmail: "", buyerName: "Sam Rivera" }],
      [{ displayName: "sam rivera", email: "" }],
    );
    expect(suggestions).toEqual([
      {
        email: "",
        key: "name:sam rivera",
        name: "Sam Rivera",
        sources: ["buyer", "member"],
        totalDonatedCents: null,
      },
    ]);
  });

  it("prefers patron display name and sums patron giving across entries", () => {
    const suggestions = buildDonorSuggestions(
      [
        { email: "pat@example.test", name: "Pat Doe", totalDonatedCents: 2500 },
        { email: "pat@example.test", name: "Patricia Doe", totalDonatedCents: 1000 },
      ],
      [],
      [],
    );
    expect(suggestions).toEqual([
      {
        email: "pat@example.test",
        key: "pat@example.test",
        name: "Pat Doe",
        sources: ["donor"],
        totalDonatedCents: 3500,
      },
    ]);
  });
});

describe("filterDonorSuggestions", () => {
  const suggestions = buildDonorSuggestions(
    [
      { email: "anne.early@example.test", name: "Anne Early", totalDonatedCents: 3000 },
      { email: "arthur@example.test", name: "Arthur Plimpton", totalDonatedCents: 5000 },
      { email: "bob.marley@example.test", name: "Bob Marley", totalDonatedCents: 0 },
    ],
    [{ buyerEmail: "annette@example.test", buyerName: "Annette Late" }],
    [{ displayName: "Anne Zellweger", email: "" }],
  );

  it("returns nothing for an empty or whitespace-only query", () => {
    expect(filterDonorSuggestions(suggestions, "")).toEqual([]);
    expect(filterDonorSuggestions(suggestions, "   ")).toEqual([]);
  });

  it("matches substrings of name or email case-insensitively", () => {
    const names = filterDonorSuggestions(suggestions, "MAR").map((entry) => entry.name);
    expect(names).toContain("Arthur Plimpton");
    expect(names).toContain("Annette Late");
    expect(names).not.toContain("Bob Marley");
  });

  it("ranks name prefixes above email prefixes above substring-only matches", () => {
    const ranked = filterDonorSuggestions(suggestions, "ann");
    expect(ranked.map((entry) => entry.name)).toEqual(["Anne Early", "Annette Late"]);
  });

  it("breaks rank ties by lifetime giving, then name, then input order", () => {
    const ranked = filterDonorSuggestions(suggestions, "e");
    const giving = ranked.map((entry) => entry.totalDonatedCents ?? -1);
    expect([...giving].sort((a, b) => b - a)).toEqual(giving);
  });

  it("caps results at eight rows", () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      donationCount: index,
      email: `bulk-${index}@example.test`,
      firstDonatedAt: "2026-01-01T00:00:00.000Z",
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      lastDonatedAt: "2026-01-02T00:00:00.000Z",
      name: `Bulk Donor ${index}`,
      totalDonatedCents: 100,
    }));
    const bulkSuggestions = buildDonorSuggestions(many, [], []);
    expect(bulkSuggestions).toHaveLength(12);
    expect(filterDonorSuggestions(bulkSuggestions, "bulk")).toHaveLength(8);
  });
});
```

Note: the patron fixture fields beyond the three inputs are intentionally ignored by
`buildDonorSuggestions` — they document the real `PatronRecord` shape callers pass.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/domain/src/donorSuggestions.test.ts --config vitest.config.ts`
Expected: FAIL — `Cannot find module './donorSuggestions'` (or equivalent resolution error).

- [ ] **Step 3: Write the implementation**

Create `packages/domain/src/donorSuggestions.ts`:

```ts
export type DonorSuggestionSource = "buyer" | "donor" | "member";

export interface DonorSuggestionPatronInput {
  readonly email: string;
  readonly name: string;
  readonly totalDonatedCents: number;
}

export interface DonorSuggestionTicketBuyerInput {
  readonly buyerEmail: string;
  readonly buyerName: string;
}

export interface DonorSuggestionMemberInput {
  readonly displayName: string;
  readonly email: string;
}

export interface DonorSuggestion {
  readonly email: string;
  readonly key: string;
  readonly name: string;
  readonly sources: readonly DonorSuggestionSource[];
  readonly totalDonatedCents: number | null;
}

interface MutableEntry {
  buyerName: string;
  donorName: string;
  email: string;
  hasBuyer: boolean;
  hasDonor: boolean;
  hasMember: boolean;
  memberName: string;
  totalDonatedCents: number;
}

function mergeKeyFor(email: string, name: string): string {
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail) return normalizedEmail;
  return `name:${name.trim().toLowerCase()}`;
}

function emptyEntry(): MutableEntry {
  return {
    buyerName: "",
    donorName: "",
    email: "",
    hasBuyer: false,
    hasDonor: false,
    hasMember: false,
    memberName: "",
    totalDonatedCents: 0,
  };
}

export function buildDonorSuggestions(
  patrons: readonly DonorSuggestionPatronInput[],
  buyers: readonly DonorSuggestionTicketBuyerInput[],
  members: readonly DonorSuggestionMemberInput[],
): DonorSuggestion[] {
  const merged = new Map<string, MutableEntry>();

  function entryFor(email: string, name: string): MutableEntry {
    const key = mergeKeyFor(email, name);
    const existing = merged.get(key);
    if (existing) return existing;
    const created = emptyEntry();
    merged.set(key, created);
    return created;
  }

  for (const patron of patrons) {
    const entry = entryFor(patron.email, patron.name);
    entry.hasDonor = true;
    entry.totalDonatedCents += patron.totalDonatedCents;
    if (!entry.donorName) entry.donorName = patron.name.trim();
    if (!entry.email) entry.email = patron.email.trim();
  }

  for (const buyer of buyers) {
    const entry = entryFor(buyer.buyerEmail, buyer.buyerName);
    entry.hasBuyer = true;
    if (!entry.buyerName) entry.buyerName = buyer.buyerName.trim();
    if (!entry.email) entry.email = buyer.buyerEmail.trim();
  }

  for (const member of members) {
    const entry = entryFor(member.email, member.displayName);
    entry.hasMember = true;
    if (!entry.memberName) entry.memberName = member.displayName.trim();
    if (!entry.email) entry.email = member.email.trim();
  }

  return [...merged.values()].map((entry) => {
    const name = entry.donorName || entry.buyerName || entry.memberName;
    return {
      email: entry.email,
      key: mergeKeyFor(entry.email, name),
      name,
      sources: [
        ...(entry.hasDonor ? (["donor"] as const) : []),
        ...(entry.hasBuyer ? (["buyer"] as const) : []),
        ...(entry.hasMember ? (["member"] as const) : []),
      ],
      totalDonatedCents: entry.hasDonor ? entry.totalDonatedCents : null,
    };
  });
}

export function filterDonorSuggestions(
  suggestions: readonly DonorSuggestion[],
  query: string,
): DonorSuggestion[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  function rankTier(suggestion: DonorSuggestion): number {
    if (suggestion.name.toLowerCase().startsWith(needle)) return 0;
    if (suggestion.email.toLowerCase().startsWith(needle)) return 1;
    return 2;
  }

  return suggestions
    .map((suggestion, index) => ({ index, suggestion }))
    .filter(
      ({ suggestion }) =>
        suggestion.name.toLowerCase().includes(needle) ||
        suggestion.email.toLowerCase().includes(needle),
    )
    .map(({ index, suggestion }) => ({ index, rank: rankTier(suggestion), suggestion }))
    .sort((left, right) => {
      if (left.rank !== right.rank) return left.rank - right.rank;
      const leftGiving = left.suggestion.totalDonatedCents ?? -1;
      const rightGiving = right.suggestion.totalDonatedCents ?? -1;
      if (leftGiving !== rightGiving) return rightGiving - leftGiving;
      const nameOrder = left.suggestion.name.localeCompare(right.suggestion.name, undefined, {
        sensitivity: "base",
      });
      if (nameOrder !== 0) return nameOrder;
      return left.index - right.index;
    })
    .slice(0, 8)
    .map(({ suggestion }) => suggestion);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/domain/src/donorSuggestions.test.ts --config vitest.config.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Lint the domain package**

Run: `npm run lint` Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/donorSuggestions.ts packages/domain/src/donorSuggestions.test.ts
git commit -m "feat(domain): add donor suggestion merge and filter helpers"
```

---

### Task 2: Accessible Autocomplete primitive in @choir/ui

**Files:**

- Create: `packages/ui/src/Autocomplete.tsx`
- Modify: `packages/ui/src/index.ts`
- Create: `apps/web/src/styles/components/autocomplete.css`
- Modify: `apps/web/src/styles/theme.css` (add one import line)

- [ ] **Step 1: Create the primitive**

Create `packages/ui/src/Autocomplete.tsx`. The input keeps focus (`role="combobox"` +
`aria-activedescendant`); Escape stops propagation so an open popup closes without triggering the
host Dialog's dirty-close confirmation; the listbox uses `onMouseDown preventDefault` so option
clicks never blur the input.

```tsx
import type { KeyboardEvent, ReactNode } from "react";
import { useId, useState } from "react";

export interface AutocompleteOption {
  readonly id: string;
  readonly label: string;
}

export function Autocomplete({
  ariaLabel,
  disabled = false,
  id: idProp,
  onSelect,
  onValueChange,
  options,
  placeholder,
  renderOption,
  required = false,
  value,
}: {
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly onSelect: (option: AutocompleteOption) => void;
  readonly onValueChange: (value: string) => void;
  readonly options: readonly AutocompleteOption[];
  readonly placeholder?: string;
  readonly renderOption?: (option: AutocompleteOption) => ReactNode;
  readonly required?: boolean;
  readonly value: string;
}) {
  const fallbackId = useId();
  const id = idProp ?? fallbackId;
  const listboxId = `${id}-listbox`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listOpen = open && options.length > 0;

  function choose(option: AutocompleteOption): void {
    setOpen(false);
    setActiveIndex(-1);
    onSelect(option);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (!listOpen) return;
    const active = activeIndex >= 0 ? options[activeIndex] : undefined;
    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        setActiveIndex((current) => (current < 0 ? 0 : Math.min(current + 1, options.length - 1)));
        return;
      }
      case "ArrowUp": {
        event.preventDefault();
        setActiveIndex((current) => Math.max(current - 1, 0));
        return;
      }
      case "Home": {
        event.preventDefault();
        setActiveIndex(0);
        return;
      }
      case "End": {
        event.preventDefault();
        setActiveIndex(options.length - 1);
        return;
      }
      case "Enter": {
        if (active) {
          event.preventDefault();
          choose(active);
        }
        return;
      }
      case "Escape": {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        setActiveIndex(-1);
      }
    }
  }

  return (
    <span className="autocomplete">
      <input
        aria-activedescendant={
          listOpen && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
        }
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={listOpen}
        aria-label={ariaLabel}
        autoComplete="off"
        className="autocomplete__input"
        disabled={disabled}
        id={id}
        onBlur={() => {
          setOpen(false);
        }}
        onChange={(event) => {
          const next = event.target.value;
          onValueChange(next);
          setOpen(true);
          setActiveIndex(next.trim() ? 0 : -1);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        required={required}
        role="combobox"
        type="text"
        value={value}
      />
      {listOpen ? (
        <ul
          className="autocomplete__listbox"
          id={listboxId}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          role="listbox"
        >
          {options.map((option, index) => (
            <li
              aria-selected={index === activeIndex}
              className="autocomplete__option"
              id={`${listboxId}-option-${index}`}
              key={option.id}
              onClick={() => {
                choose(option);
              }}
              onMouseEnter={() => {
                setActiveIndex(index);
              }}
              role="option"
            >
              {renderOption ? renderOption(option) : option.label}
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}
```

- [ ] **Step 2: Export it from the package barrel**

In `packages/ui/src/index.ts`, add after the `DropdownMenu` export line:

```ts
export { Autocomplete, type AutocompleteOption } from "./Autocomplete";
```

- [ ] **Step 3: Add component styles**

Create `apps/web/src/styles/components/autocomplete.css`:

```css
.autocomplete {
  position: relative;
  display: block;
}

.autocomplete__input {
  width: 100%;
}

.autocomplete__listbox {
  position: absolute;
  z-index: 70;
  inset-inline: 0;
  top: calc(100% + 0.25rem);
  max-height: 16rem;
  margin: 0;
  padding: 0.35rem;
  overflow-y: auto;
  list-style: none;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  box-shadow: 0 12px 32px rgb(15 23 42 / 28%);
}

.autocomplete__option {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45rem 0.55rem;
  border-radius: calc(var(--radius-control) - 2px);
  color: var(--color-text);
  cursor: pointer;
  font-size: var(--font-size-sm);
}

.autocomplete__option[aria-selected="true"] {
  background: var(--color-primary);
  color: var(--color-primary-foreground);
}

.autocomplete__option-meta {
  color: var(--color-text-muted);
}

.autocomplete__option[aria-selected="true"] .autocomplete__option-meta {
  color: inherit;
}

.autocomplete__badge {
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: var(--font-weight-bold);
  background: color-mix(in srgb, currentColor 16%, transparent);
}
```

Then add the import to `apps/web/src/styles/theme.css` immediately after the
`./components/forms-layouts.css` import line:

```css
@import "./components/autocomplete.css";
```

Locate the anchor line first with: `grep -n "forms-layouts" apps/web/src/styles/theme.css`

- [ ] **Step 4: Typecheck and lint**

Run: `npm run typecheck && npm run lint` Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/Autocomplete.tsx packages/ui/src/index.ts apps/web/src/styles/components/autocomplete.css apps/web/src/styles/theme.css
git commit -m "feat(ui): add accessible Autocomplete combobox primitive"
```

---

### Task 3: Wire suggestions into DonationsManager and ManualDonationModal

**Files:**

- Modify: `apps/web/src/account/DonationsManager.tsx`
- Modify: `apps/web/src/account/components/DonationsManager/ManualDonationModal.tsx`

- [ ] **Step 1: Build the suggestion index when the modal opens**

In `apps/web/src/account/DonationsManager.tsx`:

Extend the `@choir/domain` import (currently only types/helpers via existing imports at the top of
the file):

```ts
import { buildDonorSuggestions, type DonorSuggestion } from "@choir/domain";
```

Extend the `../auth/api` import block to include:

```ts
import {
  // ...existing imports stay...
  listOrganizationDirectory,
  listOrganizationTicketOrders,
} from "../auth/api";
```

Add state next to `const [manualModalOpen, setManualModalOpen] = useState(false);`:

```ts
const [donorSuggestions, setDonorSuggestions] = useState<readonly DonorSuggestion[]>([]);
```

Add an effect directly below the existing modal-open state declaration group (after all other
`useState` lines, before the data-loading effect):

```ts
useEffect(() => {
  if (!manualModalOpen) return;
  let cancelled = false;
  async function gather(): Promise<void> {
    const [ordersResult, directoryResult] = await Promise.allSettled([
      listOrganizationTicketOrders(),
      listOrganizationDirectory(),
    ]);
    if (cancelled) return;
    const patrons =
      patronState.status === "ready"
        ? patronState.patrons.map((patron) => ({
            email: patron.email,
            name: patron.name,
            totalDonatedCents: patron.totalDonatedCents,
          }))
        : [];
    const buyers =
      ordersResult.status === "fulfilled"
        ? ordersResult.value.map((order) => ({
            buyerEmail: order.buyerEmail,
            buyerName: order.buyerName,
          }))
        : [];
    const members =
      directoryResult.status === "fulfilled"
        ? directoryResult.value.map((profile) => ({
            displayName: profile.displayName,
            email: profile.email,
          }))
        : [];
    setDonorSuggestions(buildDonorSuggestions(patrons, buyers, members));
  }
  void gather();
  return () => {
    cancelled = true;
  };
}, [manualModalOpen, patronState]);
```

Pass the prop where `ManualDonationModal` is rendered (bottom of the JSX):

```tsx
<ManualDonationModal
  busy={busy}
  onClose={() => {
    if (!busy) setManualModalOpen(false);
  }}
  onSave={handleSaveManualDonation}
  open={manualModalOpen}
  suggestions={donorSuggestions}
/>
```

Tenancy note (from spec): none of these calls sends an Organization identifier; each endpoint
resolves the Organization server-side from the session's validated hostname.

- [ ] **Step 2: Replace the donor-name input with the Autocomplete**

In `apps/web/src/account/components/DonationsManager/ManualDonationModal.tsx`:

Update imports:

```tsx
import {
  donationPaymentMethodSchema,
  donationTributeTypeSchema,
  type DonationPaymentMethod,
  type DonationTributeType,
  type ManualDonationCreateRequest,
} from "@choir/contracts";
import { filterDonorSuggestions, type DonorSuggestion } from "@choir/domain";
import { Autocomplete } from "@choir/ui";
import { useMemo, useState, type SyntheticEvent } from "react";

import { money } from "./types";
```

Extend props with:

```tsx
readonly suggestions: readonly DonorSuggestion[];
```

Add memoized lookups inside the component (after the existing `useState` block):

```tsx
const filteredSuggestions = useMemo(
  () => filterDonorSuggestions(suggestions, donorName),
  [donorName, suggestions],
);
const suggestionById = useMemo(
  () => new Map(filteredSuggestions.map((suggestion) => [suggestion.key, suggestion])),
  [filteredSuggestions],
);
const donorOptions = useMemo(
  () => filteredSuggestions.map((suggestion) => ({ id: suggestion.key, label: suggestion.name })),
  [filteredSuggestions],
);
```

Replace the entire existing Donor name `<label className="field">…</label>` input block with:

```tsx
<label className="field">
  Donor name
  <Autocomplete
    ariaLabel="Donor name"
    disabled={busy}
    id="manual-donation-donor-name"
    onSelect={(option) => {
      setDonorName(option.label);
      const suggestion = suggestionById.get(option.id);
      if (suggestion?.email) setDonorEmail(suggestion.email);
    }}
    onValueChange={(next) => {
      setDonorName(next);
    }}
    options={donorOptions}
    placeholder="Jane Doe or Acme Foundation"
    renderOption={(option) => {
      const suggestion = suggestionById.get(option.id);
      if (!suggestion) return option.label;
      return (
        <>
          <span>{suggestion.name}</span>
          {suggestion.email ? (
            <span className="autocomplete__option-meta">{suggestion.email}</span>
          ) : null}
          {suggestion.sources.includes("donor") ? (
            <span className="autocomplete__badge">
              Donor
              {suggestion.totalDonatedCents !== null
                ? ` · ${money(suggestion.totalDonatedCents)}`
                : ""}
            </span>
          ) : null}
          {suggestion.sources.includes("buyer") ? (
            <span className="autocomplete__badge">Ticket buyer</span>
          ) : null}
          {suggestion.sources.includes("member") ? (
            <span className="autocomplete__badge">Member</span>
          ) : null}
        </>
      );
    }}
    required
    value={donorName}
  />
</label>
```

The Donor email field stays exactly as-is (plain input). Both fields remain editable after
selection. Contract-level length caps still validate on submit; the old `maxLength={200}` attribute
on this input is dropped because the combobox does not accept it — server-side Zod remains the
integrity boundary per repository rules.

- [ ] **Step 3: Typecheck, lint, format**

Run: `npm run typecheck && npm run lint && npm run format:check` Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/account/DonationsManager.tsx apps/web/src/account/components/DonationsManager/ManualDonationModal.tsx
git commit -m "feat(web): suggest known donors in manual donation dialog"
```

---

### Task 4: E2E coverage

**Files:**

- Modify: `apps/web/e2e/donations.spec.ts` (append two tests before end of file)

- [ ] **Step 1: Append the suggestion tests**

Add these tests at the end of `apps/web/e2e/donations.spec.ts`. They override earlier routes
(Playwright routes are last-registered-first-matched):

```ts
test("suggests known patrons, buyers, and members while typing", async ({ page }) => {
  await page.route("**/api/organization/patrons", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        patrons: [
          {
            donationCount: 2,
            email: "marcus@example.test",
            firstDonatedAt: "2026-01-05T12:00:00.000Z",
            id: "abababab-abab-4aba-8aba-abababababab",
            lastDonatedAt: "2026-07-01T12:00:00.000Z",
            name: "Marcus Meadows",
            totalDonatedCents: 7500,
          },
        ],
        requestId,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/tickets/orders", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        orders: [
          {
            amountPaidCents: 3000,
            bundleId: null,
            bundleTitle: "",
            buyerEmail: "marcus@example.test",
            buyerName: "Marcus Meadows",
            checkoutMode: "fake",
            createdAt: "2026-07-22T20:00:00.000Z",
            currency: "usd",
            discountAmountCents: 0,
            discountCode: null,
            discountType: null,
            discountValue: null,
            discountedSubtotalCents: 3000,
            eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            eventStartsAt: "2026-05-01T23:00:00.000Z",
            eventTitle: "Spring Concert",
            feeCents: 75,
            id: "bcbcbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
            includedEvents: [],
            marketingOptIn: false,
            originalSubtotalCents: 3000,
            originalUnitPriceCents: 1500,
            providerPaymentId: "payment-test",
            providerSessionId: "session-test",
            quantity: 2,
            refundRequested: false,
            status: "paid",
            timezone: "America/New_York",
            unitPriceCents: 1500,
            updatedAt: "2026-07-22T20:00:00.000Z",
          },
          {
            amountPaidCents: 1500,
            bundleId: null,
            bundleTitle: "",
            buyerEmail: "nora@example.test",
            buyerName: "Nora Noble",
            checkoutMode: "fake",
            createdAt: "2026-07-23T20:00:00.000Z",
            currency: "usd",
            discountAmountCents: 0,
            discountCode: null,
            discountType: null,
            discountValue: null,
            discountedSubtotalCents: 1500,
            eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            eventStartsAt: "2026-05-01T23:00:00.000Z",
            eventTitle: "Spring Concert",
            feeCents: 40,
            id: "bcbcbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
            includedEvents: [],
            marketingOptIn: false,
            originalSubtotalCents: 1500,
            originalUnitPriceCents: 1500,
            providerPaymentId: "payment-test-2",
            providerSessionId: "session-test-2",
            quantity: 1,
            refundRequested: false,
            status: "paid",
            timezone: "America/New_York",
            unitPriceCents: 1500,
            updatedAt: "2026-07-23T20:00:00.000Z",
          },
        ],
        requestId,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/singer/directory", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        profiles: [
          {
            displayName: "Nora Noble",
            email: "nora@example.test",
            id: "cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd",
            photoFileId: null,
            phone: "",
            voicePart: "",
          },
        ],
        requestId,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/admin/donations");
  await page.getByRole("button", { name: "Record donation" }).click();
  const dialog = page.getByRole("dialog", { name: "Record donation" });
  const nameInput = dialog.getByRole("combobox", { name: "Donor name" });
  const emailInput = dialog.getByRole("textbox", { name: /Donor email/ });

  await nameInput.fill("Mar");
  await expect(dialog.getByRole("option")).toHaveCount(1);
  const marcusOption = dialog.getByRole("option").first();
  await expect(marcusOption).toContainText("Marcus Meadows");
  await expect(marcusOption).toContainText("marcus@example.test");
  await expect(marcusOption).toContainText("Donor · $75.00");
  await expect(marcusOption).toContainText("Ticket buyer");
  await expect(marcusOption).not.toContainText("Member");

  await marcusOption.click();
  await expect(nameInput).toHaveValue("Marcus Meadows");
  await expect(emailInput).toHaveValue("marcus@example.test");
  await expect(dialog.getByRole("listbox")).toHaveCount(0);

  await nameInput.fill("Nor");
  await expect(dialog.getByRole("option")).toHaveCount(1);
  const noraOption = dialog.getByRole("option").first();
  await expect(noraOption).toContainText("Nora Noble");
  await expect(noraOption).toContainText("Ticket buyer");
  await expect(noraOption).toContainText("Member");
  await noraOption.click();
  await expect(nameInput).toHaveValue("Nora Noble");
  await expect(emailInput).toHaveValue("nora@example.test");
});

test("keyboard selection works and a degraded directory stays silent", async ({ page }) => {
  let manualPayload: unknown = null;
  await page.route("**/api/organization/tickets/orders", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        orders: [
          {
            amountPaidCents: 1500,
            bundleId: null,
            bundleTitle: "",
            buyerEmail: "nora@example.test",
            buyerName: "Nora Noble",
            checkoutMode: "fake",
            createdAt: "2026-07-23T20:00:00.000Z",
            currency: "usd",
            discountAmountCents: 0,
            discountCode: null,
            discountType: null,
            discountValue: null,
            discountedSubtotalCents: 1500,
            eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            eventStartsAt: "2026-05-01T23:00:00.000Z",
            eventTitle: "Spring Concert",
            feeCents: 40,
            id: "bcbcbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
            includedEvents: [],
            marketingOptIn: false,
            originalSubtotalCents: 1500,
            originalUnitPriceCents: 1500,
            providerPaymentId: "payment-test-3",
            providerSessionId: "session-test-3",
            quantity: 1,
            refundRequested: false,
            status: "paid",
            timezone: "America/New_York",
            unitPriceCents: 1500,
            updatedAt: "2026-07-23T20:00:00.000Z",
          },
        ],
        requestId,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/singer/directory", async (route) => {
    await route.fulfill({ status: 500 });
  });
  await page.route("**/api/organization/donations/manual", async (route) => {
    manualPayload = route.request().postDataJSON();
    await route.fulfill({
      body: JSON.stringify({
        donation: donation({
          buyerEmail: "nora@example.test",
          buyerName: "Nora Noble",
          id: createdDonationId,
          paymentMethod: "cash",
          paymentReference: "Hat proceeds",
          thankYouSentAt: null,
        }),
        requestId,
      }),
      contentType: "application/json",
      status: 201,
    });
  });

  await page.goto("/admin/donations");
  await page.getByRole("button", { name: "Record donation" }).click();
  const dialog = page.getByRole("dialog", { name: "Record donation" });
  const nameInput = dialog.getByRole("combobox", { name: "Donor name" });
  const emailInput = dialog.getByRole("textbox", { name: /Donor email/ });

  await nameInput.fill("nor");
  const options = dialog.getByRole("option");
  await expect(options).toHaveCount(1);

  await nameInput.press("ArrowDown");
  await nameInput.press("Enter");
  await expect(nameInput).toHaveValue("Nora Noble");
  await expect(emailInput).toHaveValue("nora@example.test");
  await expect(dialog.getByRole("listbox")).toHaveCount(0);

  await nameInput.fill("no");
  await expect(options).toHaveCount(1);
  await nameInput.press("Escape");
  await expect(dialog.getByRole("listbox")).toHaveCount(0);
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Amount (USD)").fill("25");
  await dialog.getByRole("button", { name: "Record donation" }).click();

  expect(manualPayload).toMatchObject({
    amountCents: 2500,
    buyerEmail: "nora@example.test",
    buyerName: "Nora Noble",
    paymentMethod: "check",
  });
  await expect(page.getByRole("status")).toHaveText("Manual donation recorded.");
});
```

Notes for the implementer:

- The second test leaves Payment method at its default (`check`) — that is what the payload
  assertion expects.
- The failed `/api/singer/directory` request must produce no error UI; Nora still appears from
  ticket orders alone (graceful degradation).
- `$75.00` comes from the shared `Intl` formatter; do not hardcode locale variants.

- [ ] **Step 2: Run the donations spec on both projects**

Run: `npx playwright test apps/web/e2e/donations.spec.ts` Expected: 5 tests × 2 projects = 10
passed.

- [ ] **Step 3: Run the responsive audit to confirm no regression**

Run: `npx playwright test apps/web/e2e/responsive.audit.spec.ts --project=chromium` Expected: all
pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/donations.spec.ts
git commit -m "test(e2e): cover donor autocomplete selection, keyboard, and degradation"
```

---

### Task 5: Full verification gates

- [ ] **Step 1: Run the complete local CI mirror**

Run: `npm run check:ci` Expected: all 14 steps pass.

- [ ] **Step 2: Run the full browser suite**

Run: `npx playwright install chromium && npm run test:e2e` (skip install if Chromium already
present) Expected: all tests pass, including the new autocomplete tests.

- [ ] **Step 3: Confirm no parity drift**

Run: `npm run check:parity && npm run check:parity:implementation` Expected: matrix valid; API audit
passes with unchanged route count.

No deployment step: staging promotion happens through the normal guarded release path
(`docs/runbooks/staging-deployment.md`) only when explicitly requested.
