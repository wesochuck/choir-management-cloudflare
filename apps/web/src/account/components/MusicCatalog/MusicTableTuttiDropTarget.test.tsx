import type { OrganizationMusicPiece } from "@choir/contracts";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MusicTableTrackPlayer } from "./performances";
import { MusicTableTuttiDropTarget } from "./MusicTableTuttiDropTarget";

function createMockPiece(overrides: Partial<OrganizationMusicPiece> = {}): OrganizationMusicPiece {
  return {
    arranger: "Test Arranger",
    catalogId: "CAT-123",
    composer: "Test Composer",
    copies: 20,
    createdAt: "2026-08-01T00:00:00Z",
    durationSeconds: 180,
    genres: ["Classical"],
    id: "piece-1",
    lastPerformedAt: null,
    notes: "",
    parentId: null,
    performanceCount: 0,
    purchaseDate: null,
    sectionBuckets: [],
    title: "Test Anthem",
    trackFileIds: {},
    updatedAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

describe("MusicTableTuttiDropTarget & MusicTableTrackPlayer", () => {
  it("renders a ghost drop target when the piece has no practice tracks and onSaved is provided", () => {
    const piece = createMockPiece({ trackFileIds: {} });
    const onSaved = vi.fn();
    const onError = vi.fn();

    const html = renderToString(
      <MusicTableTrackPlayer onError={onError} onSaved={onSaved} piece={piece} />,
    );

    expect(html).toContain("music-table-tutti-dropzone");
    expect(html).toContain('aria-label="Upload Tutti practice track for Test Anthem"');
    expect(html).toContain(
      'title="Drop audio file or click to upload Tutti track for Test Anthem"',
    );
    expect(html).toContain('type="file"');
    expect(html).toContain('accept="audio/*"');
  });

  it("renders an em-dash when the piece has no practice tracks and onSaved is omitted", () => {
    const piece = createMockPiece({ trackFileIds: {} });

    const html = renderToString(<MusicTableTrackPlayer piece={piece} />);

    expect(html).toBe("<span>—</span>");
    expect(html).not.toContain("music-table-tutti-dropzone");
  });

  it("renders the Play button when the piece already has a Tutti or voice part track", () => {
    const piece = createMockPiece({
      trackFileIds: {
        tutti: "file-tutti-123",
      },
    });
    const onSaved = vi.fn();

    const html = renderToString(<MusicTableTrackPlayer onSaved={onSaved} piece={piece} />);

    expect(html).toContain("Play");
    expect(html).toContain("button--secondary");
    expect(html).toContain("music-table-track-player__button");
    expect(html).toContain('<audio aria-label="Tutti learning track for Test Anthem"');
    expect(html).toContain('src="/api/organization/files/file-tutti-123"');
    // Ensure no time scrubber range input or expand/close widget is in the table list view
    expect(html).not.toContain('type="range"');
    expect(html).not.toContain("music-audio-track__scrubber");
    expect(html).not.toContain("Close player");
    expect(html).not.toContain("music-table-tutti-dropzone");
  });

  it("renders the isolated MusicTableTuttiDropTarget with proper accessibility attributes", () => {
    const piece = createMockPiece({ title: "O Magnum Mysterium" });

    const html = renderToString(<MusicTableTuttiDropTarget piece={piece} />);

    expect(html).toContain('aria-label="Upload Tutti practice track for O Magnum Mysterium"');
    expect(html).toContain(
      'title="Drop audio file or click to upload Tutti track for O Magnum Mysterium"',
    );
    expect(html).toContain("<svg");
  });
});
