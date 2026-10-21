import type { OrganizationMusicPiece, OrganizationRosterConfiguration } from "@choir/contracts";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { extractAudioDurationFromUrl } from "../../../audioDuration";
import { MusicAudioTracks } from "../tracksAndBulkEdit";
import { useMusicEditor } from "./useMusicEditor";

vi.mock("../../../audioDuration", () => ({
  extractAudioDuration: vi.fn(() => Promise.resolve(null)),
  extractAudioDurationFromUrl: vi.fn(),
}));

const ROSTER: OrganizationRosterConfiguration = {
  attendanceReportWarningThreshold: 1,
  onBreakTimeoutDays: 365,
  onBreakTimeoutEnabled: true,
  performerLabel: "Performer",
  rehearsalAttendanceReportsEnabled: true,
  rsvpExpiryEnabled: true,
  rsvpFollowUpEnabled: true,
  rsvpFollowUpLeadHours: 48,
  sections: [{ code: "S", color: "#000000", name: "Soprano", trackOnly: false }],
  statusAutomationEnabled: true,
  statusAutomationMissThreshold: 3,
  statusAutomationRecoveryEnabled: true,
  voiceParts: [{ fullName: "Soprano 1", label: "S1", sectionCode: "S" }],
};

const TUTTI_FILE_ID = "40000000-0000-4000-8000-000000000001";

// Stable identities keep the editor callbacks (and therefore the harness effect)
// from being re-created on every render.
const ignoreBusy = (): void => undefined;
const ignoreError = (): void => undefined;
const ignoreMessage = (): void => undefined;
const ignorePieces = (): void => undefined;

interface MetadataRequest {
  readonly resolve: (durationSeconds: number | null) => void;
}

const metadataRequests: MetadataRequest[] = [];
const mediaState = { paused: true };

function musicPiece(overrides: Partial<OrganizationMusicPiece> = {}): OrganizationMusicPiece {
  return {
    arranger: "",
    catalogId: "",
    composer: "Ola Gjeilo",
    copies: null,
    createdAt: "2026-08-17T00:00:00.000Z",
    durationSeconds: null,
    genres: [],
    id: "30000000-0000-4000-8000-000000000001",
    lastPerformedAt: null,
    notes: "",
    parentId: null,
    performanceCount: 0,
    purchaseDate: null,
    scoreFileIds: {},
    sectionBuckets: [],
    title: "Sunrise Mass",
    trackFileIds: { tutti: TUTTI_FILE_ID },
    updatedAt: "2026-08-17T00:00:00.000Z",
    ...overrides,
  };
}

function MusicEditorHarness({ piece }: { readonly piece: OrganizationMusicPiece }) {
  const editor = useMusicEditor({
    busy: false,
    pieces: [piece],
    roster: ROSTER,
    setBusy: ignoreBusy,
    setError: ignoreError,
    setMessage: ignoreMessage,
    setPieces: ignorePieces,
  });
  const { setDialogOpen, setEditorPiece } = editor;
  useEffect(() => {
    // The harness reproduces opening an existing piece from the music catalog.
    setEditorPiece(piece);
    setDialogOpen(true);
  }, [piece, setDialogOpen, setEditorPiece]);
  const mismatch = editor.durationMismatch;
  return (
    <div>
      <p data-testid="editor-dirty">{String(editor.editorDirty)}</p>
      <p data-testid="details-dirty">{String(editor.editorDirtySections.details)}</p>
      <label>
        Title
        <input
          aria-label="Title"
          value={editor.piece.title}
          onChange={(event) => {
            editor.setPiece((current) => ({ ...current, title: event.target.value }));
          }}
        />
      </label>
      <label>
        Duration
        <input
          aria-label="Duration"
          value={editor.durationInput}
          onChange={(event) => {
            editor.setDurationValue(event.target.value, true);
          }}
        />
      </label>
      {mismatch ? (
        <button
          type="button"
          onClick={() => {
            editor.setDurationValue(mismatch.suggested, true);
          }}
        >
          Use {mismatch.suggested}
        </button>
      ) : null}
      <MusicAudioTracks
        configuration={ROSTER}
        piece={piece}
        onSaved={() => undefined}
        onTrackDurationDetected={editor.handleTrackDurationDetected}
      />
    </div>
  );
}

