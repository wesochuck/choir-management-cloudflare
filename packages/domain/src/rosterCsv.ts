import { emailAddressSchema } from "@choir/contracts";
import { mapCsvColumns, type CsvColumnMapping } from "./csvMapping";

export interface RosterCsvProfile {
  readonly displayName: string;
  readonly email: string;
  readonly globalStatus: "Active" | "Idle" | "Inactive";
  readonly isSectionLeader: boolean;
  readonly phone: string;
  readonly voicePart: string;
}

export interface RosterCsvImportProfile {
  readonly displayName: string;
  readonly email: string;
  readonly globalStatus: "Active" | "Idle" | "Inactive";
  readonly isSectionLeader: boolean;
  readonly notes: string;
  readonly phone: string;
  readonly voicePart: string;
}

export class RosterCsvError extends Error {
  constructor(
    message: string,
    readonly row: number | null = null,
  ) {
    super(message);
    this.name = "RosterCsvError";
  }
}

const header = "Name,Email,Phone,Voice Part,Status";
export const rosterCsvColumnOptions = [
  "Name",
  "Email",
  "Phone",
  "Voice Part",
  "Status",
  "Notes",
  "Section Leader",
] as const;
const dangerousFormulaPrefix = /^[=+\-@\t\r]/;

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
  if (quoted) throw new RosterCsvError("The CSV contains an unterminated quoted field.");
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function headerIndex(headers: readonly string[], names: readonly string[]): number {
  return headers.findIndex((candidate) => names.includes(candidate));
}

export function rosterCsvColumnForHeader(headerValue: string): string | null {
  const normalized = headerValue.trim().toLowerCase();
  if (["name", "singer", "singer name", "full name"].includes(normalized)) return "Name";
  if (["email", "e-mail", "email address"].includes(normalized)) return "Email";
  if (["phone", "cell", "mobile", "telephone"].includes(normalized)) return "Phone";
  if (["voice part", "voice", "part", "section"].includes(normalized)) return "Voice Part";
  if (["status", "global status"].includes(normalized)) return "Status";
  if (["notes", "note", "comments"].includes(normalized)) return "Notes";
  if (["section leader", "is section leader"].includes(normalized)) return "Section Leader";
  return null;
}

function valueAt(row: readonly string[], index: number): string {
  return index < 0 ? "" : (row[index]?.trim() ?? "");
}

function parseStatus(value: string, row: number): RosterCsvImportProfile["globalStatus"] {
  const normalized = value.toLowerCase().replaceAll(/[^a-z]/g, "");
  if (!normalized || normalized === "active" || normalized === "current") return "Active";
  if (["idle", "onbreak", "future"].includes(normalized)) return "Idle";
  if (normalized === "inactive") return "Inactive";
  throw new RosterCsvError(`Status "${value}" is not recognized.`, row);
}

function profileKey(name: string, email: string): string {
  return `${name.toLowerCase()}\0${email.toLowerCase()}`;
}

export function parseRosterCsv(csv: string, maximumRows = 500): RosterCsvImportProfile[] {
  const rows = parseRows(csv.replace(/^\uFEFF/, ""));
  const [headerRow, ...remaining] = rows;
  if (!headerRow) throw new RosterCsvError("The CSV is empty.");
  const headers = headerRow.map((value) => value.toLowerCase());
  const nameIndex = headerIndex(headers, ["name", "singer", "singer name", "full name"]);
  if (nameIndex < 0) throw new RosterCsvError("The CSV requires a Name column.");
  const emailIndex = headerIndex(headers, ["email", "e-mail", "email address"]);
  const phoneIndex = headerIndex(headers, ["phone", "cell", "mobile", "telephone"]);
  const voicePartIndex = headerIndex(headers, ["voice part", "voice", "part", "section"]);
  const statusIndex = headerIndex(headers, ["status", "global status"]);
  const notesIndex = headerIndex(headers, ["notes", "note", "comments"]);
  const leaderIndex = headerIndex(headers, ["section leader", "is section leader"]);
  const sectionLeaderMarker = remaining.findIndex(
    (row) => row.length === 1 && row[0]?.toLowerCase() === "section leaders",
  );
  const profileRows = sectionLeaderMarker < 0 ? remaining : remaining.slice(0, sectionLeaderMarker);
  const leaderRows = sectionLeaderMarker < 0 ? [] : remaining.slice(sectionLeaderMarker + 2);
  if (profileRows.length > maximumRows) {
    throw new RosterCsvError(
      `Roster CSV files may contain at most ${String(maximumRows)} Profiles.`,
    );
  }
  const leaders = new Set(
    leaderRows.map((row) => profileKey(valueAt(row, nameIndex), valueAt(row, emailIndex))),
  );
  return profileRows.map((row, index) => {
    const rowNumber = index + 2;
    const displayName = valueAt(row, nameIndex);
    const email = valueAt(row, emailIndex);
    if (!displayName)
      throw new RosterCsvError("Every imported Profile requires a name.", rowNumber);
    if (email && !emailAddressSchema.safeParse(email).success) {
      throw new RosterCsvError(`Email "${email}" is not valid.`, rowNumber);
    }
    const explicitLeader = valueAt(row, leaderIndex).toLowerCase();
    return {
      displayName,
      email,
      globalStatus: parseStatus(valueAt(row, statusIndex), rowNumber),
      isSectionLeader:
        ["1", "true", "yes", "y"].includes(explicitLeader) ||
        leaders.has(profileKey(displayName, email)),
      notes: valueAt(row, notesIndex),
      phone: valueAt(row, phoneIndex),
      voicePart: valueAt(row, voicePartIndex),
    };
  });
}

