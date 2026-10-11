import { escapeCsvField } from "./csvRows";

export interface CsvColumnMapping {
  readonly sourceIndex: number;
  readonly targetHeader: string | null;
}

/**
 * Rewrites a parsed CSV's columns while retaining multiline and quoted values.
 * A null target omits that source column from the output.
 */
export function mapCsvColumns(
  rows: readonly (readonly string[])[],
  mappings: readonly CsvColumnMapping[],
): string {
  const kept = mappings.filter(({ targetHeader }) => targetHeader !== null);
  return rows
    .map((row, rowIndex) => {
      if (
        row[0]?.trim().toLowerCase() === "section leaders" &&
        (row.length === 1 || row.slice(1).every((cell) => cell.trim() === ""))
      ) {
        return kept.map((_, i) => (i === 0 ? escapeCsvField(row[0] ?? "") : "")).join(",");
      }
      if (rowIndex === 0) {
        return kept.map(({ targetHeader }) => escapeCsvField(targetHeader ?? "")).join(",");
      }
      return kept.map(({ sourceIndex }) => escapeCsvField(row[sourceIndex] ?? "")).join(",");
    })
    .join("\n");
}
