import { organizationMusicPieceSchema, type OrganizationMusicPiece } from "@choir/contracts";
import { describe, expect, it } from "vitest";

import {
  formatPerformerCredits,
  groupSetListForPresentation,
  indentedNoteLines,
  type PresentationGroupEntry,
  type PresentationStandaloneEntry,
  type SetListPresentationEntry,
} from "./presentation";
import type { SetListItem } from "./types";

function makePiece(overrides: Partial<OrganizationMusicPiece> = {}): OrganizationMusicPiece {
  return organizationMusicPieceSchema.parse({
    composer: "Ola Gjeilo",
    createdAt: "2026-01-15T12:00:00.000Z",
    durationSeconds: 240,
    id: crypto.randomUUID(),
    notes: "",
    title: "Test Piece",
    updatedAt: "2026-01-15T12:00:00.000Z",
    ...overrides,
  });
}

function expectGroup(entry: SetListPresentationEntry | undefined): PresentationGroupEntry {
  expect(entry).toBeDefined();
  if (entry?.kind !== "movement-group") {
    throw new Error(`Expected movement-group, received ${entry?.kind ?? "undefined"}`);
  }
  return entry;
}

function expectStandalone(
  entry: SetListPresentationEntry | undefined,
): PresentationStandaloneEntry {
  expect(entry).toBeDefined();
  if (entry?.kind !== "standalone") {
    throw new Error(`Expected standalone, received ${entry?.kind ?? "undefined"}`);
  }
  return entry;
}

