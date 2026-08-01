export type SeatingFormationStrategy = "horizontal_row" | "vertical_column";

interface ActiveSeat {
  readonly rowIndex: number;
  readonly seatIndex: number;
  readonly x: number;
}

function activeSeatCounts(rowCounts: readonly number[], singerCount: number): number[] {
  const totalSeats = rowCounts.reduce((sum, count) => sum + count, 0);
  const targetCount = Math.min(Math.max(0, singerCount), totalSeats);
  const counts = rowCounts.map((count) =>
    Math.min(count, Math.round(count * (targetCount / totalSeats))),
  );
  let activeTotal = counts.reduce((sum, count) => sum + count, 0);
  while (activeTotal !== targetCount) {
    let bestIndex = -1;
    let bestCapacity = -1;
    for (const [index, rowCount] of rowCounts.entries()) {
      const capacity =
        activeTotal < singerCount ? rowCount - (counts[index] ?? 0) : (counts[index] ?? 0);
      if (capacity > bestCapacity && capacity > 0) {
        bestCapacity = capacity;
        bestIndex = index;
      }
    }
    if (bestIndex === -1) break;
    counts[bestIndex] = (counts[bestIndex] ?? 0) + (activeTotal < singerCount ? 1 : -1);
    activeTotal += activeTotal < singerCount ? 1 : -1;
  }
  return counts;
}

function verticalSuggestions(
  rowCounts: readonly number[],
  sectionCounts: Readonly<Record<string, number>>,
  sectionOrder: readonly string[],
  singerCount: number,
): Readonly<Record<string, string>> {
  const activeCounts = activeSeatCounts(rowCounts, singerCount);
  const seats: ActiveSeat[] = [];
  rowCounts.forEach((rowSize, rowIndex) => {
    const count = activeCounts[rowIndex] ?? 0;
    const start = Math.floor((rowSize - count) / 2);
    const midpoint = (rowSize - 1) / 2;
    for (let seatIndex = start; seatIndex < start + count; seatIndex += 1) {
      seats.push({ rowIndex, seatIndex, x: seatIndex - midpoint });
    }
  });
  seats.sort((left, right) =>
    Math.abs(left.x - right.x) < 0.001 ? left.rowIndex - right.rowIndex : left.x - right.x,
  );
  const suggestions: Record<string, string> = {};
  let cursor = 0;
  for (const code of sectionOrder) {
    const count = sectionCounts[code] ?? 0;
    for (let assigned = 0; assigned < count && cursor < seats.length; assigned += 1) {
      const seat = seats[cursor];
      if (seat) suggestions[`${String(seat.rowIndex)}-${String(seat.seatIndex)}`] = code;
      cursor += 1;
    }
  }
  return suggestions;
}

function horizontalSuggestions(
  rowCounts: readonly number[],
  sectionCounts: Readonly<Record<string, number>>,
  sectionOrder: readonly string[],
  singerCount: number,
): Readonly<Record<string, string>> {
  const totalSeats = rowCounts.reduce((sum, count) => sum + count, 0);
  const suggestions: Record<string, string> = {};
  let filled = 0;
  for (let rowIndex = rowCounts.length - 1; rowIndex >= 0; rowIndex -= 1) {
    const rowSize = rowCounts[rowIndex] ?? 0;
    for (let seatIndex = 0; seatIndex < rowSize; seatIndex += 1) {
      const target = Math.floor((filled / totalSeats) * singerCount);
      let threshold = 0;
      let selected = sectionOrder.at(-1) ?? "";
      for (const code of sectionOrder) {
        threshold += sectionCounts[code] ?? 0;
        if (target < threshold) {
          selected = code;
          break;
        }
      }
      suggestions[`${String(rowIndex)}-${String(seatIndex)}`] = selected;
      filled += 1;
    }
  }
  return suggestions;
}

export function calculateSeatingSuggestions(
  rowCounts: readonly number[],
  sectionCounts: Readonly<Record<string, number>>,
  sectionOrder: readonly string[],
  strategy: SeatingFormationStrategy,
): Readonly<Record<string, string>> {
  const singerCount = Object.values(sectionCounts).reduce((sum, count) => sum + count, 0);
  const totalSeats = rowCounts.reduce((sum, count) => sum + count, 0);
  if (singerCount === 0 || totalSeats === 0 || sectionOrder.length === 0) return {};
  const suggestedSingerCount = Math.min(singerCount, totalSeats);
  return strategy === "vertical_column"
    ? verticalSuggestions(rowCounts, sectionCounts, sectionOrder, suggestedSingerCount)
    : horizontalSuggestions(rowCounts, sectionCounts, sectionOrder, singerCount);
}

export function isSeatingSectionMismatch(
  voicePart: string | undefined,
  suggestedSection: string | undefined,
  voiceParts: readonly { readonly label: string; readonly sectionCode: string }[],
): boolean {
  if (!voicePart || !suggestedSection) return false;
  const configured = voiceParts.find(({ label }) => label === voicePart);
  return Boolean(
    configured?.sectionCode &&
    configured.sectionCode.toUpperCase() !== suggestedSection.toUpperCase(),
  );
}
