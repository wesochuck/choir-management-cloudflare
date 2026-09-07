import { emailAddressSchema } from "@choir/contracts";

import {
  hasAcceptableContactIdentity,
  mergeContactCommunicationStatus,
  normalizeEmail,
  normalizePhone,
} from "./contacts";

/**
 * Phase 5 CSV contact-import engine (pure domain logic, no infrastructure).
 *
 * The staged flow is upload → analyze → map → preview → confirm → async
 * process. This module owns every decision that must stay identical between
 * the browser wizard affordances, the Worker preview path, and the async
 * execution path: safe CSV parsing, upload limits, header synonyms, mapping
 * validation, row validation, conservative merge policy, preview
 * classification, and the safe error-CSV export pattern.
 *
 * Tenancy: all inputs are already organization-scoped by the caller. Keys and
 * identifiers are never constructed here, so cross-tenant substitution cannot
 * originate in this module.
 */

export const CONTACT_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const CONTACT_IMPORT_ROWS_MAX = 10_000;
export const CONTACT_IMPORT_MAX_HEADERS = 64;
export const CONTACT_IMPORT_MAX_CELL_LENGTH = 2_000;
/** Bounded rows mutated by one async execution batch (never a full-file loop). */
export const CONTACT_IMPORT_BATCH_SIZE = 200;
/** Maximum lists one import may target. */
export const CONTACT_IMPORT_MAX_LISTS = 50;

export const CONTACT_IMPORT_TARGETS = [
  "firstName",
  "lastName",
  "displayName",
  "email",
  "phone",
  "emailStatus",
  "smsStatus",
  "consentSource",
  "source",
  "ignore",
] as const;

export type ContactImportTarget = (typeof CONTACT_IMPORT_TARGETS)[number];

export type ContactImportErrorCode =
  | "empty_file"
  | "missing_header"
  | "duplicate_header"
  | "too_many_headers"
  | "too_large"
  | "too_many_rows"
  | "invalid_utf8"
  | "unterminated_quote"
  | "invalid_mapping";

export class ContactImportError extends Error {
  readonly code: ContactImportErrorCode;
  readonly row: number | null;

  constructor(code: ContactImportErrorCode, message: string, row: number | null = null) {
    super(message);
    this.name = "ContactImportError";
    this.code = code;
    this.row = row;
  }
}

export interface ContactImportParsedRow {
  readonly cells: readonly string[];
  readonly rowNumber: number;
}

export interface ContactImportParsedCsv {
  /** Structured data rows including 1-based CSV line numbers. */
  readonly dataRows: readonly ContactImportParsedRow[];
  readonly headers: readonly string[];
  /** Data rows aligned positionally with `headers` (short rows padded). */
  readonly rows: readonly (readonly string[])[];
  /** 1-based row numbers (header is row 1) for rows rejected during parsing. */
  readonly malformedRows: readonly {
    readonly cells: readonly string[];
    readonly error: string;
    readonly rowNumber: number;
  }[];
}

export interface ContactImportRecord {
  readonly consentSource: string;
  readonly displayName: string;
  readonly email: string;
  readonly emailStatus: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly phone: string;
  readonly smsStatus: string;
  readonly source: string;
}

export interface ContactImportValidatedRow {
  readonly errors: readonly string[];
  readonly normalizedEmail: string | null;
  readonly normalizedPhone: string | null;
  readonly record: ContactImportRecord;
  readonly rowNumber: number;
}

export type ContactImportRowOutcome = "new" | "existing" | "in_file_duplicate" | "invalid";

export interface ContactImportRowClassification {
  readonly errors: readonly string[];
  readonly normalizedEmail: string | null;
  readonly normalizedPhone: string | null;
  readonly outcome: ContactImportRowOutcome;
  readonly rowNumber: number;
  /** True when an existing unsubscribe/suppression survived an imported subscribe. */
  readonly suppressionPreserved: boolean;
}

export interface ContactImportPreview {
  /** Rows matched to an existing contact by normalized email. */
  readonly existingMatches: number;
  /** Rows rejected by validation (including malformed rows). */
  readonly invalidRows: number;
  /** Rows skipped as later duplicates of an earlier row in the same file. */
  readonly inFileDuplicates: number;
  /** Rows that would create a new contact. */
  readonly newContacts: number;
  readonly rowsRead: number;
  /** Existing unsubscribes/suppressions that the import must not override. */
  readonly suppressedPreserved: number;
}

