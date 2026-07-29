export interface RosterConfig {
  maxMembers: number;
  sections: string[];
}

export function isValidRoster(config: RosterConfig): boolean {
  return config.maxMembers > 0 && config.sections.length > 0;
}

export const defaultRosterConfiguration = {
  sections: [
    { code: "S", color: "#1b4d3e", name: "Sopranos", trackOnly: false },
    { code: "A", color: "#4a7c59", name: "Altos", trackOnly: false },
    { code: "T", color: "#92400e", name: "Tenors", trackOnly: false },
    { code: "B", color: "#075985", name: "Basses", trackOnly: false },
  ],
  voiceParts: [
    { fullName: "Soprano 1", label: "S1", sectionCode: "S" },
    { fullName: "Soprano 2", label: "S2", sectionCode: "S" },
    { fullName: "Alto 1", label: "A1", sectionCode: "A" },
    { fullName: "Alto 2", label: "A2", sectionCode: "A" },
    { fullName: "Tenor 1", label: "T1", sectionCode: "T" },
    { fullName: "Tenor 2", label: "T2", sectionCode: "T" },
    { fullName: "Bass 1", label: "B1", sectionCode: "B" },
    { fullName: "Bass 2", label: "B2", sectionCode: "B" },
  ],
} as const;
