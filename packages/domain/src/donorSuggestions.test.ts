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
      { email: "granny@example.test", name: "Granny Smith", totalDonatedCents: 9000 },
    ],
    [{ buyerEmail: "annette@example.test", buyerName: "Mrs. Annette Late" }],
    [
      { displayName: "Anne Zellweger", email: "" },
      { displayName: "Anna Baker", email: "" },
      { displayName: "Anna Adams", email: "" },
    ],
  );

  it("returns nothing for an empty or whitespace-only query", () => {
    expect(filterDonorSuggestions(suggestions, "")).toEqual([]);
    expect(filterDonorSuggestions(suggestions, "   ")).toEqual([]);
  });

  it("matches substrings of name or email case-insensitively", () => {
    const names = filterDonorSuggestions(suggestions, "MAR").map((entry) => entry.name);
    expect(names).toEqual(["Bob Marley"]);
    const viaEmail = filterDonorSuggestions(suggestions, "NETTE@example").map(
      (entry) => entry.name,
    );
    expect(viaEmail).toEqual(["Mrs. Annette Late"]);
  });

  it("ranks name prefixes above email prefixes above substring-only matches", () => {
    const ranked = filterDonorSuggestions(suggestions, "ann");
    expect(ranked.map((entry) => entry.name)).toEqual([
      "Anne Early",
      "Anna Adams",
      "Anna Baker",
      "Anne Zellweger",
      "Mrs. Annette Late",
      "Granny Smith",
    ]);
  });

  it("breaks rank ties by lifetime giving, then name, then input order", () => {
    const ranked = filterDonorSuggestions(suggestions, "e");
    const giving = ranked.map((entry) => entry.totalDonatedCents ?? -1);
    expect([...giving].sort((a, b) => b - a)).toEqual(giving);
  });

  it("pins equal names by input order when nothing else differs", () => {
    const tied = buildDonorSuggestions(
      [],
      [{ buyerEmail: "", buyerName: "Dana Fox" }],
      [{ displayName: "dana fox", email: "dana@fox.example.test" }],
    );
    const ranked = filterDonorSuggestions(tied, "dana");
    expect(ranked.map((entry) => entry.email || "no-email")).toEqual([
      "no-email",
      "dana@fox.example.test",
    ]);
  });

  it("caps results at eight rows", () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      donationCount: index,
      email: `bulk-${String(index)}@example.test`,
      firstDonatedAt: "2026-01-01T00:00:00.000Z",
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      lastDonatedAt: "2026-01-02T00:00:00.000Z",
      name: `Bulk Donor ${String(index)}`,
      totalDonatedCents: 100,
    }));
    const bulkSuggestions = buildDonorSuggestions(many, [], []);
    expect(bulkSuggestions).toHaveLength(12);
    expect(filterDonorSuggestions(bulkSuggestions, "bulk")).toHaveLength(8);
  });
});