export interface ContactImportResult extends ContactImportPreview {
  readonly contactsCreated: number;
  readonly contactsUpdated: number;
  readonly membershipsAdded: number;
  readonly rowsInvalid: number;
  readonly rowsSkipped: number;
}

const dangerousFormulaPrefix = /^[=+\-@\t\r]/;
const loneSurrogatePattern =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function csvField(value: string): string {
  const safe = dangerousFormulaPrefix.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
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
  if (quoted) {
    throw new ContactImportError(
      "unterminated_quote",
      "The CSV contains an unterminated quoted field.",
    );
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function assertValidUtf8(csv: string): void {
  if (csv.includes("\0") || loneSurrogatePattern.test(csv)) {
    throw new ContactImportError("invalid_utf8", "The CSV is not valid UTF-8 text.");
  }
}

/**
 * Parses and validates an uploaded CSV, enforcing the V1 upload limits.
 * Per-row shape problems are collected as `malformedRows` so the analyze
 * step can report them; file-level problems throw `ContactImportError`.
 */
export function parseContactImportCsv(
  csv: string,
  maximumRows: number = CONTACT_IMPORT_ROWS_MAX,
): ContactImportParsedCsv {
  assertValidUtf8(csv);
  if (new TextEncoder().encode(csv).byteLength > CONTACT_IMPORT_MAX_BYTES) {
    throw new ContactImportError(
      "too_large",
      `Contact CSV files may not exceed ${String(CONTACT_IMPORT_MAX_BYTES / (1024 * 1024))} MB.`,
    );
  }
  const withoutBom = csv.replace(/^\uFEFF/, "");
  const rawLines = withoutBom.split(/\r?\n/);
  const firstContentIndex = rawLines.findIndex((line) => line.trim() !== "");
  if (firstContentIndex < 0) {
    throw new ContactImportError("empty_file", "The CSV is empty.");
  }
  const firstLineCells = parseRows(`${rawLines[firstContentIndex] ?? ""}\n`)[0] ?? [];
  if (firstLineCells.length === 0 || firstLineCells.every((cell) => cell.trim().length === 0)) {
    throw new ContactImportError("missing_header", "The CSV requires a header row.");
  }
  const rows = parseRows(withoutBom);
  const [headerRow, ...remaining] = rows;
  if (!headerRow || headerRow.every((cell) => cell.trim().length === 0)) {
    throw new ContactImportError("empty_file", "The CSV is empty.");
  }
  const headers = headerRow.map((cell) => cell.trim());
  if (headers.length > CONTACT_IMPORT_MAX_HEADERS) {
    throw new ContactImportError(
      "too_many_headers",
      `Contact CSV files may contain at most ${String(CONTACT_IMPORT_MAX_HEADERS)} columns.`,
    );
  }
  if (headers.some((header) => header.length === 0)) {
    throw new ContactImportError("missing_header", "Every CSV column requires a header name.");
  }
  const seen = new Set<string>();
  for (const header of headers) {
    const key = header.toLowerCase();
    if (seen.has(key)) {
      throw new ContactImportError(
        "duplicate_header",
        `The CSV contains a duplicate header: "${header}".`,
      );
    }
    seen.add(key);
  }
  if (remaining.length > maximumRows) {
    throw new ContactImportError(
      "too_many_rows",
      `Contact CSV files may contain at most ${String(maximumRows)} rows.`,
    );
  }
  const dataRows: ContactImportParsedRow[] = [];
  const rawRows: string[][] = [];
  const malformedRows: { cells: readonly string[]; error: string; rowNumber: number }[] = [];
  remaining.forEach((row, index) => {
    const rowNumber = index + 2;
    if (row.length > headers.length) {
      malformedRows.push({
        cells: [...row],
        error: `Row has ${String(row.length)} values but the header has ${String(headers.length)} columns.`,
        rowNumber,
      });
      return;
    }
    const padded = [...row];
    while (padded.length < headers.length) padded.push("");
    const oversized = padded.findIndex((cell) => cell.length > CONTACT_IMPORT_MAX_CELL_LENGTH);
    if (oversized >= 0) {
      const columnLabel = headers[oversized] ?? `Column ${String(oversized + 1)}`;
      malformedRows.push({
        cells: [...row],
        error: `Column "${columnLabel}" exceeds the maximum field length.`,
        rowNumber,
      });
      return;
    }
    dataRows.push({ cells: padded, rowNumber });
    rawRows.push(padded);
  });
  return { dataRows, headers, malformedRows, rows: rawRows };
}

const HEADER_SYNONYMS: readonly {
  readonly target: ContactImportTarget;
  readonly names: readonly string[];
}[] = [
  { names: ["first name", "firstname", "fname", "given name"], target: "firstName" },
  { names: ["last name", "lastname", "lname", "family name", "surname"], target: "lastName" },
  {
    names: ["display name", "displayname", "name", "full name", "contact name"],
    target: "displayName",
  },
  { names: ["email", "e-mail", "email address"], target: "email" },
  { names: ["phone", "phone number", "cell", "mobile", "telephone"], target: "phone" },
  {
    names: ["email marketing status", "email status", "email consent", "email subscription"],
    target: "emailStatus",
  },
  {
    names: ["sms marketing status", "sms status", "sms consent", "sms subscription"],
    target: "smsStatus",
  },
  {
    names: ["consent source", "consent status source", "status source", "opt-in source"],
    target: "consentSource",
  },
  { names: ["source", "origin", "list source", "imported from"], target: "source" },
];

function synonymTarget(header: string): ContactImportTarget | null {
  const normalized = header.trim().toLowerCase();
  for (const entry of HEADER_SYNONYMS) {
    if (entry.names.includes(normalized)) return entry.target;
  }
  return null;
}

/**
 * Suggests one target per header. Exact-synonym matches win; an already
 * claimed target falls back to `ignore` so suggestions never propose an
 * invalid duplicate mapping.
 */
export function suggestContactImportMapping(headers: readonly string[]): ContactImportTarget[] {
  const claimed = new Set<ContactImportTarget>();
  return headers.map((header) => {
    const candidate = synonymTarget(header);
    if (candidate && !claimed.has(candidate)) {
      claimed.add(candidate);
      return candidate;
    }
    return "ignore";
  });
}

/** Validates a positional per-header mapping (`targets[i]` maps `headers[i]`). */
export function validateContactImportMapping(
  headers: readonly string[],
  targets: readonly string[],
): ContactImportTarget[] {
  if (targets.length !== headers.length) {
    throw new ContactImportError(
      "invalid_mapping",
      "The column mapping must assign exactly one target per CSV column.",
    );
  }
  const parsed = targets.map((target) => {
    const found = CONTACT_IMPORT_TARGETS.find((candidate) => candidate === target);
    if (!found) {
      throw new ContactImportError("invalid_mapping", `Unknown mapping target: "${target}".`);
    }
    return found;
  });
  const claimed = new Set<ContactImportTarget>();
  for (const target of parsed) {
    if (target === "ignore") continue;
    if (claimed.has(target)) {
      throw new ContactImportError(
        "invalid_mapping",
        `Multiple columns are mapped to "${target}". Each contact field accepts at most one column.`,
      );
    }
    claimed.add(target);
  }
  return parsed;
}

function cellFor(
  cells: readonly string[],
  headers: readonly string[],
  targets: readonly ContactImportTarget[],
  target: ContactImportTarget,
): string {
  const index = targets.indexOf(target);
  if (index < 0 || index >= cells.length || index >= headers.length) return "";
  return cells[index]?.trim() ?? "";
}

/** Applies a validated mapping to one parsed row (blank stays blank). */
export function applyContactImportMapping(
  cells: readonly string[],
  headers: readonly string[],
  targets: readonly ContactImportTarget[],
): ContactImportRecord {
  return {
    consentSource: cellFor(cells, headers, targets, "consentSource"),
    displayName: cellFor(cells, headers, targets, "displayName"),
    email: cellFor(cells, headers, targets, "email"),
    emailStatus: cellFor(cells, headers, targets, "emailStatus"),
    firstName: cellFor(cells, headers, targets, "firstName"),
    lastName: cellFor(cells, headers, targets, "lastName"),
    phone: cellFor(cells, headers, targets, "phone"),
    smsStatus: cellFor(cells, headers, targets, "smsStatus"),
    source: cellFor(cells, headers, targets, "source"),
  };
}

/**
 * Parses an imported channel status. Blank means "no information" (unknown);
 * anything outside the known vocabulary is unrecognized (null) so the row
 * can be reported instead of silently coerced.
 */
export function parseContactImportStatus(
  value: string | null | undefined,
): "subscribed" | "unknown" | "unsubscribed" | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized === "" || normalized === "unknown") return "unknown";
  if (normalized === "subscribed") return "subscribed";
  if (normalized === "unsubscribed") return "unsubscribed";
  return null;
}

