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
