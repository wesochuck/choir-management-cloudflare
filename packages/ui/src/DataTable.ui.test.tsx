import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { DataTable, type DataTableColumn } from "./DataTable";

// Interaction coverage for DataTable (plan §4.13): keyboard sort activation
// with aria-sort, row activation via Enter/Space, interactive cells that must
// not trigger row navigation, mobile-card rendering with mobile labels, and
// pagination keyboard/disabled states. The SSR markup test remains untouched.

interface Member {
  readonly id: string;
  readonly name: string;
  readonly section: string;
}

const MEMBERS: readonly Member[] = [
  { id: "1", name: "Beta Singer", section: "Alto" },
  { id: "2", name: "Alpha Singer", section: "Soprano" },
];

function memberColumns({
  onAction,
}: {
  readonly onAction: (member: Member) => void;
}): readonly DataTableColumn<Member>[] {
  return [
    {
      header: "Name",
      id: "name",
      render: (member) => member.name,
      sortValue: (member) => member.name,
    },
    {
      header: "Section",
      id: "section",
      mobileLabel: "Voice part",
      render: (member) => member.section,
    },
    {
      header: "Manage",
      id: "actions",
      render: (member) => (
        <button
          onClick={() => {
            onAction(member);
          }}
          type="button"
        >
          Edit {member.name}
        </button>
      ),
    },
  ];
}

function firstTableCellText(): string | null {
  const table = document.querySelector("table.data-table");
  if (!table) return null;
  return table.querySelector("tbody tr td")?.textContent ?? null;
}

