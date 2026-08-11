import {
  Fragment,
  useMemo,
  useState,
  type DragEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

export type DataTableSortDirection = "asc" | "desc";

export type DataTablePresentation = "table" | "card";

export interface DataTableRenderContext {
  readonly presentation: DataTablePresentation;
}

export interface DataTableRowContext<T> {
  readonly index: number;
  readonly presentation: DataTablePresentation;
  readonly rows: readonly T[];
}

export interface DataTableRowProps {
  readonly className?: string;
  readonly draggable?: boolean;
  readonly onDragEnd?: (event: DragEvent<HTMLElement>) => void;
  readonly onDragOver?: (event: DragEvent<HTMLElement>) => void;
  readonly onDragStart?: (event: DragEvent<HTMLElement>) => void;
  readonly onDrop?: (event: DragEvent<HTMLElement>) => void;
  readonly onPointerCancel?: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerUp?: (event: PointerEvent<HTMLElement>) => void;
}

interface DataTableElementRowEventProps<T extends HTMLElement> {
  readonly onDragEnd: ((event: DragEvent<T>) => void) | undefined;
  readonly onDragOver: ((event: DragEvent<T>) => void) | undefined;
  readonly onDragStart: ((event: DragEvent<T>) => void) | undefined;
  readonly onDrop: ((event: DragEvent<T>) => void) | undefined;
  readonly onPointerCancel: ((event: PointerEvent<T>) => void) | undefined;
  readonly onPointerDown: ((event: PointerEvent<T>) => void) | undefined;
  readonly onPointerUp: ((event: PointerEvent<T>) => void) | undefined;
}

function wrapDragHandler<T extends HTMLElement>(
  handler: ((event: DragEvent<HTMLElement>) => void) | undefined,
): ((event: DragEvent<T>) => void) | undefined {
  if (!handler) return undefined;
  return (event) => {
    handler(event);
  };
}

function wrapPointerHandler<T extends HTMLElement>(
  handler: ((event: PointerEvent<HTMLElement>) => void) | undefined,
): ((event: PointerEvent<T>) => void) | undefined {
  if (!handler) return undefined;
  return (event) => {
    handler(event);
  };
}

function dataTableElementRowEventProps<T extends HTMLElement>(
  rowProps: DataTableRowProps | undefined,
): DataTableElementRowEventProps<T> {
  return {
    onDragEnd: wrapDragHandler(rowProps?.onDragEnd),
    onDragOver: wrapDragHandler(rowProps?.onDragOver),
    onDragStart: wrapDragHandler(rowProps?.onDragStart),
    onDrop: wrapDragHandler(rowProps?.onDrop),
    onPointerCancel: wrapPointerHandler(rowProps?.onPointerCancel),
    onPointerDown: wrapPointerHandler(rowProps?.onPointerDown),
    onPointerUp: wrapPointerHandler(rowProps?.onPointerUp),
  };
}

export interface DataTableColumn<T> {
  readonly header: string;
  readonly headerContent?: ReactNode;
  readonly id: string;
  readonly mobileLabel?: string;
  readonly render: (row: T, context: DataTableRenderContext) => ReactNode;
  readonly sortValue?: (row: T) => boolean | number | string | null | undefined;
}

export interface DataTableSort {
  readonly columnId: string;
  readonly direction: DataTableSortDirection;
}

interface DataTableProps<T> {
  readonly columns: readonly DataTableColumn<T>[];
  readonly emptyMessage?: string;
  readonly expandedRowId?: string | null;
  readonly getRowProps?: (row: T, context: DataTableRowContext<T>) => DataTableRowProps | undefined;
  readonly initialSort?: DataTableSort;
  readonly keySelector: (row: T) => string;
  readonly onRowClick?: (row: T) => void;
  readonly renderExpandedRow?: (row: T, presentation: DataTablePresentation) => ReactNode;
  readonly rowLabel?: (row: T) => string;
  readonly rows: readonly T[];
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("a,button,input,select,textarea,[role='button']"))
  );
}