function checkLength(value: string, max: number, label: string, errors: string[]): void {
  if (value.length > max) errors.push(`${label} exceeds ${String(max)} characters.`);
}

/** Validates one mapped record without touching storage. */
export function validateContactImportRecord(
  record: ContactImportRecord,
  rowNumber: number,
): ContactImportValidatedRow {
  const errors: string[] = [];
  checkLength(record.firstName, 200, "First name", errors);
  checkLength(record.lastName, 200, "Last name", errors);
  checkLength(record.displayName, 200, "Display name", errors);
  checkLength(record.source, 200, "Source", errors);
  checkLength(record.consentSource, 200, "Consent source", errors);
  if (record.email.length > 320) {
    errors.push("Email exceeds 320 characters.");
  } else if (
    record.email.trim().length > 0 &&
    !emailAddressSchema.safeParse(record.email.trim()).success
  ) {
    errors.push(`Email "${record.email.trim()}" is not valid.`);
  }
  if (record.phone.length > 50) errors.push("Phone exceeds 50 characters.");
  if (parseContactImportStatus(record.emailStatus) === null) {
    errors.push(`Email status "${record.emailStatus}" is not recognized.`);
  }
  if (parseContactImportStatus(record.smsStatus) === null) {
    errors.push(`SMS status "${record.smsStatus}" is not recognized.`);
  }
  const normalizedEmail = normalizeEmail(record.email.trim());
  const normalizedPhone = normalizePhone(record.phone);
  if (
    errors.length === 0 &&
    !hasAcceptableContactIdentity({
      displayName: record.displayName,
      email: record.email,
      firstName: record.firstName,
      lastName: record.lastName,
      phone: record.phone,
    })
  ) {
    errors.push("Row has no usable name, email, or phone.");
  }
  return {
    errors,
    normalizedEmail: normalizedEmail && normalizedEmail.length > 0 ? normalizedEmail : null,
    normalizedPhone,
    record,
    rowNumber,
  };
}