describe("DataTable interaction", () => {
  it("toggles sort with keyboard activation and reports aria-sort", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <DataTable
        columns={memberColumns({ onAction })}
        keySelector={(row) => row.id}
        rows={MEMBERS}
      />,
    );

    const sortButton = screen.getByRole("button", { name: "Sort by Name" });
    expect(firstTableCellText()).toBe("Beta Singer");

    sortButton.focus();
    await user.keyboard("{Enter}");
    expect(sortButton.closest("th")).toHaveAttribute("aria-sort", "ascending");
    expect(firstTableCellText()).toBe("Alpha Singer");

    await user.keyboard("{Enter}");
    expect(sortButton.closest("th")).toHaveAttribute("aria-sort", "descending");
    expect(firstTableCellText()).toBe("Beta Singer");
  });

  it("activates clickable rows with Enter and Space", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const onRowClick = vi.fn();
    render(
      <DataTable
        columns={memberColumns({ onAction })}
        keySelector={(row) => row.id}
        onRowClick={onRowClick}
        rowLabel={(row) => `Open ${row.name}`}
        rows={MEMBERS}
      />,
    );

    const row = screen.getByRole("button", { name: "Open Beta Singer" });
    row.focus();
    await user.keyboard("{Enter}");
    expect(onRowClick).toHaveBeenCalledWith(MEMBERS[0]);

    onRowClick.mockClear();
    await user.keyboard(" ");
    expect(onRowClick).toHaveBeenCalledWith(MEMBERS[0]);
  });

  it("does not trigger row navigation from interactive cell controls", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const onRowClick = vi.fn();
    render(
      <DataTable
        columns={memberColumns({ onAction })}
        keySelector={(row) => row.id}
        onRowClick={onRowClick}
        rows={MEMBERS}
      />,
    );

    // The table and its mobile-card copy render the same action control;
    // scope to the table to prove the table-row guard.
    const table = document.querySelector("table.data-table");
    expect(table).not.toBeNull();
    if (!(table instanceof HTMLTableElement)) return;
    await user.click(within(table).getByRole("button", { name: "Edit Beta Singer" }));
    expect(onAction).toHaveBeenCalledWith(MEMBERS[0]);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("renders mobile cards with mobile labels alongside the table", () => {
    const onAction = vi.fn();
    render(
      <DataTable
        columns={memberColumns({ onAction })}
        keySelector={(row) => row.id}
        rows={MEMBERS}
      />,
    );

    const cards = document.querySelector(".data-table-cards");
    expect(cards).not.toBeNull();
    if (!(cards instanceof HTMLElement)) return;
    const cardLabels = within(cards).getAllByText("Voice part");
    expect(cardLabels.length).toBeGreaterThan(0);
    expect(within(cards).getByText("Beta Singer")).toBeVisible();
    expect(document.querySelector("table.data-table")).not.toBeNull();
  });

  it("pages with keyboard and disables boundary controls", async () => {
    const user = userEvent.setup();
    function PagedHarness() {
      const [page, setPage] = useState(1);
      const rows: readonly Member[] = [
        { id: "1", name: "One", section: "Soprano" },
        { id: "2", name: "Two", section: "Alto" },
        { id: "3", name: "Three", section: "Tenor" },
        { id: "4", name: "Four", section: "Bass" },
        { id: "5", name: "Five", section: "Soprano" },
      ];
      return (
        <DataTable
          columns={memberColumns({ onAction: () => undefined })}
          keySelector={(row) => row.id}
          pagination={{ onPageChange: setPage, page, pageSize: 2 }}
          rows={rows}
        />
      );
    }
    render(<PagedHarness />);

    const nav = screen.getByRole("navigation", { name: "Pagination" });
    expect(within(nav).getByRole("button", { name: "First page" })).toBeDisabled();
    expect(within(nav).getByRole("button", { name: "Previous page" })).toBeDisabled();

    const next = within(nav).getByRole("button", { name: "Next page" });
    next.focus();
    await user.keyboard("{Enter}");
    expect(within(nav).getByLabelText("Page number")).toHaveValue(2);

    const last = within(nav).getByRole("button", { name: "Last page" });
    last.focus();
    await user.keyboard("{Enter}");
    expect(within(nav).getByLabelText("Page number")).toHaveValue(3);
    expect(within(nav).getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(within(nav).getByRole("button", { name: "Last page" })).toBeDisabled();
  });

  it("commits the page-number input on Enter", async () => {
    const user = userEvent.setup();
    function PagedHarness() {
      const [page, setPage] = useState(1);
      const rows: readonly Member[] = [
        { id: "1", name: "One", section: "Soprano" },
        { id: "2", name: "Two", section: "Alto" },
        { id: "3", name: "Three", section: "Tenor" },
        { id: "4", name: "Four", section: "Bass" },
        { id: "5", name: "Five", section: "Soprano" },
      ];
      return (
        <DataTable
          columns={memberColumns({ onAction: () => undefined })}
          keySelector={(row) => row.id}
          pagination={{ onPageChange: setPage, page, pageSize: 2 }}
          rows={rows}
        />
      );
    }
    render(<PagedHarness />);

    const nav = screen.getByRole("navigation", { name: "Pagination" });
    const pageInput = within(nav).getByLabelText("Page number");
    await user.clear(pageInput);
    await user.type(pageInput, "3{Enter}");
    expect(within(nav).getByLabelText("Page number")).toHaveValue(3);
  });

  it("announces rows-per-page selection accessibly", async () => {
    const user = userEvent.setup();
    const onPageSizeChange = vi.fn();
    function SizedHarness() {
      const [page, setPage] = useState(1);
      return (
        <DataTable
          columns={memberColumns({ onAction: () => undefined })}
          keySelector={(row) => row.id}
          pagination={{
            onPageChange: setPage,
            onPageSizeChange,
            page,
            pageSize: 2,
            pageSizeOptions: [2, 4],
          }}
          rows={[
            { id: "1", name: "One", section: "Soprano" },
            { id: "2", name: "Two", section: "Alto" },
            { id: "3", name: "Three", section: "Tenor" },
          ]}
        />
      );
    }
    render(<SizedHarness />);

    await user.selectOptions(screen.getByLabelText("Rows per page"), "4");
    expect(onPageSizeChange).toHaveBeenCalledWith(4);
  });
});
