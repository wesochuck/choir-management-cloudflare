import { describe, expect, it } from "vitest";
import { expandMusicSelections, sortMusicMovements } from "./musicMovementOrder";

const parent = { id: "work", title: "Work", parentId: null, movementOrder: ["b", "a"] };
const a = { id: "a", title: "Alpha", parentId: "work" };
const b = { id: "b", title: "Beta", parentId: "work" };
const c = { id: "c", title: "New movement", parentId: "work" };

describe("default movement order", () => {
  it("uses saved positions, ignores removed IDs, and appends new movements consistently", () => {
    expect(sortMusicMovements([a, c, b], ["removed", "b", "a"])).toEqual([b, a, c]);
    expect(sortMusicMovements([b, a])).toEqual([a, b]);
    expect(sortMusicMovements([])).toEqual([]);
  });
  it("expands whole works without including a duplicate parent duration or selected child", () => {
    expect(expandMusicSelections([a, parent, b], [parent, a, c, b])).toEqual([b, a, c]);
    expect(expandMusicSelections([b], [parent, a, b])).toEqual([b]);
    expect(expandMusicSelections([parent], [parent])).toEqual([parent]);
  });
});
