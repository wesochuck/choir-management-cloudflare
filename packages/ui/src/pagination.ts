export interface PaginatedSlice<T> {
  readonly page: number;
  readonly pageCount: number;
  readonly rows: readonly T[];
}

export function pageCountFor(totalRows: number, pageSize: number): number {
  if (totalRows <= 0 || pageSize <= 0) return 0;
  return Math.ceil(totalRows / pageSize);
}

export function clampPage(page: number, pageCount: number): number {
  if (pageCount <= 0) return 1;
  return Math.min(Math.max(Math.trunc(page), 1), pageCount);
}

export function paginateRows<T>(
  rows: readonly T[],
  page: number,
  pageSize: number,
): PaginatedSlice<T> {
  const pageCount = pageCountFor(rows.length, pageSize);
  const safePage = clampPage(page, pageCount);
  const start = (safePage - 1) * pageSize;
  return {
    page: safePage,
    pageCount,
    rows: rows.slice(start, start + pageSize),
  };
}

export function pageStartIndex(page: number, pageSize: number): number {
  return (Math.max(Math.trunc(page), 1) - 1) * pageSize;
}
