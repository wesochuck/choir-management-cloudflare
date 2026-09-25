export type DatabaseStoreType = "d1" | "organization_sqlite";

export interface DatabaseCostRecord {
  readonly environment?: string | undefined;
  readonly operation: string;
  readonly requestId?: string | undefined;
  readonly rowsRead: number;
  readonly rowsReturned?: number | undefined;
  readonly rowsWritten: number;
  readonly store: DatabaseStoreType;
}

export interface DatabaseCostThresholds {
  readonly rowsReadWarningThreshold: number;
  readonly rowsWrittenWarningThreshold: number;
  readonly scanRatioWarningThreshold: number;
}

export const DEFAULT_DATABASE_COST_THRESHOLDS: DatabaseCostThresholds = {
  rowsReadWarningThreshold: 500,
  rowsWrittenWarningThreshold: 100,
  scanRatioWarningThreshold: 20,
};

export interface RecordDatabaseCostOptions {
  readonly debugAlwaysLog?: boolean | undefined;
  readonly thresholds?: Partial<DatabaseCostThresholds> | undefined;
}

export function evaluateDatabaseCostWarning(
  record: DatabaseCostRecord,
  thresholds: DatabaseCostThresholds = DEFAULT_DATABASE_COST_THRESHOLDS,
): boolean {
  if (record.rowsRead >= thresholds.rowsReadWarningThreshold) {
    return true;
  }
  if (record.rowsWritten >= thresholds.rowsWrittenWarningThreshold) {
    return true;
  }
  if (
    record.rowsRead >= 50 &&
    record.rowsReturned !== undefined &&
    record.rowsRead / Math.max(record.rowsReturned, 1) >= thresholds.scanRatioWarningThreshold
  ) {
    return true;
  }
  return false;
}

export function recordDatabaseCost(
  record: DatabaseCostRecord,
  options: RecordDatabaseCostOptions = {},
): boolean {
  const thresholds: DatabaseCostThresholds = {
    ...DEFAULT_DATABASE_COST_THRESHOLDS,
    ...options.thresholds,
  };
  const isWarning = evaluateDatabaseCostWarning(record, thresholds);
  const shouldLog = isWarning || options.debugAlwaysLog === true;

  if (shouldLog) {
    const payload = {
      environment: record.environment,
      event: "db_cost",
      operation: record.operation,
      requestId: record.requestId,
      rowsRead: record.rowsRead,
      ...(record.rowsReturned !== undefined ? { rowsReturned: record.rowsReturned } : {}),
      rowsWritten: record.rowsWritten,
      store: record.store,
      warning: isWarning,
    };
    if (isWarning) {
      console.warn(JSON.stringify(payload));
    } else {
      console.info(JSON.stringify(payload));
    }
  }

  return isWarning;
}
