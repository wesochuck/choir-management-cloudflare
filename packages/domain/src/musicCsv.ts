export interface MusicCsvPiece {
  readonly arranger: string;
  readonly catalogId: string;
  readonly composer: string;
  readonly copies: number | null;
  readonly durationSeconds: number | null;
  readonly genres: readonly string[];
  readonly notes: string;
  readonly purchaseDate: string | null;
  readonly sectionBuckets: readonly string[];
  readonly title: string;
}

export class MusicCsvError extends Error {
  readonly row: number | null;

  constructor(message: string, row: number | null = null) {
    super(message);
    this.name = "MusicCsvError";
    this.row = row;
  }
}

export const musicCsvHeader =
  "Title,Composer,Arranger,Copies,Catalog ID,Duration,Voicing,Applies To,Genres,Purchase Date,Notes";

const dangerousFormulaPrefix = /^[=+\-@\t\r]/;

function csvField(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  const safe = dangerousFormulaPrefix.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "";
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes)}:${String(remainder).padStart(2, "0")}`;
}

export function renderMusicCsv(pieces: readonly MusicCsvPiece[]): string {
  return [
    musicCsvHeader,
    ...pieces.map((piece) =>
      [
        piece.title,
        piece.composer,
        piece.arranger,
        piece.copies,
        piece.catalogId,
        formatDuration(piece.durationSeconds),
        "",
        piece.sectionBuckets.length === 0 ? "All" : piece.sectionBuckets.join(";"),
        piece.genres.join(";"),
        piece.purchaseDate,
        piece.notes,
      ]
        .map(csvField)
        .join(","),
    ),
  ].join("\n");
}

function consumeQuotedCharacter(
  csv: string,
  index: number,
): { readonly addition: string; readonly index: number; readonly quoted: boolean } {
  const character = csv[index] ?? "";
  if (character !== '"') return { addition: character, index, quoted: true };
  return csv[index + 1] === '"'
    ? { addition: '"', index: index + 1, quoted: true }
    : { addition: "", index, quoted: false };
}

function parseRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index] ?? "";
    if (quoted) {
      const consumed = consumeQuotedCharacter(csv, index);
      field += consumed.addition;
      index = consumed.index;
      quoted = consumed.quoted;
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field.trim());
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new MusicCsvError("The CSV contains an unterminated quoted field.");
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function headerIndex(headers: readonly string[], ...names: readonly string[]): number {
  return headers.findIndex((header) => names.includes(header));
}

interface MusicHeaderIndexes {
  readonly appliesTo: number;
  readonly arranger: number;
  readonly catalogId: number;
  readonly composer: number;
  readonly copies: number;
  readonly duration: number;
  readonly genres: number;
  readonly notes: number;
  readonly purchaseDate: number;
  readonly title: number;
}

function musicHeaderIndexes(headers: readonly string[]): MusicHeaderIndexes {
  return {
    appliesTo: headerIndex(headers, "applies to", "sections"),
    arranger: headerIndex(headers, "arranger"),
    catalogId: headerIndex(headers, "catalog id", "catalog", "id"),
    composer: headerIndex(headers, "composer"),
    copies: headerIndex(headers, "copies", "copy count"),
    duration: headerIndex(headers, "duration", "length", "time"),
    genres: headerIndex(headers, "genres", "genre"),
    notes: headerIndex(headers, "notes", "note"),
    purchaseDate: headerIndex(headers, "purchase date"),
    title: headerIndex(headers, "title"),
  };
}

function cell(cells: readonly string[], index: number): string {
  return index < 0 ? "" : (cells[index]?.trim() ?? "");
}

function parseDuration(value: string, row: number): number | null {
  if (!value) return null;
  const parts = value.split(":");
  if (parts.length !== 2 && parts.length !== 3) {
    throw new MusicCsvError("Duration must use minutes:seconds or hours:minutes:seconds.", row);
  }
  const values = parts.map(Number);
  if (values.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new MusicCsvError("Duration must contain whole non-negative numbers.", row);
  }
  const hours = values.length === 3 ? (values[0] ?? 0) : 0;
  const minutes = values.length === 3 ? values[1] : values[0];
  const seconds = values.length === 3 ? values[2] : values[1];
  if (minutes === undefined || seconds === undefined || minutes > 59 || seconds > 59) {
    throw new MusicCsvError("Duration minutes and seconds must be below 60.", row);
  }
  const total = hours * 3_600 + minutes * 60 + seconds;
  if (total > 86_400) throw new MusicCsvError("Duration cannot exceed 24 hours.", row);
  return total;
}

function labels(value: string): string[] {
  return [
    ...new Set(
      value
        .split(";")
        .map((label) => label.trim())
        .filter(Boolean),
    ),
  ];
}

function parseCopies(value: string, rowNumber: number): number | null {
  if (value === "") return null;
  const copies = Number(value);
  if (!Number.isInteger(copies) || copies < 0 || copies > 1_000_000) {
    throw new MusicCsvError("Copies must be a whole number from 0 through 1,000,000.", rowNumber);
  }
  return copies;
}

function parseApplicability(value: string): string[] {
  return !value || value.toLocaleLowerCase() === "all" ? [] : labels(value);
}

function parsePiece(
  cells: readonly string[],
  indexes: MusicHeaderIndexes,
  rowNumber: number,
): MusicCsvPiece | null {
  const title = cell(cells, indexes.title);
  if (!title) return null;
  const purchaseDate = cell(cells, indexes.purchaseDate);
  return {
    arranger: cell(cells, indexes.arranger),
    catalogId: cell(cells, indexes.catalogId),
    composer: cell(cells, indexes.composer),
    copies: parseCopies(cell(cells, indexes.copies), rowNumber),
    durationSeconds: parseDuration(cell(cells, indexes.duration), rowNumber),
    genres: labels(cell(cells, indexes.genres)),
    notes: cell(cells, indexes.notes),
    purchaseDate: purchaseDate === "" ? null : purchaseDate,
    sectionBuckets: parseApplicability(cell(cells, indexes.appliesTo)),
    title,
  };
}

export function parseMusicCsv(csv: string, maximumRows = 500): MusicCsvPiece[] {
  const rows = parseRows(csv.replace(/^\uFEFF/, ""));
  const [headerRow, ...dataRows] = rows;
  if (!headerRow) throw new MusicCsvError("The CSV is empty.");
  const headers = headerRow.map((header) => header.trim().toLocaleLowerCase());
  const indexes = musicHeaderIndexes(headers);
  if (indexes.title < 0) throw new MusicCsvError('CSV must contain a "Title" column.');
  const imported: MusicCsvPiece[] = [];
  for (const [index, cells] of dataRows.entries()) {
    const rowNumber = index + 2;
    const piece = parsePiece(cells, indexes, rowNumber);
    if (!piece) continue;
    if (imported.length >= maximumRows) {
      throw new MusicCsvError(`The CSV may contain at most ${String(maximumRows)} music pieces.`);
    }
    imported.push(piece);
  }
  return imported;
}
