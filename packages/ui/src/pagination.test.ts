import { describe, expect, it } from "vitest";

import { clampPage, pageCountFor, pageStartIndex, paginateRows } from "./pagination";

describe("pageCountFor", () => {
  it("computes the number of full pages", () => {
    expect(pageCountFor(0, 100)).toBe(0);
    expect(pageCountFor(1, 100)).toBe(1);
    expect(pageCountFor(100, 100)).toBe(1);
    expect(pageCountFor(101, 100)).toBe(2);
    expect(pageCountFor(5_000, 100)).toBe(50);
  });
});

describe("clampPage", () => {
  it("bounds the page to the available range", () => {
    expect(clampPage(0, 50)).toBe(1);
    expect(clampPage(1, 50)).toBe(1);
    expect(clampPage(25, 50)).toBe(25);
    expect(clampPage(51, 50)).toBe(50);
    expect(clampPage(1, 0)).toBe(1);
  });
});

describe("paginateRows", () => {
  const rows = Array.from({ length: 250 }, (_, index) => index);

  it("slices the requested page and clamps out-of-range pages", () => {
    expect(paginateRows(rows, 1, 100).rows).toEqual(Array.from({ length: 100 }, (_, i) => i));
    expect(paginateRows(rows, 3, 100).rows).toEqual(Array.from({ length: 50 }, (_, i) => 200 + i));
    expect(paginateRows(rows, 2, 100)).toMatchObject({ page: 2, pageCount: 3 });
    expect(paginateRows(rows, 99, 100)).toMatchObject({ page: 3 });
    expect(paginateRows(rows, 0, 100)).toMatchObject({ page: 1 });
  });

  it("handles an empty set without an empty page", () => {
    expect(paginateRows([], 1, 100)).toEqual({ page: 1, pageCount: 0, rows: [] });
  });
});

describe("pageStartIndex", () => {
  it("returns the global index of the first row on the page", () => {
    expect(pageStartIndex(1, 50)).toBe(0);
    expect(pageStartIndex(3, 50)).toBe(100);
  });
});
