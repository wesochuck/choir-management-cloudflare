/**
 * Shared low-level CSV row tokenizer (pure domain logic, no infrastructure).
 *
 * This module owns the single state machine previously triplicated across
 * `contactImport.ts`, `rosterCsv.ts`, and `musicCsv.ts`: quoted-field
 * handling, escaped-quote handling (`""` inside a quoted field), CRLF
 * handling, per-field `trim()`, and `row.some(Boolean)` empty-row filtering.
 *
 * Tenancy: all inputs are already organization-scoped by the caller. No keys,
 * identifiers, storage, provider I/O, or timers live here, so cross-tenant
 * substitution cannot originate in this module.
 *
 * Callers keep their own typed error wrappers: this module throws the neutral
 * `CsvRowsError` (`unterminated_quote`) and each domain module maps it to its
 * existing error type (`ContactImportError`, `RosterCsvError`, `MusicCsvError`)
 * so public error contracts are unchanged.
 */

export const CSV_UNTERMINATED_QUOTE_MESSAGE = "The CSV contains an unterminated quoted field.";

export class CsvRowsError extends Error {
  readonly code = "unterminated_quote" as const;

  constructor(message: string = CSV_UNTERMINATED_QUOTE_MESSAGE) {
    super(message);
    this.name = "CsvRowsError";
  }
}

const dangerousFormulaPrefix = /^[=+\-@\t\r]/;

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

/**
 * Tokenizes one CSV document into trimmed string rows. Empty rows (no truthy
 * cell after trimming) are skipped, matching the historic per-importer
 * behavior. Throws `CsvRowsError` when a quoted field is never closed.
 * Single linear pass over the input (O(N) time, O(output) memory).
 */
export function parseCsvRows(csv: string): string[][] {
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
  if (quoted) {
    throw new CsvRowsError();
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

/**
 * Quotes one CSV field for export, neutralizing spreadsheet formula prefixes
 * (`= + - @ TAB CR`) with a leading `'` so exports stay consistent across
 * every import path. Accepts `string | number | null` to cover all existing
 * render call sites (`null` renders as an empty field).
 */
export function escapeCsvField(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  const safe = dangerousFormulaPrefix.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
