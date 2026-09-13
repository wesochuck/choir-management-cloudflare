export interface RosterBalanceSectionGroup<
  TSection extends { code: string; name: string } = { code: string; name: string },
  TVoicePart extends { label: string; sectionCode: string } = {
    label: string;
    sectionCode: string;
  },
> {
  readonly section: TSection;
  readonly parts: readonly TVoicePart[];
  readonly span: number;
}

export interface RosterBalanceLayout<
  TSection extends { code: string; name: string } = { code: string; name: string },
  TVoicePart extends { label: string; sectionCode: string } = {
    label: string;
    sectionCode: string;
  },
> {
  readonly sections: readonly RosterBalanceSectionGroup<TSection, TVoicePart>[];
  readonly orderedParts: readonly TVoicePart[];
  readonly columnCount: number;
  readonly valid: boolean;
}

/**
 * Builds the visual balance layout mapping sections to child voice parts.
 *
 * Each visible part occupies one grid column. Each section spans the exact
 * number of child part tracks it contains.
 *
 * Precomputes section lookup to avoid nested linear scans (O(N) complexity).
 * Section order and voice part order within each section are preserved.
 */
export function buildRosterBalanceLayout<
  TSection extends { code: string; name: string },
  TVoicePart extends { label: string; sectionCode: string },
>(
  sections: readonly TSection[],
  voiceParts: readonly TVoicePart[],
): RosterBalanceLayout<TSection, TVoicePart> {
  const partsBySection = new Map<string, TVoicePart[]>();
  for (const section of sections) {
    partsBySection.set(section.code, []);
  }

  const orphanParts: TVoicePart[] = [];
  for (const part of voiceParts) {
    const list = partsBySection.get(part.sectionCode);
    if (list) {
      list.push(part);
    } else {
      orphanParts.push(part);
    }
  }

  const sectionGroups: RosterBalanceSectionGroup<TSection, TVoicePart>[] = [];
  const orderedParts: TVoicePart[] = [];
  let hasEmptySection = false;

  for (const section of sections) {
    const assigned = partsBySection.get(section.code) ?? [];
    if (assigned.length === 0) {
      hasEmptySection = true;
    }
    orderedParts.push(...assigned);
    sectionGroups.push({
      parts: assigned,
      section,
      span: Math.max(1, assigned.length),
    });
  }

  if (orphanParts.length > 0) {
    // Preserve all reportable parts defensively without dropping them
    orderedParts.push(...orphanParts);
  }

  const valid =
    sections.length > 0 && voiceParts.length > 0 && orphanParts.length === 0 && !hasEmptySection;

  return {
    columnCount: orderedParts.length,
    orderedParts,
    sections: sectionGroups,
    valid,
  };
}
