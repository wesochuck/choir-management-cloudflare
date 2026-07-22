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

function valueAt(row: readonly string[], index: number): string {
  return index < 0 ? "" : (row[index]?.trim() ?? "");
}

function parseStatus(value: string, row: number): RosterCsvImportProfile["globalStatus"] {
  const normalized = value.toLocaleLowerCase().replaceAll(/[^a-z]/g, "");
  if (!normalized || normalized === "active" || normalized === "current") return "Active";
  if (["idle", "onbreak", "future"].includes(normalized)) return "Idle";
  if (normalized === "inactive") return "Inactive";
  throw new RosterCsvError(`Status "${value}" is not recognized.`, row);
}

function profileKey(name: string, email: string): string {
  return `${name.toLocaleLowerCase()}\0${email.toLocaleLowerCase()}`;
}

export function parseRosterCsv(csv: string, maximumRows = 500): RosterCsvImportProfile[] {
  const rows = parseRows(csv.replace(/^\uFEFF/, ""));
  const [headerRow, ...remaining] = rows;
  if (!headerRow) throw new RosterCsvError("The CSV is empty.");
  const headers = headerRow.map((value) => value.toLocaleLowerCase());
  const nameIndex = headerIndex(headers, ["name", "singer", "singer name", "full name"]);
  if (nameIndex < 0) throw new RosterCsvError("The CSV requires a Name column.");
  const emailIndex = headerIndex(headers, ["email", "e-mail", "email address"]);
  const phoneIndex = headerIndex(headers, ["phone", "cell", "mobile", "telephone"]);
  const voicePartIndex = headerIndex(headers, ["voice part", "voice", "part", "section"]);
  const statusIndex = headerIndex(headers, ["status", "global status"]);
  const notesIndex = headerIndex(headers, ["notes", "note", "comments"]);
  const leaderIndex = headerIndex(headers, ["section leader", "is section leader"]);
  const sectionLeaderMarker = remaining.findIndex(
    (row) => row.length === 1 && row[0]?.toLocaleLowerCase() === "section leaders",
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
    if (email && !/^\S+@\S+\.\S+$/.test(email)) {
      throw new RosterCsvError(`Email "${email}" is not valid.`, rowNumber);
    }
    const explicitLeader = valueAt(row, leaderIndex).toLocaleLowerCase();
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
