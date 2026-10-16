interface AssignmentConfiguration {
  readonly rosterStructure?: "sections_only" | "sections_with_parts" | undefined;
  readonly voiceParts: readonly { readonly label: string; readonly sectionCode: string }[];
}

/** Convert every old label at once: labels can overlap destination section codes. */
export function rosterAssignmentConversion(
  previous: AssignmentConfiguration,
  next: AssignmentConfiguration,
): ReadonlyMap<string, string> {
  if (previous.rosterStructure === "sections_only" || next.rosterStructure !== "sections_only") {
    return new Map();
  }
  return new Map(previous.voiceParts.map(({ label, sectionCode }) => [label, sectionCode]));
}
