import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_DATABASE_COST_THRESHOLDS,
  evaluateDatabaseCostWarning,
  recordDatabaseCost,
  type DatabaseCostRecord,
} from "../src/observability/databaseCost";

describe("databaseCost observability", () => {
  it("suppresses warning for normal low-cost operations", () => {
    const normalRecord: DatabaseCostRecord = {
      operation: "organization_sqlite.scheduler.fee_reconciliation",
      rowsRead: 10,
      rowsReturned: 5,
      rowsWritten: 0,
      store: "organization_sqlite",
    };

    expect(evaluateDatabaseCostWarning(normalRecord)).toBe(false);

    const warnSpy = vi.spyOn(console, "warn").mockReturnValue();
    const infoSpy = vi.spyOn(console, "info").mockReturnValue();

    try {
      const warning = recordDatabaseCost(normalRecord);
      expect(warning).toBe(false);
      expect(warnSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      infoSpy.mockRestore();
    }
  });

  it("warns when rowsRead exceeds warning threshold", () => {
    const highReadRecord: DatabaseCostRecord = {
      operation: "d1.email_change.reconcile",
      rowsRead: DEFAULT_DATABASE_COST_THRESHOLDS.rowsReadWarningThreshold + 1,
      rowsWritten: 2,
      store: "d1",
    };

    expect(evaluateDatabaseCostWarning(highReadRecord)).toBe(true);

    const warnSpy = vi.spyOn(console, "warn").mockReturnValue();
    try {
      const warning = recordDatabaseCost(highReadRecord);
      expect(warning).toBe(true);
      expect(warnSpy).toHaveBeenCalledOnce();

      const firstCallArg = warnSpy.mock.calls[0]?.[0];
      const rawLogged = typeof firstCallArg === "string" ? firstCallArg : "{}";
      expect(JSON.parse(rawLogged)).toEqual({
        event: "db_cost",
        operation: "d1.email_change.reconcile",
        rowsRead: DEFAULT_DATABASE_COST_THRESHOLDS.rowsReadWarningThreshold + 1,
        rowsWritten: 2,
        store: "d1",
        warning: true,
      });
      // Ensure no sensitive or unbounded fields
      expect(rawLogged).not.toContain("query");
      expect(rawLogged).not.toContain("sql");
      expect(rawLogged).not.toContain("params");
      expect(rawLogged).not.toContain("bindings");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("warns when rowsWritten exceeds warning threshold", () => {
    const highWriteRecord: DatabaseCostRecord = {
      operation: "organization_sqlite.rate_limit.checkout",
      rowsRead: 20,
      rowsWritten: DEFAULT_DATABASE_COST_THRESHOLDS.rowsWrittenWarningThreshold + 5,
      store: "organization_sqlite",
    };

    expect(evaluateDatabaseCostWarning(highWriteRecord)).toBe(true);

    const warnSpy = vi.spyOn(console, "warn").mockReturnValue();
    try {
      const warning = recordDatabaseCost(highWriteRecord);
      expect(warning).toBe(true);
      expect(warnSpy).toHaveBeenCalledOnce();

      const firstCallArg = warnSpy.mock.calls[0]?.[0];
      const rawLogged = typeof firstCallArg === "string" ? firstCallArg : "{}";
      expect(JSON.parse(rawLogged)).toEqual({
        event: "db_cost",
        operation: "organization_sqlite.rate_limit.checkout",
        rowsRead: 20,
        rowsWritten: DEFAULT_DATABASE_COST_THRESHOLDS.rowsWrittenWarningThreshold + 5,
        store: "organization_sqlite",
        warning: true,
      });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("warns when scan-to-returned ratio exceeds threshold for significant scans", () => {
    const highRatioRecord: DatabaseCostRecord = {
      operation: "d1.email_feedback.reconcile",
      rowsRead: 100,
      rowsReturned: 1,
      rowsWritten: 0,
      store: "d1",
    };

    expect(evaluateDatabaseCostWarning(highRatioRecord)).toBe(true);

    const lowReadRecordWithZeroReturned: DatabaseCostRecord = {
      operation: "d1.email_feedback.reconcile",
      rowsRead: 5,
      rowsReturned: 0,
      rowsWritten: 0,
      store: "d1",
    };

    // Low scan size does not trigger ratio warning to prevent noisy logs
    expect(evaluateDatabaseCostWarning(lowReadRecordWithZeroReturned)).toBe(false);
  });

  it("supports debugAlwaysLog for diagnostics without marking warning", () => {
    const normalRecord: DatabaseCostRecord = {
      environment: "test",
      operation: "organization_sqlite.scheduler.pending_jobs",
      requestId: "req-123",
      rowsRead: 2,
      rowsReturned: 2,
      rowsWritten: 0,
      store: "organization_sqlite",
    };

    const warnSpy = vi.spyOn(console, "warn").mockReturnValue();
    const infoSpy = vi.spyOn(console, "info").mockReturnValue();

    try {
      const warning = recordDatabaseCost(normalRecord, { debugAlwaysLog: true });
      expect(warning).toBe(false);
      expect(warnSpy).not.toHaveBeenCalled();
      expect(infoSpy).toHaveBeenCalledOnce();

      const firstCallArg = infoSpy.mock.calls[0]?.[0];
      const rawLogged = typeof firstCallArg === "string" ? firstCallArg : "{}";
      expect(JSON.parse(rawLogged)).toEqual({
        environment: "test",
        event: "db_cost",
        operation: "organization_sqlite.scheduler.pending_jobs",
        requestId: "req-123",
        rowsRead: 2,
        rowsReturned: 2,
        rowsWritten: 0,
        store: "organization_sqlite",
        warning: false,
      });
    } finally {
      warnSpy.mockRestore();
      infoSpy.mockRestore();
    }
  });
});
