export interface RepertoireReportPiece {
  readonly arranger: string;
  readonly catalogId: string;
  readonly composer: string;
  readonly lastPerformed: string | null;
  readonly title: string;
  readonly totalPerformances: number;
}

export interface RepertoireReportInput {
  readonly pieces: readonly RepertoireReportPiece[];
}

const dangerousFormulaPrefix = /^[=+\-@\t\r]/;

function csvField(value: string | number): string {
  const text = String(value);
  const safe = dangerousFormulaPrefix.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function sortPieces(pieces: readonly RepertoireReportPiece[]): readonly RepertoireReportPiece[] {
  return [...pieces].sort((left, right) => left.title.localeCompare(right.title));
}

export function repertoireReportFilename(): string {
  return "repertoire_history_report.csv";
}

function lastPerformedCell(value: string | null): string {
  if (value === null) return "Never";
  // Use YYYY-MM-DD to keep deterministic output (baseline used
  // toLocaleDateString which is host-locale-dependent; the rebuild
  // normalizes to a stable ISO date).
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toISOString().split("T")[0] ?? "Never";
}

export function renderRepertoireReportCsv(input: RepertoireReportInput): string {
  const header = [
    "Title",
    "Composer",
    "Arranger",
    "Catalog ID",
    "Total Performances",
    "Last Performed",
  ]
    .map(csvField)
    .join(",");

  if (input.pieces.length === 0) {
    return `${header}\r\n`;
  }

  const sorted = sortPieces(input.pieces);
  const lines = [header];
  for (const piece of sorted) {
    lines.push(
      [
        piece.title,
        piece.composer,
        piece.arranger,
        piece.catalogId,
        piece.totalPerformances,
        lastPerformedCell(piece.lastPerformed),
      ]
        .map(csvField)
        .join(","),
    );
  }

  return `${lines.join("\r\n")}\r\n`;
}