function isActionColumn<T>(column: DataTableColumn<T>): boolean {
  return (
    column.id === "action" ||
    column.id === "actions" ||
    /^(action|actions|manage)$/i.test(column.header)
  );
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
  expandedRowId = null,
  getRowProps,
  initialSort,
  keySelector,
  onRowClick,
  renderExpandedRow,
  rowLabel,
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
              const actionColumn = isActionColumn(column);
              return (
                <th
                  aria-sort={
                    active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
                  }
                  className={actionColumn ? "data-table__cell--actions" : undefined}
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
                    (column.headerContent ?? column.header)
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, index) => {
            const rowId = keySelector(row);
            const isExpanded = renderExpandedRow !== undefined && expandedRowId === rowId;
            const customRowProps = getRowProps?.(row, {
              index,
              presentation: "table",
              rows: sortedRows,
            });
            const rowClassName =
              [onRowClick ? "data-table__row--interactive" : null, customRowProps?.className]
                .filter(Boolean)
                .join(" ") || undefined;
            const rowEventProps =
              dataTableElementRowEventProps<HTMLTableRowElement>(customRowProps);
            return (
              <Fragment key={rowId}>
                <tr
                  className={rowClassName}
                  draggable={customRowProps?.draggable}
                  onClick={(event) => {
                    if (!onRowClick || isInteractiveTarget(event.target)) return;
                    onRowClick(row);
                  }}
                  onKeyDown={(event) => {
                    if (!onRowClick || isInteractiveTarget(event.target)) return;
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    onRowClick(row);
                  }}
                  {...rowEventProps}
                  tabIndex={onRowClick ? 0 : undefined}
                  aria-label={onRowClick ? (rowLabel?.(row) ?? "Open row") : undefined}
                >
                  {columns.map((column) => (
                    <td
                      className={isActionColumn(column) ? "data-table__cell--actions" : undefined}
                      key={column.id}
                    >
                      {column.render(row, { presentation: "table" })}
                    </td>
                  ))}
                </tr>
                {isExpanded ? (
                  <tr className="data-table__expanded-row">
                    <td className="data-table__expanded-cell" colSpan={columns.length}>
                      {renderExpandedRow(row, "table")}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <div className="data-table-cards">
        {sortedRows.map((row, index) => {
          const rowId = keySelector(row);
          const isExpanded = renderExpandedRow !== undefined && expandedRowId === rowId;
          const customRowProps = getRowProps?.(row, {
            index,
            presentation: "card",
            rows: sortedRows,
          });
          const cardClassName = [
            onRowClick ? "data-table-card data-table-card--interactive" : "data-table-card",
            customRowProps?.className,
          ]
            .filter(Boolean)
            .join(" ");
          const cardEventProps = dataTableElementRowEventProps<HTMLDivElement>(customRowProps);
          return (
            <Fragment key={rowId}>
              <div
                aria-label={onRowClick ? (rowLabel?.(row) ?? "Open row") : undefined}
                className={cardClassName}
                draggable={customRowProps?.draggable}
                onClick={(event) => {
                  if (!onRowClick || isInteractiveTarget(event.target)) return;
                  onRowClick(row);
                }}
                onKeyDown={(event) => {
                  if (!onRowClick || isInteractiveTarget(event.target)) return;
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onRowClick(row);
                }}
                {...cardEventProps}
                role={onRowClick ? "button" : undefined}
                tabIndex={onRowClick ? 0 : undefined}
              >
                {columns.map((column) => (
                  <div
                    className={
                      isActionColumn(column)
                        ? "data-table-card__field data-table-card__field--actions"
                        : "data-table-card__field"
                    }
                    key={column.id}
                  >
                    <span className="data-table-card__label">
                      {column.mobileLabel ?? column.header}
                    </span>
                    <span className="data-table-card__value">
                      {column.render(row, { presentation: "card" })}
                    </span>
                  </div>
                ))}
              </div>
              {isExpanded ? (
                <div className="data-table-card__expanded">{renderExpandedRow(row, "card")}</div>
              ) : null}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