async function resolveMetadataDetection(durationSeconds: number | null): Promise<void> {
  const request = metadataRequests[0];
  if (!request) throw new Error("Expected a pending track metadata request");
  await act(async () => {
    request.resolve(durationSeconds);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

function primeTrackPlayer(container: HTMLElement): HTMLAudioElement {
  const audio = container.querySelector("audio");
  if (!audio) throw new Error("Expected a practice track player");
  Object.defineProperty(audio, "duration", { configurable: true, value: 245, writable: true });
  Object.defineProperty(audio, "currentTime", { configurable: true, value: 0, writable: true });
  Object.defineProperty(audio, "paused", {
    configurable: true,
    get: () => mediaState.paused,
  });
  fireEvent.loadedMetadata(audio);
  return audio;
}

describe("music editor track metadata detection", () => {
  beforeEach(() => {
    metadataRequests.length = 0;
    mediaState.paused = true;
    vi.mocked(extractAudioDurationFromUrl).mockImplementation(
      () =>
        new Promise<number | null>((resolve) => {
          metadataRequests.push({ resolve });
        }),
    );
    vi.spyOn(window.HTMLMediaElement.prototype, "load").mockImplementation(function () {
      // jsdom has no media pipeline; the player only needs the element to exist.
    });
    vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      mediaState.paused = false;
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    });
    vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      mediaState.paused = true;
      this.dispatchEvent(new Event("pause"));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the editor clean when metadata resolves during playback for a piece without a saved duration", async () => {
    const user = userEvent.setup();
    const { container } = render(<MusicEditorHarness piece={musicPiece()} />);
    primeTrackPlayer(container);

    await user.click(screen.getByRole("button", { name: "Play Tutti" }));
    expect(screen.getByRole("button", { name: "Pause Tutti" })).toBeInTheDocument();
    expect(metadataRequests).toHaveLength(1);

    await resolveMetadataDetection(245);

    expect(screen.getByTestId("editor-dirty")).toHaveTextContent("false");
    expect(screen.getByTestId("details-dirty")).toHaveTextContent("false");
    expect(screen.getByLabelText("Duration")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Use 4:05" })).toBeInTheDocument();
  });

  it("keeps the editor clean when metadata resolves during playback for a piece with a saved duration", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MusicEditorHarness piece={musicPiece({ durationSeconds: 245 })} />,
    );
    primeTrackPlayer(container);

    await user.click(screen.getByRole("button", { name: "Play Tutti" }));
    await resolveMetadataDetection(245);

    expect(screen.getByTestId("editor-dirty")).toHaveTextContent("false");
    expect(screen.getByTestId("details-dirty")).toHaveTextContent("false");
    expect(screen.getByLabelText("Duration")).toHaveValue("4:05");
    expect(screen.queryByRole("button", { name: "Use 4:05" })).not.toBeInTheDocument();
  });

  it("stays clean when the administrator pauses and seeks a track after detection resolves", async () => {
    const user = userEvent.setup();
    const { container } = render(<MusicEditorHarness piece={musicPiece()} />);
    primeTrackPlayer(container);

    await user.click(screen.getByRole("button", { name: "Play Tutti" }));
    await resolveMetadataDetection(245);
    await user.click(screen.getByRole("button", { name: "Pause Tutti" }));
    await user.click(screen.getByRole("button", { name: "Play Tutti" }));
    fireEvent.change(screen.getByRole("slider", { name: "Scrub Tutti" }), {
      target: { value: "60" },
    });

    expect(screen.getByTestId("editor-dirty")).toHaveTextContent("false");
    expect(screen.getByTestId("details-dirty")).toHaveTextContent("false");
  });

  it("marks details dirty only once the administrator applies the detected duration", async () => {
    const user = userEvent.setup();
    render(<MusicEditorHarness piece={musicPiece()} />);

    await resolveMetadataDetection(245);
    expect(screen.getByTestId("details-dirty")).toHaveTextContent("false");

    await user.click(screen.getByRole("button", { name: "Use 4:05" }));

    expect(screen.getByTestId("details-dirty")).toHaveTextContent("true");
    expect(screen.getByTestId("editor-dirty")).toHaveTextContent("true");
    expect(screen.getByLabelText("Duration")).toHaveValue("4:05");
  });

  it("marks details dirty when the administrator edits piece details", async () => {
    const user = userEvent.setup();
    render(<MusicEditorHarness piece={musicPiece()} />);

    await user.type(screen.getByLabelText("Title"), "!");

    expect(screen.getByTestId("details-dirty")).toHaveTextContent("true");
    expect(screen.getByTestId("editor-dirty")).toHaveTextContent("true");
  });
});
