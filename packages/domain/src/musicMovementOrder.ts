interface Movement {
  readonly id: string;
  readonly title: string;
}

/** Saved positions first; new or unordered movements follow in a stable title order. */
export function sortMusicMovements<T extends Movement>(
  movements: readonly T[],
  movementOrder: readonly string[] = [],
): T[] {
  const positions = new Map(movementOrder.map((id, index) => [id, index]));
  return [...movements].sort(
    (left, right) =>
      (positions.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (positions.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
      left.title.localeCompare(right.title) ||
      left.id.localeCompare(right.id),
  );
}

/** Expand whole works to their movements without duplicating individually selected movements. */
export function expandMusicSelections<
  T extends Movement & {
    readonly parentId: string | null;
    readonly movementOrder?: readonly string[] | undefined;
  },
>(selected: readonly T[], library: readonly T[]): T[] {
  const childrenByParent = new Map<string, T[]>();
  for (const piece of library) {
    if (!piece.parentId) continue;
    const children = childrenByParent.get(piece.parentId) ?? [];
    children.push(piece);
    childrenByParent.set(piece.parentId, children);
  }
  const selectedIds = new Set(selected.map(({ id }) => id));
  const included = new Set<string>();
  const result: T[] = [];
  for (const piece of selected) {
    if (piece.parentId && selectedIds.has(piece.parentId)) continue;
    const children = childrenByParent.get(piece.id) ?? [];
    for (const entry of children.length
      ? sortMusicMovements(children, piece.movementOrder)
      : [piece]) {
      if (included.has(entry.id)) continue;
      included.add(entry.id);
      result.push(entry);
    }
  }
  return result;
}