/**
 * Dedupe key for in-file duplicate detection. Primary key is the normalized
 * email; the optional secondary key is the normalized phone. Name-only rows
 * never dedupe (each returns null and is treated as unique).
 */
export function contactImportDedupeKey(
  normalizedEmail: string | null,
  normalizedPhone: string | null,
): string | null {
  if (normalizedEmail) return `email:${normalizedEmail}`;
  if (normalizedPhone) return `phone:${normalizedPhone}`;
  return null;
}

export interface ContactImportPreviewContext {
  /** Existing contacts by normalized email with their current channel statuses. */
  readonly existingByEmail: ReadonlyMap<
    string,
    { readonly emailStatus: string; readonly smsStatus: string }
  >;
  readonly headers: readonly string[];
  readonly malformedRows: readonly {
    readonly cells: readonly string[];
    readonly error: string;
    readonly rowNumber: number;
  }[];
  readonly rows: readonly (readonly string[])[];
  readonly targets: readonly ContactImportTarget[];
}

/**
 * Classifies every staged row without mutating storage. Precomputes one
 * `Map`/`Set` for existing contacts and one `Set` for in-file keys so
 * classification stays O(N) and never scans inside a loop.
 */
export function previewContactImport(context: ContactImportPreviewContext): {
  readonly classifications: readonly ContactImportRowClassification[];
  readonly preview: ContactImportPreview;
} {
  const classifications: ContactImportRowClassification[] = [];
  const seenInFile = new Set<string>();
  let existingMatches = 0;
  let invalidRows = context.malformedRows.length;
  let inFileDuplicates = 0;
  let newContacts = 0;
  let suppressedPreserved = 0;

  for (const malformed of context.malformedRows) {
    classifications.push({
      errors: [malformed.error],
      normalizedEmail: null,
      normalizedPhone: null,
      outcome: "invalid",
      rowNumber: malformed.rowNumber,
      suppressionPreserved: false,
    });
  }

  context.rows.forEach((cells, index) => {
    const rowNumber = index + 2;
    const record = applyContactImportMapping(cells, context.headers, context.targets);
    const validated = validateContactImportRecord(record, rowNumber);
    if (validated.errors.length > 0) {
      invalidRows += 1;
      classifications.push({ ...validated, outcome: "invalid", suppressionPreserved: false });
      return;
    }
    const key = contactImportDedupeKey(validated.normalizedEmail, validated.normalizedPhone);
    if (key !== null && seenInFile.has(key)) {
      inFileDuplicates += 1;
      classifications.push({
        ...validated,
        outcome: "in_file_duplicate",
        suppressionPreserved: false,
      });
      return;
    }
    if (key !== null) seenInFile.add(key);
    const existing =
      validated.normalizedEmail !== null
        ? context.existingByEmail.get(validated.normalizedEmail)
        : undefined;
    if (existing) {
      existingMatches += 1;
      // Suppression visibility: an imported subscribe that must lose to an
      // existing unsubscribe/suppression is reported, never applied.
      const importedEmail = parseContactImportStatus(record.emailStatus) ?? "unknown";
      const preserved =
        (existing.emailStatus === "unsubscribed" || existing.emailStatus === "suppressed") &&
        importedEmail === "subscribed";
      if (preserved) suppressedPreserved += 1;
      classifications.push({
        ...validated,
        outcome: "existing",
        suppressionPreserved: preserved,
      });
      return;
    }
    newContacts += 1;
    classifications.push({ ...validated, outcome: "new", suppressionPreserved: false });
  });

  classifications.sort((left, right) => left.rowNumber - right.rowNumber);
  return {
    classifications,
    preview: {
      existingMatches,
      inFileDuplicates,
      invalidRows,
      newContacts,
      rowsRead: context.rows.length + context.malformedRows.length,
      suppressedPreserved,
    },
  };
}

