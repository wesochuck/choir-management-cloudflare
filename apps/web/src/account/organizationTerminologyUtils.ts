const DEFAULT_PERFORMER_LABEL = "Performer";

function normalizePerformerLabel(label: string): string {
  const trimmed = label.trim();
  return trimmed || DEFAULT_PERFORMER_LABEL;
}

function pluralizePerformerLabel(label: string): string {
  return `${label}s`;
}

export function normalizeOrganizationTerminology(
  performerLabel: string,
  rosterStructure?: "sections_only" | "sections_with_parts",
) {
  const label = normalizePerformerLabel(performerLabel);
  return {
    performerLabel: label,
    performerLabelPlural: pluralizePerformerLabel(label),
    partLabel: rosterStructure === "sections_only" ? "Section" : "Part",
    partLabelPlural: rosterStructure === "sections_only" ? "Sections" : "Parts",
  };
}