export interface RosterCsvColumnWarning {
  readonly header: string;
  readonly message: string;
}

export interface RosterCsvInspection {
  readonly fatalError: string | null;
  readonly headers: readonly string[];
  readonly rowCount: number;
  readonly warnings: readonly RosterCsvColumnWarning[];
}

export function inspectRosterCsv(csv: string): RosterCsvInspection {
  try {
    const rows = parseRows(csv.replace(/^\uFEFF/, ""));
    const [headerRow, ...remaining] = rows;
    if (!headerRow)
      return { fatalError: "The CSV is empty.", headers: [], rowCount: 0, warnings: [] };
    const headers = headerRow.map((value) => value.trim());
    const normalizedHeaders = headers.map((value) => value.toLowerCase());
    const nameIndex = headerIndex(normalizedHeaders, [
      "name",
      "singer",
      "singer name",
      "full name",
    ]);
    const sectionLeaderMarker = remaining.findIndex(
      (row) => row.length === 1 && row[0]?.toLowerCase() === "section leaders",
    );
    const profileRows =
      sectionLeaderMarker < 0 ? remaining : remaining.slice(0, sectionLeaderMarker);
    const warnings: RosterCsvColumnWarning[] = headers.flatMap((header) =>
      rosterCsvColumnForHeader(header)
        ? []
        : [
            {
              header: header || `Column ${String(headers.indexOf(header) + 1)}`,
              message:
                "This column is not part of the preferred roster format and will be ignored.",
            },
          ],
    );
    if (nameIndex < 0) {
      return {
        fatalError: "The CSV requires a Name column.",
        headers,
        rowCount: profileRows.length,
        warnings,
      };
    }
    try {
      parseRosterCsv(csv);
    } catch (error: unknown) {
      return {
        fatalError: error instanceof RosterCsvError ? error.message : "The CSV could not be read.",
        headers,
        rowCount: profileRows.length,
        warnings,
      };
    }
    return { fatalError: null, headers, rowCount: profileRows.length, warnings };
  } catch (error: unknown) {
    return {
      fatalError: error instanceof RosterCsvError ? error.message : "The CSV could not be read.",
      headers: [],
      rowCount: 0,
      warnings: [],
    };
  }
}

export function mapRosterCsvColumns(csv: string, mappings: readonly CsvColumnMapping[]): string {
  return mapCsvColumns(parseRows(csv.replace(/^\uFEFF/, "")), mappings);
}

function profileRow(profile: RosterCsvProfile): string {
  return [
    profile.displayName,
    profile.email,
    profile.phone,
    profile.voicePart,
    profile.globalStatus,
  ]
    .map(csvField)
    .join(",");
}

export function renderRosterCsv(profiles: readonly RosterCsvProfile[]): string {
  const rows = profiles.map(profileRow);
  const leaders = profiles.filter(({ isSectionLeader }) => isSectionLeader).map(profileRow);
  return leaders.length === 0
    ? [header, ...rows].join("\n")
    : [header, ...rows, "", "Section Leaders", header, ...leaders].join("\n");
}
