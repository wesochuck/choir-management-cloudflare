import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import { paginateRows } from "./pagination";

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

export interface DataTablePagination {
  readonly page: number;
  readonly pageSize: number;
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange?: (pageSize: number) => void;
  readonly pageSizeOptions?: readonly number[];
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
  readonly align?: "left" | "center" | "right";
  readonly className?: string;
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

export interface DataTableProps<T> {
  readonly columns: readonly DataTableColumn<T>[];
  readonly emptyMessage?: string;
  readonly expandedRowId?: string | null;
  readonly getRowProps?: (row: T, context: DataTableRowContext<T>) => DataTableRowProps | undefined;
  readonly initialSort?: DataTableSort;
  readonly isRowInteractive?: (row: T) => boolean;
  readonly keySelector: (row: T) => string;
  readonly onRowClick?: (row: T) => void;
  readonly pagination?: DataTablePagination;
  readonly renderExpandedRow?: (row: T, presentation: DataTablePresentation) => ReactNode;
  readonly rowLabel?: (row: T) => string | undefined;
  readonly rows: readonly T[];
}

function isInteractiveTarget(target: EventTarget | null, currentTarget: HTMLElement): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const closest = target.closest(
    "a,button,input,select,textarea,[role='button'],.table-actions,.data-table__cell--actions,.data-table-card__field--actions",
  );
  return closest !== null && closest !== currentTarget;
}

function isActionColumn<T>(column: DataTableColumn<T>): boolean {
  return (
    column.id === "action" ||
    column.id === "actions" ||
    /^(action|actions|manage)$/i.test(column.header)
  );
}

function getColumnCellClass<T>(column: DataTableColumn<T>): string | undefined {
  const classes: string[] = [];
  if (isActionColumn(column)) {
    classes.push("data-table__cell--actions");
  }
  if (column.align === "center") {
    classes.push("data-table__cell--center");
  } else if (column.align === "right") {
    classes.push("data-table__cell--right");
  } else if (column.align === "left") {
    classes.push("data-table__cell--left");
  }
  if (column.className) {
    classes.push(column.className);
  }
  return classes.length > 0 ? classes.join(" ") : undefined;
}

