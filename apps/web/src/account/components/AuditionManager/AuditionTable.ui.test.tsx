import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import type { OrganizationAudition } from "@choir/contracts";
import { AuditionTable } from "./tableAndDialogs";

const SAMPLE_AUDITIONS: readonly OrganizationAudition[] = [
  {
    createdAt: "2026-09-01T10:00:00Z",
    email: "alice@example.com",
    id: "aud-1",
    name: "Alice Smith",
    phone: "555-0101",
    requestedSlots: ["2026-09-10T14:00:00Z", "2026-09-10T15:00:00Z"],
    scheduledTimeSlot: null,
    slots: [],
    status: "pending",
    updatedAt: "2026-09-01T10:00:00Z",
    voicePart: "Soprano",
  },
  {
    createdAt: "2026-09-02T11:00:00Z",
    email: "bob@example.com",
    id: "aud-2",
    name: "Bob Jones",
    phone: "555-0102",
    requestedSlots: [],
    scheduledTimeSlot: "2026-09-15T18:00:00Z",
    slots: [],
    status: "scheduled",
    updatedAt: "2026-09-02T11:00:00Z",
    voicePart: "Tenor",
  },
];

describe("AuditionTable", () => {
  it("renders through shared DataTable with sortable headers and rows", () => {
    render(
      <AuditionTable
        auditions={SAMPLE_AUDITIONS}
        onConvert={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onSchedule={vi.fn()}
      />,
    );

    // Verify container and table structure
    expect(document.querySelector(".data-table-container")).toBeInTheDocument();
    expect(document.querySelector("table.data-table")).toBeInTheDocument();
    expect(document.querySelector(".data-table-cards")).toBeInTheDocument();

    // Verify sort buttons exist on data columns
    expect(screen.getByRole("button", { name: "Sort by Name / contact" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sort by Preferred times" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sort by Status" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sort by Submitted" })).toBeInTheDocument();
  });

  it("preserves mouse and keyboard scheduling behavior for pending rows only", async () => {
    const user = userEvent.setup();
    const onSchedule = vi.fn();

    render(
      <AuditionTable
        auditions={SAMPLE_AUDITIONS}
        onConvert={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onSchedule={onSchedule}
      />,
    );

    const pendingRow = screen.getByRole("row", {
      name: "Schedule audition for Alice Smith",
    });
    expect(pendingRow).toHaveClass("data-table__row--interactive");
    expect(pendingRow).toHaveAttribute("tabindex", "0");

    // Click on cell of pending row triggers onSchedule
    const nameCell = within(pendingRow).getByText("Alice Smith");
    await user.click(nameCell);
    expect(onSchedule).toHaveBeenCalledWith(SAMPLE_AUDITIONS[0]);
    onSchedule.mockClear();

    // Keyboard Enter on pending row triggers onSchedule
    pendingRow.focus();
    await user.keyboard("{Enter}");
    expect(onSchedule).toHaveBeenCalledWith(SAMPLE_AUDITIONS[0]);
    onSchedule.mockClear();

    // Scheduled row is not interactive
    const scheduledRow = screen.getByRole("row", { name: /Bob Jones/ });
    expect(scheduledRow).not.toHaveClass("data-table__row--interactive");
    expect(scheduledRow).not.toHaveAttribute("tabindex");

    const scheduledNameCell = within(scheduledRow).getByText("Bob Jones");
    await user.click(scheduledNameCell);
    expect(onSchedule).not.toHaveBeenCalled();
  });

  it("does not trigger row scheduling when clicking action buttons or dropdowns", async () => {
    const user = userEvent.setup();
    const onSchedule = vi.fn();
    const onEdit = vi.fn();

    render(
      <AuditionTable
        auditions={SAMPLE_AUDITIONS}
        onConvert={vi.fn()}
        onDelete={vi.fn()}
        onEdit={onEdit}
        onSchedule={onSchedule}
      />,
    );

    const pendingRow = screen.getByRole("row", {
      name: "Schedule audition for Alice Smith",
    });

    // Clicking Edit inside the action cell calls onEdit, NOT onSchedule
    const editButton = within(pendingRow).getByRole("button", { name: "Edit" });
    await user.click(editButton);
    expect(onEdit).toHaveBeenCalledWith(SAMPLE_AUDITIONS[0]);
    expect(onSchedule).not.toHaveBeenCalled();

    // Clicking dropdown menu trigger does NOT trigger row scheduling
    const overflowButton = within(pendingRow).getByRole("button", {
      name: "More actions for Alice Smith",
    });
    await user.click(overflowButton);
    expect(onSchedule).not.toHaveBeenCalled();
  });
});
