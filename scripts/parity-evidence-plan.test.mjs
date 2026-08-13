import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";
import { parse } from "yaml";

import {
  buildAnonymousProbeRows,
  buildProbePlan,
  isExpectedAnonymousBoundary,
  materializeRoutePath,
  probePlan,
  usesOrganizationHost,
} from "./parity-evidence-plan.mjs";

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

  test("keeps remaining non-fixture probes aligned with the evidence plan", () => {
    const rows = buildProbePlan(matrix);
    const probes = rows.filter((row) => !row.kind.startsWith("skip"));
    // The generated plan contains only entries that remain implemented. As staging evidence is
    // promoted, verified probes leave this follow-up plan, so the remaining list may be empty.
    expect(
      probes.every((row) =>
        ["read-anon", "read-auth", "validation", "fail-closed"].includes(row.kind),
      ),
    ).toBe(true);
    expect(probes.every((row) => Number.isInteger(row.expected))).toBe(true);
  });

  test("treats setup health as an authenticated Organization-host probe", () => {
    expect(probePlan.get("api.setup-health")).toEqual({ kind: "read-auth", expected: 200 });
  });

  test("routes canonical public and Organization-scoped probes to an Organization host", () => {
    const rowFor = (id) => {
      const entry = matrix.apiRoutes.find((candidate) => candidate.id === id);
      return { id: entry.id, route: materializeRoutePath(entry.path) };
    };
    for (const id of [
      "api.setup-health",
      "api.rsvp-details",
      "api.calendar-feed",
      "api.account.email-change-confirm",
      "api.platform.reconciliation-report",
      "api.maintenance",
    ]) {
      expect(usesOrganizationHost(rowFor(id)), id).toBe(true);
    }
    expect(usesOrganizationHost(rowFor("api.platform.email-suppressions"))).toBe(false);
    expect(usesOrganizationHost(rowFor("api.stripe-webhook"))).toBe(false);
  });

  test("accepts only typed no-session boundary responses", () => {
    expect(
      isExpectedAnonymousBoundary(
        { id: "api.rsvp-details" },
        { status: 400, code: "validation_failed" },
      ),
    ).toBe(true);
    expect(
      isExpectedAnonymousBoundary(
        { id: "api.player-playlist" },
        { status: 404, code: "invalid_link" },
      ),
    ).toBe(true);
    expect(
      isExpectedAnonymousBoundary(
        { id: "api.stripe-webhook" },
        { status: 503, code: "stripe_webhook_unavailable" },
      ),
    ).toBe(true);
    expect(
      isExpectedAnonymousBoundary(
        { id: "api.stripe-webhook" },
        { status: 400, code: "invalid_webhook_signature" },
      ),
    ).toBe(true);
    expect(
      isExpectedAnonymousBoundary({ id: "api.rsvp-details" }, { status: 404, code: "not_found" }),
    ).toBe(false);
    expect(
      isExpectedAnonymousBoundary({ id: "api.rsvp-details" }, { error: "timed out", status: 0 }),
    ).toBe(false);
    expect(isExpectedAnonymousBoundary({ id: "api.rsvp-details" }, { status: 401 })).toBe(false);
    expect(
      isExpectedAnonymousBoundary(
        { id: "api.rsvp-details" },
        { status: 418, code: "unexpected_response" },
      ),
    ).toBe(false);
  });

  test("materializes dynamic route parameters for safe boundary probes", () => {
    expect(materializeRoutePath("/api/events/:eventId/profiles/:profileId")).toBe(
      "/api/events/00000000-0000-4000-8000-000000000000/profiles/00000000-0000-4000-8000-000000000000",
    );
  });

  test("covers every Organization-host route on each seeded host", () => {
    const rows = buildAnonymousProbeRows(matrix, ["lcc", "lmc"]);
    const organizationRouteCount = matrix.apiRoutes.filter((entry) =>
      usesOrganizationHost({ id: entry.id, route: entry.path }),
    ).length;
    expect(rows).toHaveLength(matrix.apiRoutes.length + organizationRouteCount);
    expect(
      rows.filter((row) => row.id === "api.setup-health").map((row) => row.organizationSlug),
    ).toEqual(["lcc", "lmc"]);
    expect(rows.filter((row) => row.id === "api.health")).toHaveLength(1);
    expect(rows.every((row) => !row.route.includes(":"))).toBe(true);
  });
});