describe("groupSetListForPresentation", () => {
  const sunriseMass = makePiece({
    composer: "Ola Gjeilo",
    id: "10000000-0000-4000-8000-000000000001",
    title: "Sunrise Mass",
  });

  const spheres = makePiece({
    composer: "Ola Gjeilo",
    id: "10000000-0000-4000-8000-000000000002",
    parentId: sunriseMass.id,
    title: "The Spheres",
  });

  const sunrise = makePiece({
    composer: "Ola Gjeilo",
    id: "10000000-0000-4000-8000-000000000003",
    parentId: sunriseMass.id,
    title: "Sunrise",
  });

  const city = makePiece({
    composer: "Ola Gjeilo",
    id: "10000000-0000-4000-8000-000000000004",
    parentId: sunriseMass.id,
    title: "The City",
  });

  const otherSong = makePiece({
    composer: "Eric Whitacre",
    id: "20000000-0000-4000-8000-000000000001",
    title: "Seal Lullaby",
  });

  const catalog = [sunriseMass, spheres, sunrise, city, otherSong];

  it("groups parent + all contiguous children into one movement group with one program number", () => {
    const items: SetListItem[] = [
      { id: "1", pieceId: sunriseMass.id, title: "Sunrise Mass", type: "song" },
      { id: "2", pieceId: spheres.id, title: "The Spheres", type: "song" },
      { id: "3", pieceId: sunrise.id, title: "Sunrise", type: "song" },
      { id: "4", pieceId: city.id, title: "The City", type: "song" },
      { id: "5", pieceId: otherSong.id, title: "Seal Lullaby", type: "song" },
    ];

    const entries = groupSetListForPresentation(items, catalog);
    expect(entries).toHaveLength(2);

    const group = expectGroup(entries[0]);
    expect(group.kind).toBe("movement-group");
    expect(group.programNumber).toBe(1);
    expect(group.parentPiece.id).toBe(sunriseMass.id);
    expect(group.parentItem?.id).toBe("1");
    expect(group.credit).toBe("Ola Gjeilo");
    expect(group.movements).toHaveLength(3);
    expect(group.movements.map((m) => m.item.title)).toEqual([
      "The Spheres",
      "Sunrise",
      "The City",
    ]);
    expect(group.movements.map((m) => m.credit)).toEqual([undefined, undefined, undefined]);

    const nextSong = expectStandalone(entries[1]);
    expect(nextSong.kind).toBe("standalone");
    expect(nextSong.programNumber).toBe(2);
    expect(nextSong.item.title).toBe("Seal Lullaby");
  });

  it("derives a parent heading when contiguous movements appear without an explicit parent item", () => {
    const items: SetListItem[] = [
      { id: "1", pieceId: spheres.id, title: "The Spheres", type: "song" },
      { id: "2", pieceId: sunrise.id, title: "Sunrise", type: "song" },
      { id: "3", pieceId: city.id, title: "The City", type: "song" },
      { id: "4", pieceId: otherSong.id, title: "Seal Lullaby", type: "song" },
    ];

    const entries = groupSetListForPresentation(items, catalog);
    expect(entries).toHaveLength(2);

    const group = expectGroup(entries[0]);
    expect(group.kind).toBe("movement-group");
    expect(group.parentItem).toBeUndefined();
    expect(group.parentPiece.title).toBe("Sunrise Mass");
    expect(group.programNumber).toBe(1);
    expect(group.movements).toHaveLength(3);

    const next = expectStandalone(entries[1]);
    expect(next.programNumber).toBe(2);
  });

  it("groups partial contiguous movements under the parent title", () => {
    const items: SetListItem[] = [
      { id: "1", pieceId: spheres.id, title: "The Spheres", type: "song" },
      { id: "2", pieceId: city.id, title: "The City", type: "song" },
    ];

    const entries = groupSetListForPresentation(items, catalog);
    expect(entries).toHaveLength(1);

    const group = expectGroup(entries[0]);
    expect(group.kind).toBe("movement-group");
    expect(group.parentPiece.title).toBe("Sunrise Mass");
    expect(group.movements).toHaveLength(2);
    expect(group.movements.map((m) => m.item.title)).toEqual(["The Spheres", "The City"]);
  });

  it("renders a single movement as standalone with parent context and does not form a 1-item group", () => {
    const items: SetListItem[] = [
      { id: "1", pieceId: city.id, title: "The City", type: "song" },
      { id: "2", pieceId: otherSong.id, title: "Seal Lullaby", type: "song" },
    ];

    const entries = groupSetListForPresentation(items, catalog);
    expect(entries).toHaveLength(2);

    const standaloneCity = expectStandalone(entries[0]);
    expect(standaloneCity.kind).toBe("standalone");
    expect(standaloneCity.parentPiece?.title).toBe("Sunrise Mass");
    expect(standaloneCity.programNumber).toBe(1);
    expect(standaloneCity.credit).toBe("Ola Gjeilo");

    const standaloneSeal = expectStandalone(entries[1]);
    expect(standaloneSeal.kind).toBe("standalone");
    expect(standaloneSeal.parentPiece).toBeUndefined();
    expect(standaloneSeal.programNumber).toBe(2);
  });

  it("does not regroup non-contiguous movements across an intervening song", () => {
    const items: SetListItem[] = [
      { id: "1", pieceId: spheres.id, title: "The Spheres", type: "song" },
      { id: "2", pieceId: otherSong.id, title: "Seal Lullaby", type: "song" },
      { id: "3", pieceId: city.id, title: "The City", type: "song" },
    ];

    const entries = groupSetListForPresentation(items, catalog);
    expect(entries).toHaveLength(3);

    const first = expectStandalone(entries[0]);
    expect(first.item.title).toBe("The Spheres");
    expect(first.parentPiece?.title).toBe("Sunrise Mass");
    expect(first.programNumber).toBe(1);

    const second = expectStandalone(entries[1]);
    expect(second.item.title).toBe("Seal Lullaby");
    expect(second.programNumber).toBe(2);

    const third = expectStandalone(entries[2]);
    expect(third.item.title).toBe("The City");
    expect(third.parentPiece?.title).toBe("Sunrise Mass");
    expect(third.programNumber).toBe(3);
  });

  it("breaks groups across an intermission boundary", () => {
    const items: SetListItem[] = [
      { id: "1", pieceId: spheres.id, title: "The Spheres", type: "song" },
      { id: "2", title: "Intermission", type: "intermission" },
      { id: "3", pieceId: city.id, title: "The City", type: "song" },
    ];

    const entries = groupSetListForPresentation(items, catalog);
    expect(entries).toHaveLength(3);

    const first = expectStandalone(entries[0]);
    expect(first.programNumber).toBe(1);

    expect(entries[1]?.kind).toBe("intermission");

    const third = expectStandalone(entries[2]);
    expect(third.programNumber).toBe(2);
  });

  it("never groups adjacent children from different parent works", () => {
    const requiem = makePiece({
      composer: "Gabriel Fauré",
      id: "30000000-0000-4000-8000-000000000001",
      title: "Requiem",
    });
    const pieJesu = makePiece({
      composer: "Gabriel Fauré",
      id: "30000000-0000-4000-8000-000000000002",
      parentId: requiem.id,
      title: "Pie Jesu",
    });

    const items: SetListItem[] = [
      { id: "1", pieceId: city.id, title: "The City", type: "song" },
      { id: "2", pieceId: pieJesu.id, title: "Pie Jesu", type: "song" },
    ];

    const entries = groupSetListForPresentation(items, [...catalog, requiem, pieJesu]);
    expect(entries).toHaveLength(2);

    const cityEntry = expectStandalone(entries[0]);
    expect(cityEntry.parentPiece?.title).toBe("Sunrise Mass");

    const pieEntry = expectStandalone(entries[1]);
    expect(pieEntry.parentPiece?.title).toBe("Requiem");
  });

  it("fails safely and renders standalone if parent record is missing from catalog", () => {
    const orphanChild = makePiece({
      id: "40000000-0000-4000-8000-000000000001",
      parentId: "99999999-9999-4999-8999-999999999999",
      title: "Orphan Movement",
    });

    const items: SetListItem[] = [
      { id: "1", pieceId: orphanChild.id, title: "Orphan Movement", type: "song" },
    ];

    const entries = groupSetListForPresentation(items, [orphanChild]);
    expect(entries).toHaveLength(1);
    const orphanEntry = expectStandalone(entries[0]);
    expect(orphanEntry.parentPiece).toBeUndefined();
  });

  it("never groups custom unlinked items by title similarity", () => {
    const items: SetListItem[] = [
      { id: "1", title: "Sunrise Mass", type: "song" },
      { id: "2", title: "The Spheres", type: "song" },
    ];

    const entries = groupSetListForPresentation(items, catalog);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.kind).toBe("standalone");
    expect(entries[1]?.kind).toBe("standalone");
  });

  it("renders parent piece as standalone if not followed by any of its movements", () => {
    const items: SetListItem[] = [
      { id: "1", pieceId: sunriseMass.id, title: "Sunrise Mass", type: "song" },
      { id: "2", pieceId: otherSong.id, title: "Seal Lullaby", type: "song" },
    ];

    const entries = groupSetListForPresentation(items, catalog);
    expect(entries).toHaveLength(2);
    const parentStandalone = expectStandalone(entries[0]);
    expect(parentStandalone.programNumber).toBe(1);

    const otherStandalone = expectStandalone(entries[1]);
    expect(otherStandalone.programNumber).toBe(2);
  });

  it("groups parent piece followed by 1 child movement", () => {
    const items: SetListItem[] = [
      { id: "1", pieceId: sunriseMass.id, title: "Sunrise Mass", type: "song" },
      { id: "2", pieceId: spheres.id, title: "The Spheres", type: "song" },
    ];

    const entries = groupSetListForPresentation(items, catalog);
    expect(entries).toHaveLength(1);
    const group = expectGroup(entries[0]);
    expect(group.kind).toBe("movement-group");
    expect(group.parentItem?.id).toBe("1");
    expect(group.movements).toHaveLength(1);
    expect(group.programNumber).toBe(1);
  });

  it("displays movement-specific credit when it differs from parent credit", () => {
    const arrangedSpheres = makePiece({
      arranger: "Dan Forrest",
      composer: "Ola Gjeilo",
      id: "10000000-0000-4000-8000-000000000005",
      parentId: sunriseMass.id,
      title: "The Spheres (arr. Forrest)",
    });

    const items: SetListItem[] = [
      { id: "1", pieceId: sunriseMass.id, title: "Sunrise Mass", type: "song" },
      { id: "2", pieceId: arrangedSpheres.id, title: "The Spheres", type: "song" },
      { id: "3", pieceId: sunrise.id, title: "Sunrise", type: "song" },
    ];

    const entries = groupSetListForPresentation(items, [...catalog, arrangedSpheres]);
    const group = expectGroup(entries[0]);
    expect(group.credit).toBe("Ola Gjeilo");
    expect(group.movements[0]?.credit).toBe("arr. Dan Forrest");
    expect(group.movements[1]?.credit).toBeUndefined();
  });
});

describe("presentation helpers", () => {
  it("formats performer credits for featured numbers", () => {
    const featuredItem: SetListItem = {
      id: "1",
      isFeaturedNumber: true,
      performerCredits: [
        { displayName: "Alice Smith", kind: "guest" },
        { displayName: "Bob Jones", kind: "guest" },
      ],
      title: "Solo",
      type: "song",
    };
    expect(formatPerformerCredits(featuredItem)).toBe("Alice Smith, Bob Jones");

    const nonFeaturedItem: SetListItem = {
      id: "2",
      isFeaturedNumber: false,
      performerCredits: [{ displayName: "Alice Smith", kind: "guest" }],
      title: "Chorus",
      type: "song",
    };
    expect(formatPerformerCredits(nonFeaturedItem)).toBe("");
  });

  it("indents note lines properly", () => {
    const notes = "Line 1\nLine 2\nLine 3";
    const lines = indentedNoteLines(notes, "   ");
    expect(lines).toEqual(["   Notes: Line 1", "   Line 2", "   Line 3"]);
  });
});
