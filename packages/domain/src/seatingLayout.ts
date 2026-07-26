export type SeatingKeyMap = Readonly<Record<string, string>>;

export interface SeatingLayoutState {
  readonly assignments: Record<string, string>;
  readonly rowCounts: number[];
  readonly sectionSuggestions: Record<string, string>;
}

function remapKeys(
  values: SeatingKeyMap,
  remap: (rowIndex: number, seatIndex: number) => [number, number] | null,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    const [rowText, seatText] = key.split("-");
    const rowIndex = Number(rowText);
    const seatIndex = Number(seatText);
    if (!Number.isInteger(rowIndex) || !Number.isInteger(seatIndex)) continue;
    const mapped = remap(rowIndex, seatIndex);
    if (mapped) next[`${String(mapped[0])}-${String(mapped[1])}`] = value;
  }
  return next;
}

function withMaps(
  rowCounts: readonly number[],
  assignments: SeatingKeyMap,
  sectionSuggestions: SeatingKeyMap,
): SeatingLayoutState {
  return {
    assignments: { ...assignments },
    rowCounts: [...rowCounts],
    sectionSuggestions: { ...sectionSuggestions },
  };
}

export function addRow(
  current: SeatingLayoutState,
  position: "front" | "back",
  seatCount = 10,
): SeatingLayoutState {
  if (!Number.isInteger(seatCount) || seatCount < 1) return current;
  if (position === "back") {
    return withMaps(
      [...current.rowCounts, seatCount],
      current.assignments,
      current.sectionSuggestions,
    );
  }

  return withMaps(
    [seatCount, ...current.rowCounts],
    remapKeys(current.assignments, (rowIndex, seatIndex) => [rowIndex + 1, seatIndex]),
    remapKeys(current.sectionSuggestions, (rowIndex, seatIndex) => [rowIndex + 1, seatIndex]),
  );
}

export function addSeat(current: SeatingLayoutState, rowIndex: number): SeatingLayoutState {
  if (rowIndex < 0 || rowIndex >= current.rowCounts.length) return current;
  const rowCounts = [...current.rowCounts];
  rowCounts[rowIndex] = (rowCounts[rowIndex] ?? 0) + 1;
  return withMaps(rowCounts, current.assignments, current.sectionSuggestions);
}

export function removeSeat(
  current: SeatingLayoutState,
  rowIndex: number,
  seatIndex: number,
): SeatingLayoutState {
  const existingCount = current.rowCounts[rowIndex] ?? 0;
  if (rowIndex < 0 || rowIndex >= current.rowCounts.length || seatIndex < 0) return current;
  if (existingCount <= 1 || seatIndex >= existingCount) return current;

  const rowCounts = [...current.rowCounts];
  rowCounts[rowIndex] = existingCount - 1;
  const shift = (candidateRow: number, candidateSeat: number): [number, number] | null => {
    if (candidateRow !== rowIndex) return [candidateRow, candidateSeat];
    if (candidateSeat === seatIndex) return null;
    return [candidateRow, candidateSeat > seatIndex ? candidateSeat - 1 : candidateSeat];
  };
  return withMaps(
    rowCounts,
    remapKeys(current.assignments, shift),
    remapKeys(current.sectionSuggestions, shift),
  );
}

export function removeRow(current: SeatingLayoutState, rowIndex: number): SeatingLayoutState {
  if (current.rowCounts.length <= 1 || rowIndex < 0 || rowIndex >= current.rowCounts.length) {
    return current;
  }
  const rowCounts = current.rowCounts.filter((_count, index) => index !== rowIndex);
  const shift = (candidateRow: number, seatIndex: number): [number, number] | null => {
    if (candidateRow === rowIndex) return null;
    return [candidateRow > rowIndex ? candidateRow - 1 : candidateRow, seatIndex];
  };
  return withMaps(
    rowCounts,
    remapKeys(current.assignments, shift),
    remapKeys(current.sectionSuggestions, shift),
  );
}

export function moveAssignment(
  assignments: SeatingKeyMap,
  sourceSeatKey: string,
  targetSeatKey: string,
  profileId?: string,
): Record<string, string> {
  const sourceProfileId = profileId ?? assignments[sourceSeatKey];
  if (!sourceProfileId) return { ...assignments };

  const targetProfileId = assignments[targetSeatKey];
  const next = Object.fromEntries(
    Object.entries(assignments).filter(([key, value]) => {
      if (key === sourceSeatKey && sourceSeatKey !== targetSeatKey) return false;
      if (key !== sourceSeatKey && value === sourceProfileId) return false;
      return true;
    }),
  );
  if (sourceSeatKey !== targetSeatKey) {
    if (targetProfileId && profileId === undefined) next[sourceSeatKey] = targetProfileId;
  }
  next[targetSeatKey] = sourceProfileId;
  return next;
}

export function unassignProfile(
  assignments: SeatingKeyMap,
  profileId: string,
): Record<string, string> {
  return Object.fromEntries(Object.entries(assignments).filter(([, value]) => value !== profileId));
}
