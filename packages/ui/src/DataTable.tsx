import { useMemo, useState, type ReactNode } from "react";

export type DataTableSortDirection = "asc" | "desc";

export interface DataTableColumn<T> {
  readonly header: string;
  readonly id: string;
  readonly mobileLabel?: string;
  readonly render: (row: T) => ReactNode;
  readonly sortValue?: (row: T) => boolean | number | string | null | undefined;
}

export interface DataTableSort {
  readonly columnId: string;
  readonly direction: DataTableSortDirection;
}

interface DataTableProps<T> {
  readonly columns: readonly DataTableColumn<T>[];
  readonly emptyMessage?: string;
  readonly initialSort?: DataTableSort;
  readonly keySelector: (row: T) => string;
  readonly rows: readonly T[];
}

function compareValues(
  left: boolean | number | string | null | undefined,
  right: boolean | number | string | null | undefined,
): number {
  if (left === right) return 0;
  if (left === null || left === undefined || left === "") return 1;
  if (right === null || right === undefined || right === "") return -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right);
  }
  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function DataTable<T>({
  columns,
  emptyMessage = "No results.",
  initialSort,
  keySelector,
  rows,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<DataTableSort | null>(initialSort ?? null);
  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find(({ id }) => id === sort.columnId);
    if (!column?.sortValue) return rows;
    return [...rows].sort((left, right) => {
      const leftValue = column.sortValue?.(left);
      const rightValue = column.sortValue?.(right);
      const leftEmpty = leftValue === null || leftValue === undefined || leftValue === "";
      const rightEmpty = rightValue === null || rightValue === undefined || rightValue === "";
      if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
      const comparison = compareValues(leftValue, rightValue);
      return sort.direction === "asc" ? comparison : -comparison;
    });
  }, [columns, rows, sort]);

  function toggleSort(column: DataTableColumn<T>): void {
    if (!column.sortValue) return;
    setSort((current) => {
      if (current?.columnId !== column.id) {
        return { columnId: column.id, direction: "asc" };
      }
      if (current.direction === "asc") {
        return { columnId: column.id, direction: "desc" };
      }
      return null;
    });
  }

  if (rows.length === 0) {
    return <p className="empty-state">{emptyMessage}</p>;
  }

  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sort?.columnId === column.id;
              return (
                <th
                  aria-sort={
                    active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
                  }
                  key={column.id}
                >
                  {column.sortValue ? (
                    <button
                      aria-label={`Sort by ${column.header}`}
                      className="data-table__sort-button"
                      onClick={() => {
                        toggleSort(column);
                      }}
                      type="button"
                    >
                      {column.header}
                      <span aria-hidden="true">
                        {active ? (sort.direction === "asc" ? " ↑" : " ↓") : " ↕"}
                      </span>
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr key={keySelector(row)}>
              {columns.map((column) => (
                <td key={column.id}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="data-table-cards">
        {sortedRows.map((row) => (
          <div className="data-table-card" key={keySelector(row)}>
            {columns.map((column) => (
              <div className="data-table-card__field" key={column.id}>
                <span className="data-table-card__label">
                  {column.mobileLabel ?? column.header}
                </span>
                <span className="data-table-card__value">{column.render(row)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
