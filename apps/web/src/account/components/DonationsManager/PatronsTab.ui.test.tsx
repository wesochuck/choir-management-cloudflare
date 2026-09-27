import type { PatronRecord } from "@choir/contracts";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";

import { PatronsTab } from "./PatronsTab";
import { money } from "./types";

const MOCK_PATRONS: readonly PatronRecord[] = [
  {
    donationCount: 5,
    email: "clara.clark@example.org",
    firstDonatedAt: "2025-01-15T12:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000001",
    lastDonatedAt: "2026-03-20T12:00:00.000Z",
    name: "Clara Clark",
    totalDonatedCents: 50_000,
  },
  {
    donationCount: 1,
    email: "alice.adams@example.org",
    firstDonatedAt: "2026-01-10T12:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000002",
    lastDonatedAt: "2026-01-10T12:00:00.000Z",
    name: "Alice Adams",
    totalDonatedCents: 100_000,
  },
  {
    donationCount: 12,
    email: "bob.baker@example.org",
    firstDonatedAt: "2024-06-01T12:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000003",
    lastDonatedAt: "2026-05-01T12:00:00.000Z",
    name: "Bob Baker",
    totalDonatedCents: 15_000,
  },
];

function patronNames(table: HTMLElement): string[] {
  return Array.from(table.querySelectorAll("tbody tr")).map((row) => {
    const firstCell = row.querySelector("td:first-child");
    if (!firstCell) throw new Error("Expected patron row to have a first cell.");
    return firstCell.textContent;
  });
}

describe("PatronsTab DataTable", () => {
  it("renders all six column headers and formatted patron rows with initial sort by latest descending", () => {
    render(<PatronsTab patronState={{ patrons: MOCK_PATRONS, status: "ready" }} />);

    const table = screen.getByRole("table");
    expect(table).toHaveClass("data-table");

    for (const header of ["Name", "Email", "Total donated", "Donations", "First", "Latest"]) {
      expect(within(table).getByRole("button", { name: `Sort by ${header}` })).toBeInTheDocument();
    }

    // Default sort is Latest descending
    expect(
      within(table).getByRole("button", { name: "Sort by Latest" }).closest("th"),
    ).toHaveAttribute("aria-sort", "descending");

    // Bob (2026-05-01) -> Clara (2026-03-20) -> Alice (2026-01-10)
    expect(patronNames(table)).toEqual(["Bob Baker", "Clara Clark", "Alice Adams"]);

    // Verify amounts formatted through money()
    expect(within(table).getByText(money(50_000))).toBeInTheDocument();
    expect(within(table).getByText(money(100_000))).toBeInTheDocument();
    expect(within(table).getByText(money(15_000))).toBeInTheDocument();
  });

  it("sorts by name, total donated, donations, and gift dates", async () => {
    const user = userEvent.setup();
    render(<PatronsTab patronState={{ patrons: MOCK_PATRONS, status: "ready" }} />);

    const table = screen.getByRole("table");

    // Sort by Name asc
    await user.click(within(table).getByRole("button", { name: "Sort by Name" }));
    expect(patronNames(table)).toEqual(["Alice Adams", "Bob Baker", "Clara Clark"]);

    // Sort by Total donated asc (numerical: $150, $500, $1,000)
    await user.click(within(table).getByRole("button", { name: "Sort by Total donated" }));
    expect(patronNames(table)).toEqual(["Bob Baker", "Clara Clark", "Alice Adams"]);

    // Sort by Total donated desc
    await user.click(within(table).getByRole("button", { name: "Sort by Total donated" }));
    expect(patronNames(table)).toEqual(["Alice Adams", "Clara Clark", "Bob Baker"]);

    // Sort by Donations asc (numerical: 1, 5, 12)
    await user.click(within(table).getByRole("button", { name: "Sort by Donations" }));
    expect(patronNames(table)).toEqual(["Alice Adams", "Clara Clark", "Bob Baker"]);

    // Sort by First asc (chronological: 2024-06-01, 2025-01-15, 2026-01-10)
    await user.click(within(table).getByRole("button", { name: "Sort by First" }));
    expect(patronNames(table)).toEqual(["Bob Baker", "Clara Clark", "Alice Adams"]);
  });

  it("renders mobile cards with appropriate labels and patron details", () => {
    render(<PatronsTab patronState={{ patrons: MOCK_PATRONS, status: "ready" }} />);

    const cards = document.querySelector(".data-table-cards");
    expect(cards).not.toBeNull();
    if (!(cards instanceof HTMLElement)) return;

    for (const label of [
      "Name",
      "Email",
      "Total donated",
      "Donations",
      "First gift",
      "Latest gift",
    ]) {
      expect(within(cards).getAllByText(label, { exact: true }).length).toBeGreaterThan(0);
    }

    expect(within(cards).getByText("Alice Adams")).toBeInTheDocument();
    expect(within(cards).getByText("alice.adams@example.org")).toBeInTheDocument();
    expect(within(cards).getByText(money(100_000))).toBeInTheDocument();
  });

  it("handles loading, error, and empty states appropriately", () => {
    const { rerender } = render(<PatronsTab patronState={{ status: "loading" }} />);
    expect(screen.getByText("Loading patrons…")).toBeInTheDocument();

    rerender(<PatronsTab patronState={{ status: "error" }} />);
    expect(screen.getByText("Patrons could not be loaded.")).toBeInTheDocument();

    rerender(<PatronsTab patronState={{ patrons: [], status: "ready" }} />);
    expect(screen.getByText("No patrons recorded yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("integrates with disclosure element and shows correct patron count", () => {
    const patronState = { patrons: MOCK_PATRONS, status: "ready" as const };
    render(
      <details className="donation-patrons" open>
        <summary>Patron summaries ({String(patronState.patrons.length)})</summary>
        <PatronsTab patronState={patronState} />
      </details>,
    );

    expect(
      screen.getByText(`Patron summaries (${String(MOCK_PATRONS.length)})`),
    ).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveClass("data-table");
    expect(patronNames(screen.getByRole("table"))).toEqual([
      "Bob Baker",
      "Clara Clark",
      "Alice Adams",
    ]);
  });
});
