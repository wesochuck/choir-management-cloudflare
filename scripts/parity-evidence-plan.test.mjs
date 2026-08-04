import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";
import { parse } from "yaml";

import { buildProbePlan, probePlan } from "./parity-evidence-plan.mjs";

const matrix = parse(
  await readFile(new URL("../docs/parity/feature-matrix.yaml", import.meta.url), "utf8"),
);

describe("parity staging evidence plan", () => {
  test("maps every implemented API entry to a probe kind", () => {
    const implemented = matrix.apiRoutes.filter((entry) => entry.status === "implemented");
    const rows = buildProbePlan(matrix);
    expect(rows).toHaveLength(implemented.length);
    expect(rows.filter((row) => row.kind === "skip-unmapped")).toEqual([]);
  });

  test("keeps every probe plan id present in the matrix", () => {
    const ids = new Set(matrix.apiRoutes.map((entry) => entry.id));
    for (const id of probePlan.keys()) {
      expect(ids.has(id), `probe plan references missing matrix entry ${id}`).toBe(true);
    }
  });

  test("keeps probe kinds and expected statuses valid", () => {
    const validKinds = new Set([
      "read-anon",
      "read-auth",
      "validation",
      "fail-closed",
      "skip-fixture",
      "skip-elevation",
    ]);
    for (const plan of probePlan.values()) {
      expect(validKinds.has(plan.kind), `invalid probe kind ${plan.kind}`).toBe(true);
      if (!plan.kind.startsWith("skip")) {
        expect(Number.isInteger(plan.expected)).toBe(true);
      }
    }
  });

  test("keeps the read and validation probe mix meaningful", () => {
    const rows = buildProbePlan(matrix);
    const probes = rows.filter((row) => !row.kind.startsWith("skip"));
    expect(probes.length).toBeGreaterThan(20);
    expect(
      probes.filter((row) => row.kind === "read-anon" || row.kind === "read-auth").length,
    ).toBeGreaterThan(10);
    expect(probes.filter((row) => row.kind === "validation").length).toBeGreaterThan(10);
  });
});
