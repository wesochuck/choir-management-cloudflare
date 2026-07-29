export interface CsvColumnMapping {
  readonly sourceIndex: number;
  readonly targetHeader: string | null;
}

function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
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
      if (row.length === 1 && row[0]?.trim().toLocaleLowerCase() === "section leaders") {
        return [csvField(row[0])].join(",");
      }
      if (rowIndex === 0) {
        return kept.map(({ targetHeader }) => csvField(targetHeader ?? "")).join(",");
      }
      return kept.map(({ sourceIndex }) => csvField(row[sourceIndex] ?? "")).join(",");
    })
    .join("\n");
}
