export interface RosterCsvProfile {
  readonly displayName: string;
  readonly email: string;
  readonly globalStatus: "Active" | "Idle" | "Inactive";
  readonly isSectionLeader: boolean;
  readonly phone: string;
  readonly voicePart: string;
}

const header = "Name,Email,Phone,Voice Part,Status";

function csvField(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
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
