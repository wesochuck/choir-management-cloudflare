interface AssignmentConfiguration {
  readonly rosterStructure?: "sections_only" | "sections_with_parts" | undefined;
  readonly voiceParts: readonly { readonly label: string; readonly sectionCode: string }[];
}

export interface RosterSectionLike {
  readonly code: string;
  readonly trackOnly?: boolean | undefined;
}

export interface RosterVoicePartLike {
  readonly label: string;
  readonly sectionCode: string;
  readonly fullName?: string | undefined;
}

/**
 * Filter voice parts to only those whose parent section is not track-only.
 * Track-only sections/parts are for recording-track organization, not human roster assignments.
 */
export function getAssignableVoiceParts<T extends RosterVoicePartLike>(
  sections: readonly RosterSectionLike[],
  voiceParts: readonly T[],
): readonly T[] {
  const trackOnlySections = new Set(
    sections.filter(({ trackOnly }) => trackOnly).map(({ code }) => code),
  );
  return voiceParts.filter(({ sectionCode }) => !trackOnlySections.has(sectionCode));
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
