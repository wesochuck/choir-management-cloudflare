import type { ReactNode } from "react";

interface Column<T> {
  readonly header: string;
  readonly id: string;
  readonly mobileLabel?: string;
  readonly render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  readonly columns: readonly Column<T>[];
  readonly rows: readonly T[];
  readonly keySelector: (row: T) => string;
  readonly emptyMessage?: string;
}

export function DataTable<T>({
  columns,
  rows,
  keySelector,
  emptyMessage = "No results.",
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return <p className="empty-state">{emptyMessage}</p>;
  }

  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.id}>{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={keySelector(row)}>
              {columns.map((col) => (
                <td key={col.id}>{col.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="data-table-cards">
        {rows.map((row) => (
          <div className="data-table-card" key={keySelector(row)}>
            {columns.map((col) => (
              <div className="data-table-card__field" key={col.id}>
                <span className="data-table-card__label">{col.mobileLabel ?? col.header}</span>
                <span className="data-table-card__value">{col.render(row)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
