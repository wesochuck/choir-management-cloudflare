import {
  organizationEventSchema,
  organizationMusicPieceSchema,
  type OrganizationEvent,
  type OrganizationMusicPiece,
} from "@choir/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SetListPreview } from "./shared";
import type { SetListItem } from "./types";
import { setListDocumentText } from "./utils";

function piece(overrides: Partial<OrganizationMusicPiece> = {}): OrganizationMusicPiece {
  return organizationMusicPieceSchema.parse({
    composer: "Greg Gilpin",
    createdAt: "2026-01-15T12:00:00.000Z",
    durationSeconds: 195,
    notes: "",
    title: "A Holiday Road of Carols",
    updatedAt: "2026-01-15T12:00:00.000Z",
    ...overrides,
    id: overrides.id ?? "11111111-1111-4111-8111-111111111111",
  });
}

describe("SetListPreview credit formatting", () => {
  const event: OrganizationEvent = organizationEventSchema.parse({
    createdAt: "2026-08-01T12:00:00.000Z",
    id: "5f7d9d3e-0b5a-4a8e-9d0e-1a2b3c4d5e6f",
    location: "Community Hall",
    setList: [],
    startsAt: "2026-12-05T19:30:00.000Z",
    title: "Winter Concert",
    type: "Performance",
    updatedAt: "2026-08-01T12:00:00.000Z",
  });

  const pieceBoth = piece({
    arranger: "Peter J. Wilhousky",
    composer: "Mykola Leontovych",
    id: "11111111-1111-4111-8111-111111111111",
    title: "Carol of the Bells",
  });

  const pieceComposerOnly = piece({
    arranger: "",
    composer: "George Frideric Handel",
    id: "22222222-2222-4222-8222-222222222222",
    title: "Messiah",
  });

  const pieceArrangerOnly = piece({
    arranger: "Moses Hogan",
    composer: "",
    id: "33333333-3333-4333-8333-333333333333",
    title: "Elijah Rock",
  });

  const pieceNeither = piece({
    arranger: "",
    composer: "",
    id: "44444444-4444-4444-8444-444444444444",
    title: "Traditional Chants",
  });

  const catalog = [pieceBoth, pieceComposerOnly, pieceArrangerOnly, pieceNeither];

  it("shows only the arranger with 'arr. ' prefix when both arranger and composer exist", () => {
    const items: SetListItem[] = [
      { id: "item-1", pieceId: pieceBoth.id, title: pieceBoth.title, type: "song" },
    ];
    const { container } = render(<SetListPreview event={event} items={items} music={catalog} />);
    const composerSpan = container.querySelector(".set-list-preview__composer");
    expect(composerSpan).not.toBeNull();
    expect(composerSpan?.textContent).toBe("arr. Peter J. Wilhousky");
    expect(container.textContent).not.toContain("Mykola Leontovych");
  });

  it("shows only the arranger with 'arr. ' prefix when only arranger exists", () => {
    const items: SetListItem[] = [
      { id: "item-1", pieceId: pieceArrangerOnly.id, title: pieceArrangerOnly.title, type: "song" },
    ];
    const { container } = render(<SetListPreview event={event} items={items} music={catalog} />);
    const composerSpan = container.querySelector(".set-list-preview__composer");
    expect(composerSpan?.textContent).toBe("arr. Moses Hogan");
  });

  it("shows composer with no prefix when only composer exists", () => {
    const items: SetListItem[] = [
      { id: "item-1", pieceId: pieceComposerOnly.id, title: pieceComposerOnly.title, type: "song" },
    ];
    const { container } = render(<SetListPreview event={event} items={items} music={catalog} />);
    const composerSpan = container.querySelector(".set-list-preview__composer");
    expect(composerSpan?.textContent).toBe("George Frideric Handel");
  });

  it("omits the credit element when neither arranger nor composer exists", () => {
    const items: SetListItem[] = [
      { id: "item-1", pieceId: pieceNeither.id, title: pieceNeither.title, type: "song" },
    ];
    const { container } = render(<SetListPreview event={event} items={items} music={catalog} />);
    const composerSpan = container.querySelector(".set-list-preview__composer");
    expect(composerSpan).toBeNull();
  });

  it("omits credit element when credit fields contain only whitespace", () => {
    const customItemWhitespace: SetListItem = {
      composer: "   ",
      id: "item-1",
      title: "Whitespace Song",
      type: "song",
    };
    const { container } = render(
      <SetListPreview event={event} items={[customItemWhitespace]} music={[]} />,
    );
    const composerSpan = container.querySelector(".set-list-preview__composer");
    expect(composerSpan).toBeNull();
  });

  it("renders intermission items without credit", () => {
    const items: SetListItem[] = [{ id: "item-1", title: "Intermission", type: "intermission" }];
    const { container } = render(<SetListPreview event={event} items={items} music={catalog} />);
    expect(screen.getByText("Intermission")).toBeDefined();
    const composerSpan = container.querySelector(".set-list-preview__composer");
    expect(composerSpan).toBeNull();
  });

  it("matches copied text credit precedence across all scenarios", () => {
    const items: SetListItem[] = [
      { id: "item-1", pieceId: pieceBoth.id, title: pieceBoth.title, type: "song" },
      { id: "item-2", pieceId: pieceComposerOnly.id, title: pieceComposerOnly.title, type: "song" },
      { id: "item-3", pieceId: pieceArrangerOnly.id, title: pieceArrangerOnly.title, type: "song" },
      { id: "item-4", pieceId: pieceNeither.id, title: pieceNeither.title, type: "song" },
      { id: "item-5", title: "Intermission", type: "intermission" },
    ];
    const { container } = render(<SetListPreview event={event} items={items} music={catalog} />);
    const previewCredits = Array.from(container.querySelectorAll(".set-list-preview__song")).map(
      (songEl) => songEl.querySelector(".set-list-preview__composer")?.textContent ?? null,
    );

    const text = setListDocumentText(event, items, catalog);
    expect(previewCredits).toEqual([
      "arr. Peter J. Wilhousky",
      "George Frideric Handel",
      "arr. Moses Hogan",
      null,
    ]);

    expect(text).toContain("1. Carol of the Bells ~ arr. Peter J. Wilhousky");
    expect(text).toContain("2. Messiah ~ George Frideric Handel");
    expect(text).toContain("3. Elijah Rock ~ arr. Moses Hogan");
    expect(text).toContain("4. Traditional Chants");
    expect(text).toContain("Intermission");
  });
});