/**
 * Conservative merge for one imported row over an existing contact.
 * Blank imported values never erase; unknown never downgrades; an existing
 * unsubscribe/suppression always survives an imported subscribe (Phase 1
 * helper); an imported unsubscribe may unsubscribe.
 */
export function mergeContactImportIntoExisting(params: {
  readonly existingEmailStatus: string;
  readonly existingSmsStatus: string;
  readonly imported: ContactImportRecord;
}): { readonly emailStatus: string; readonly smsStatus: string } {
  const importedEmail = parseContactImportStatus(params.imported.emailStatus) ?? "unknown";
  const importedSms = parseContactImportStatus(params.imported.smsStatus) ?? "unknown";
  return {
    emailStatus: mergeContactCommunicationStatus(params.existingEmailStatus, importedEmail),
    smsStatus: mergeContactCommunicationStatus(params.existingSmsStatus, importedSms),
  };
}

/** True when the imported scalar should overwrite the stored value. */
export function shouldOverwriteWithImportValue(imported: string): boolean {
  return imported.trim().length > 0;
}

export interface ContactImportErrorRow {
  readonly cells: readonly string[];
  readonly error: string;
  readonly rowNumber: number;
}

/**
 * Renders a downloadable error CSV reusing the repository's safe export
 * pattern (every field quoted, formula prefixes neutralized with `'`).
 */
export function renderContactImportErrorCsv(
  headers: readonly string[],
  errors: readonly ContactImportErrorRow[],
): string {
  const header = ["Row", "Error", ...headers].map(csvField).join(",");
  const lines = errors.map((entry) =>
    [String(entry.rowNumber), entry.error, ...entry.cells].map(csvField).join(","),
  );
  return [header, ...lines].join("\n");
}

/**
 * Deterministic retry delay shared with the queue consumer's backoff shape
 * (exponential growth capped at 300s plus deterministic jitter). Pure so
 * tests can assert schedules without real timers.
 */
export function contactImportRetryDelaySeconds(attempt: number): number {
  const bounded = Math.min(Math.max(Math.floor(attempt), 1), 10);
  return Math.min(300, 2 ** bounded) + ((bounded * 17) % 11);
}
