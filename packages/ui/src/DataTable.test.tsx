import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DataTable, type DataTableColumn } from "./DataTable";

describe("DataTable component", () => {
  interface Item {
    readonly id: string;
    readonly name: string;
  }

  const columns: readonly DataTableColumn<Item>[] = [
    {
      header: "Name",
      id: "name",
      render: (item) => item.name,
    },
  ];

  const rows: readonly Item[] = [
    { id: "1", name: "Alpha" },
    { id: "2", name: "Beta" },
  ];

  it("renders data-table-container with table-scroll wrapping only table, and cards outside", () => {
    const html = renderToString(
      <DataTable columns={columns} keySelector={(item) => item.id} rows={rows} />,
    );

    expect(html).toContain('class="data-table-container"');
    expect(html).toContain('class="table-scroll"');
    expect(html).toContain('class="data-table"');
    expect(html).toContain('class="data-table-cards"');

    // Verify table-scroll wraps table, but not data-table-cards
    const tableScrollIndex = html.indexOf('class="table-scroll"');
    const tableIndex = html.indexOf('class="data-table"');
    const cardsIndex = html.indexOf('class="data-table-cards"');

    expect(tableScrollIndex).toBeLessThan(tableIndex);
    // table-scroll closing div must come before data-table-cards
    const tableScrollContent = html.substring(tableScrollIndex, cardsIndex);
    expect(tableScrollContent).toContain("</table></div>");
  });
});