function getCardFieldClass<T>(column: DataTableColumn<T>): string {
  const classes: string[] = ["data-table-card__field"];
  if (isActionColumn(column)) {
    classes.push("data-table-card__field--actions");
  }
  if (column.align === "center") {
    classes.push("data-table-card__field--center");
  } else if (column.align === "right") {
    classes.push("data-table-card__field--right");
  } else if (column.align === "left") {
    classes.push("data-table-card__field--left");
  }
  if (column.className) {
    classes.push(column.className);
  }
  return classes.join(" ");
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
  emptyMessage = "No results",
  expandedRowId = null,
  getRowProps,
  initialSort,
  isRowInteractive,
  keySelector,
  onRowClick,
  pagination,
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

  const paginated = useMemo(() => {
    if (!pagination) return { page: 1, pageCount: 1, rows: sortedRows };
    return paginateRows(sortedRows, pagination.page, pagination.pageSize);
  }, [pagination, sortedRows]);

  const visibleRows = paginated.rows;
  const pageCount = paginated.pageCount;
  const currentPage = pagination ? paginated.page : 1;
  const pageSize = pagination?.pageSize ?? sortedRows.length;
  const startIndex = pagination ? (currentPage - 1) * pageSize : 0;

  const [pageDraft, setPageDraft] = useState(String(currentPage));

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled input draft sync
    setPageDraft(String(currentPage));
  }, [currentPage]);

  function commitPageDraft(): void {
    if (!pagination) return;
    const parsed = Number.parseInt(pageDraft, 10);
    if (!Number.isFinite(parsed)) {
      setPageDraft(String(currentPage));
      return;
    }
    const clamped = Math.min(Math.max(Math.trunc(parsed), 1), Math.max(pageCount, 1));
    if (clamped !== currentPage) {
      pagination.onPageChange(clamped);
    } else {
      setPageDraft(String(clamped));
    }
  }

  function toggleSort(column: DataTableColumn<T>): void {
    if (!column.sortValue) return;
    if (pagination) {
      pagination.onPageChange(1);
    }
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

  const showPagination = pagination !== undefined && pageCount > 1;

  return (
    <div className="data-table-container">
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((column) => {
                const active = sort?.columnId === column.id;
                const cellClass = getColumnCellClass(column);
                return (
                  <th
                    aria-sort={
                      active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
                    }
                    className={cellClass}
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
            {visibleRows.map((row, localIndex) => {
              const index = startIndex + localIndex;
              const rowId = keySelector(row);
              const isExpanded = renderExpandedRow !== undefined && expandedRowId === rowId;
              const isInteractive =
                Boolean(onRowClick) && (isRowInteractive ? isRowInteractive(row) : true);
              const customRowProps = getRowProps?.(row, {
                index,
                presentation: "table",
                rows: sortedRows,
              });
              const rowClassName =
                [isInteractive ? "data-table__row--interactive" : null, customRowProps?.className]
                  .filter(Boolean)
                  .join(" ") || undefined;
              const rowEventProps =
                dataTableElementRowEventProps<HTMLTableRowElement>(customRowProps);
              return (
                <Fragment key={rowId}>
                  <tr
                    aria-label={isInteractive ? (rowLabel?.(row) ?? "Open row") : undefined}
                    className={rowClassName}
                    draggable={customRowProps?.draggable}
                    onClick={(event) => {
                      if (!isInteractive || isInteractiveTarget(event.target, event.currentTarget))
                        return;
                      onRowClick?.(row);
                    }}
                    onKeyDown={(event) => {
                      if (!isInteractive || isInteractiveTarget(event.target, event.currentTarget))
                        return;
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      onRowClick?.(row);
                    }}
                    {...rowEventProps}
                    tabIndex={isInteractive ? 0 : undefined}
                  >
                    {columns.map((column) => (
                      <td className={getColumnCellClass(column)} key={column.id}>
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
      </div>
      <div className="data-table-cards">
        {visibleRows.map((row, localIndex) => {
          const index = startIndex + localIndex;
          const rowId = keySelector(row);
          const isExpanded = renderExpandedRow !== undefined && expandedRowId === rowId;
          const isInteractive =
            Boolean(onRowClick) && (isRowInteractive ? isRowInteractive(row) : true);
          const customRowProps = getRowProps?.(row, {
            index,
            presentation: "card",
            rows: sortedRows,
          });
          const cardClassName = [
            isInteractive ? "data-table-card data-table-card--interactive" : "data-table-card",
            customRowProps?.className,
          ]
            .filter(Boolean)
            .join(" ");
          const cardEventProps = dataTableElementRowEventProps<HTMLDivElement>(customRowProps);
          return (
            <Fragment key={rowId}>
              <div
                aria-label={isInteractive ? (rowLabel?.(row) ?? "Open row") : undefined}
                className={cardClassName}
                draggable={customRowProps?.draggable}
                onClick={(event) => {
                  if (!isInteractive || isInteractiveTarget(event.target, event.currentTarget))
                    return;
                  onRowClick?.(row);
                }}
                onKeyDown={(event) => {
                  if (!isInteractive || isInteractiveTarget(event.target, event.currentTarget))
                    return;
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onRowClick?.(row);
                }}
                {...cardEventProps}
                role={isInteractive ? "button" : undefined}
                tabIndex={isInteractive ? 0 : undefined}
              >
                {columns.map((column) => (
                  <div className={getCardFieldClass(column)} key={column.id}>
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
      {showPagination ? (
        <nav aria-label="Pagination" className="data-table-pagination">
          <div className="data-table-pagination__controls">
            <button
              aria-label="First page"
              className="data-table-pagination__button"
              disabled={currentPage === 1}
              onClick={() => {
                pagination.onPageChange(1);
              }}
              type="button"
            >
              «
            </button>
            <button
              aria-label="Previous page"
              className="data-table-pagination__button"
              disabled={currentPage === 1}
              onClick={() => {
                pagination.onPageChange(currentPage - 1);
              }}
              type="button"
            >
              ‹
            </button>
            <span className="data-table-pagination__page">
              Page
              <input
                aria-label="Page number"
                className="data-table-pagination__input"
                max={pageCount}
                min={1}
                onBlur={() => {
                  commitPageDraft();
                }}
                onChange={(event) => {
                  setPageDraft(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitPageDraft();
                    const target = event.currentTarget;
                    target.blur();
                  }
                }}
                type="number"
                value={pageDraft}
              />
              of {pageCount}
            </span>
            <button
              aria-label="Next page"
              className="data-table-pagination__button"
              disabled={currentPage === pageCount}
              onClick={() => {
                pagination.onPageChange(currentPage + 1);
              }}
              type="button"
            >
              ›
            </button>
            <button
              aria-label="Last page"
              className="data-table-pagination__button"
              disabled={currentPage === pageCount}
              onClick={() => {
                pagination.onPageChange(pageCount);
              }}
              type="button"
            >
              »
            </button>
          </div>
          {pagination.onPageSizeChange ? (
            <label className="data-table-pagination__size">
              Rows per page
              <select
                aria-label="Rows per page"
                onChange={(event) => {
                  const nextSize = Number(event.target.value);
                  pagination.onPageSizeChange?.(nextSize);
                }}
                value={String(pageSize)}
              >
                {(pagination.pageSizeOptions ?? [25, 50, 100]).map((option) => (
                  <option key={option} value={String(option)}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
