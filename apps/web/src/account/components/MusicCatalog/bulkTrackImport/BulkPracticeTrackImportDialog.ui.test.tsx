import type {
  OrganizationEvent,
  OrganizationMusicPiece,
  OrganizationRosterConfiguration,
  MusicTrackImportMatchRequest,
  MusicTrackImportMatchResponse,
} from "@choir/contracts";
import { organizationEventSchema } from "@choir/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BulkPracticeTrackImportDialog } from "./BulkPracticeTrackImportDialog";

vi.mock("../../../audioDuration", () => ({
  extractAudioDuration: vi.fn().mockResolvedValue(180),
}));

const mockUploadPrivateOrganizationFile = vi
  .fn<() => Promise<{ id: string }>>()
  .mockResolvedValue({ id: "file-id-123" });
vi.mock("../../../../api/files", () => ({
  uploadPrivateOrganizationFile: () => mockUploadPrivateOrganizationFile(),
}));

const samplePieceId = "11111111-1111-4111-8111-111111111111";
const sampleEventId = "22222222-2222-4222-8222-222222222222";

const mockAttachResult = {
  requestId: "req-1",
  results: [
    {
      clientFileId: "file-1",
      partKey: "soprano",
      pieceId: samplePieceId,
      status: "attached" as const,
    },
  ],
  summary: {
    attached: 1,
    conflict: 0,
    failed: 0,
    skipped: 0,
  },
};

const mockAttachBulkPracticeTracks = vi
  .fn<() => Promise<typeof mockAttachResult>>()
  .mockResolvedValue(mockAttachResult);
const mockMatchBulkPracticeTracks =
  vi.fn<(request: MusicTrackImportMatchRequest) => Promise<MusicTrackImportMatchResponse>>();
vi.mock("../../../../api/music", () => ({
  attachBulkPracticeTracks: () => mockAttachBulkPracticeTracks(),
  matchBulkPracticeTracks: (request: MusicTrackImportMatchRequest) =>
    mockMatchBulkPracticeTracks(request),
}));

const samplePiece: OrganizationMusicPiece = {
  arranger: "",
  catalogId: "CAT-1",
  composer: "Handel",
  copies: 1,
  createdAt: "2025-01-01T00:00:00.000Z",
  durationSeconds: 180,
  genres: ["Classical"],
  id: samplePieceId,
  lastPerformedAt: null,
  notes: "",
  parentId: null,
  performanceCount: 0,
  purchaseDate: null,
  scoreFileIds: {},
  sectionBuckets: [],
  title: "Hallelujah Chorus",
  trackFileIds: {},
  updatedAt: "2025-01-01T00:00:00.000Z",
};

const sampleEvent: OrganizationEvent = organizationEventSchema.parse({
  createdAt: "2025-01-01T00:00:00.000Z",
  id: sampleEventId,
  setList: [
    {
      durationSeconds: 180,
      order: 1,
      pieceId: samplePieceId,
      title: "Hallelujah Chorus",
    },
  ],
  startsAt: "2025-12-01T19:00:00.000Z",
  title: "Winter Concert",
  type: "Performance",
  updatedAt: "2025-01-01T00:00:00.000Z",
});

const sampleRoster: OrganizationRosterConfiguration = {
  attendanceReportWarningThreshold: 1,
  onBreakTimeoutDays: 365,
  onBreakTimeoutEnabled: true,
  performerLabel: "Performer",
  rsvpExpiryEnabled: true,
  rsvpFollowUpEnabled: true,
  rsvpFollowUpLeadHours: 48,
  sections: [
    { code: "S", color: "#000000", name: "Soprano", trackOnly: false },
    { code: "A", color: "#000000", name: "Alto", trackOnly: false },
    { code: "T", color: "#000000", name: "Tenor", trackOnly: false },
    { code: "B", color: "#000000", name: "Bass", trackOnly: false },
  ],
  statusAutomationEnabled: true,
  statusAutomationMissThreshold: 3,
  statusAutomationRecoveryEnabled: true,
  voiceParts: [
    { fullName: "Soprano", label: "soprano", sectionCode: "S" },
    { fullName: "Alto", label: "alto", sectionCode: "A" },
    { fullName: "Tenor", label: "tenor", sectionCode: "T" },
    { fullName: "Bass", label: "bass", sectionCode: "B" },
  ],
};

describe("BulkPracticeTrackImportDialog", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders closed without dialog element", () => {
    render(
      <BulkPracticeTrackImportDialog
        events={[sampleEvent]}
        onClose={vi.fn()}
        onTracksAttached={vi.fn()}
        open={false}
        pieces={[samplePiece]}
        roster={sampleRoster}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders step 1 with scope options and dropzone when open", () => {
    render(
      <BulkPracticeTrackImportDialog
        events={[sampleEvent]}
        onClose={vi.fn()}
        onTracksAttached={vi.fn()}
        open={true}
        pieces={[samplePiece]}
        roster={sampleRoster}
      />,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Bulk upload practice tracks")).toBeInTheDocument();
    expect(screen.getByText("Specific performance set list")).toBeInTheDocument();
    expect(screen.getByText("Entire Music Library")).toBeInTheDocument();
    expect(screen.getByText("Drop MP3s here or browse files")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review groups" })).toBeDisabled();
  });

  it("handles file drop, progresses through wizard to completion", async () => {
    const handleClose = vi.fn();
    const handleOpenPiece = vi.fn();
    const handleTracksAttached = vi.fn();

    render(
      <BulkPracticeTrackImportDialog
        events={[sampleEvent]}
        onClose={handleClose}
        onOpenPiece={handleOpenPiece}
        onTracksAttached={handleTracksAttached}
        open={true}
        pieces={[samplePiece]}
        roster={sampleRoster}
      />,
    );

    const file = new File(["dummy audio bytes"], "01 Hallelujah Chorus - Soprano.mp3", {
      type: "audio/mpeg",
    });

    const dropzone = screen
      .getByText("Drop MP3s here or browse files")
      .closest(".track-import-dropzone");
    expect(dropzone).not.toBeNull();
    if (!dropzone) return;

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [file],
      },
    });

    // File table should appear with inspected file
    await waitFor(() => {
      expect(screen.getByText("01 Hallelujah Chorus - Soprano.mp3")).toBeInTheDocument();
    });

    const reviewButton = screen.getByRole("button", { name: "Review groups" });
    expect(reviewButton).not.toBeDisabled();
    fireEvent.click(reviewButton);

    // Step 2: Review matches
    await waitFor(() => {
      expect(screen.getByText("Why this suggestion?")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Hallelujah Chorus" })).toBeInTheDocument();
      expect(screen.getAllByText("Hallelujah Chorus (Handel)").length).toBeGreaterThan(0);
    });

    const confirmSelectionsBtn = screen.getByRole("button", { name: "Confirm selections" });
    fireEvent.click(confirmSelectionsBtn);

    // Step 3: Confirm & upload
    await waitFor(() => {
      expect(screen.getByText("Destination piece")).toBeInTheDocument();
    });

    const startUploadBtn = screen.getByRole("button", { name: /Upload & attach 1 tracks/i });
    fireEvent.click(startUploadBtn);

    // Step 4: Results
    await waitFor(() => {
      expect(screen.getByText("Import completed")).toBeInTheDocument();
      expect(screen.getByText("Tracks attached")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Hallelujah Chorus" }));
    expect(handleOpenPiece).toHaveBeenCalledWith(samplePieceId);
    const doneBtn = screen.getByRole("button", { name: "Return to Music Library" });
    fireEvent.click(doneBtn);

    expect(handleTracksAttached).toHaveBeenCalledTimes(1);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("leaves unrelated files unselected and explains missing parts without strong badges", async () => {
    render(
      <BulkPracticeTrackImportDialog
        events={[sampleEvent]}
        onClose={vi.fn()}
        onTracksAttached={vi.fn()}
        open={true}
        pieces={[samplePiece]}
        roster={sampleRoster}
      />,
    );
    const dropzone = screen
      .getByText("Drop MP3s here or browse files")
      .closest(".track-import-dropzone");
    if (!dropzone) throw new Error("Missing dropzone");
    fireEvent.drop(dropzone, {
      dataTransfer: { files: [new File(["dummy"], "Applause.mp3", { type: "audio/mpeg" })] },
    });
    await waitFor(() => expect(screen.getByText("Applause.mp3")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Review groups" }));
    expect(screen.getByRole("heading", { name: "Applause" })).toBeInTheDocument();
    expect(screen.getByText("0 strong suggestions")).toBeInTheDocument();
    expect(screen.queryByText("Strong suggestion")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Destination music piece")).toHaveValue("");
    expect(screen.getByText("Part needed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Match separately" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Destination music piece"), {
      target: { value: samplePieceId },
    });
    expect(screen.getByText("Review selection")).toBeInTheDocument();
    expect(
      screen.getByText("Selected manually; no matching evidence for this piece."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Duration match:/)).not.toBeInTheDocument();
  });

  it("flags duplicate voice parts in Step 2 review and allows splitting", async () => {
    render(
      <BulkPracticeTrackImportDialog
        events={[sampleEvent]}
        onClose={vi.fn()}
        onTracksAttached={vi.fn()}
        open={true}
        pieces={[samplePiece]}
        roster={sampleRoster}
      />,
    );

    const file1 = new File(["dummy"], "Hallelujah - Soprano (Take 1).mp3", { type: "audio/mpeg" });
    const file2 = new File(["dummy"], "Hallelujah - Soprano (Take 2).mp3", { type: "audio/mpeg" });

    const dropzone = screen
      .getByText("Drop MP3s here or browse files")
      .closest(".track-import-dropzone");
    expect(dropzone).not.toBeNull();
    if (!dropzone) return;

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [file1, file2],
      },
    });

    await waitFor(() => {
      expect(screen.getByText("Hallelujah - Soprano (Take 1).mp3")).toBeInTheDocument();
      expect(screen.getByText("Hallelujah - Soprano (Take 2).mp3")).toBeInTheDocument();
    });

    const reviewButton = screen.getByRole("button", { name: "Review groups" });
    fireEvent.click(reviewButton);

    await waitFor(() => {
      expect(screen.getByText("Needs review")).toBeInTheDocument();
      expect(screen.getAllByText("Duplicate part").length).toBe(2);
    });

    // Split buttons should be present
    const splitButtons = screen.getAllByRole("button", { name: "Match separately" });
    expect(splitButtons.length).toBe(2);

    const secondSplitBtn = splitButtons[1];
    expect(secondSplitBtn).toBeDefined();
    if (!secondSplitBtn) return;

    fireEvent.click(secondSplitBtn);

    // Splitting should create two single-file song sets
    await waitFor(() => {
      expect(screen.getAllByText("1 file")[0]).toBeInTheDocument();
    });
  });

  it("provides play and scrub controls for track files", async () => {
    render(
      <BulkPracticeTrackImportDialog
        events={[sampleEvent]}
        onClose={vi.fn()}
        onTracksAttached={vi.fn()}
        open={true}
        pieces={[samplePiece]}
        roster={sampleRoster}
      />,
    );

    const file = new File(["dummy audio bytes"], "01 Hallelujah Chorus - Soprano.mp3", {
      type: "audio/mpeg",
    });

    const dropzone = screen
      .getByText("Drop MP3s here or browse files")
      .closest(".track-import-dropzone");
    expect(dropzone).not.toBeNull();
    if (!dropzone) return;

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [file],
      },
    });

    await waitFor(() => {
      expect(screen.getByText("01 Hallelujah Chorus - Soprano.mp3")).toBeInTheDocument();
    });

    // Audio play button should be available in Step 1
    const playButton = screen.getByRole("button", {
      name: "Play 01 Hallelujah Chorus - Soprano.mp3",
    });
    expect(playButton).toBeInTheDocument();

    // Scrubber should be available
    const scrubber = screen.getByRole("slider", {
      name: "Scrub 01 Hallelujah Chorus - Soprano.mp3",
    });
    expect(scrubber).toBeInTheDocument();

    // Clicking play triggers toggle without error
    fireEvent.click(playButton);
  });
});

async function openAiReview(fileName = "Hallelujah - Soprano.mp3") {
  render(
    <BulkPracticeTrackImportDialog
      events={[sampleEvent]}
      onClose={vi.fn()}
      onTracksAttached={vi.fn()}
      open
      pieces={[samplePiece]}
      roster={sampleRoster}
    />,
  );
  fireEvent.change(screen.getByLabelText(/Drop MP3s here or browse files/), {
    target: { files: [new File(["audio"], fileName, { type: "audio/mpeg" })] },
  });
  await screen.findByText(fileName);
  fireEvent.click(screen.getByRole("button", { name: "Review groups" }));
}

describe("optional Clef Flash matching", () => {
  afterEach(() => {
    mockMatchBulkPracticeTracks.mockReset();
  });

  it("defaults a matched recording without a detected part to Tutti", async () => {
    await openAiReview("Hallelujah Chorus.mp3");
    expect(
      screen.getByRole("combobox", { name: "Voice part for Hallelujah Chorus.mp3" }),
    ).toHaveValue("tutti");
  });

  it("defaults an unassigned recording when a piece is selected manually and preserves explicit skips", async () => {
    await openAiReview("Unidentified recording.mp3");
    const part = screen.getByRole("combobox", {
      name: "Voice part for Unidentified recording.mp3",
    });
    expect(part).toHaveValue("");
    fireEvent.change(screen.getByRole("combobox", { name: /Destination music piece/ }), {
      target: { value: samplePieceId },
    });
    expect(part).toHaveValue("tutti");
    fireEvent.change(part, { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: /Destination music piece/ }), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: /Destination music piece/ }), {
      target: { value: samplePieceId },
    });
    expect(part).toHaveValue("");
  });

  it("defaults recordings without a part when Clef Flash finds a match", async () => {
    mockMatchBulkPracticeTracks.mockImplementation((request) =>
      Promise.resolve({
        model: "@cf/cloudflare/clef-flash",
        requestId: "req-1",
        suggestions: request.groups.map((group) => ({
          confidence: "high",
          groupId: group.groupId,
          suggestedPieceId: samplePieceId,
        })),
      }),
    );
    await openAiReview("Unidentified recording.mp3");
    fireEvent.click(screen.getByRole("button", { name: "Use Clef Flash" }));
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Voice part for Unidentified recording.mp3" }),
      ).toHaveValue("tutti"),
    );
  });

  it("only sends metadata on opt-in and shows a reviewable suggestion", async () => {
    mockMatchBulkPracticeTracks.mockImplementation((request) =>
      Promise.resolve({
        model: "@cf/cloudflare/clef-flash",
        requestId: "req-1",
        suggestions: request.groups.map((group) => ({
          confidence: "high",
          groupId: group.groupId,
          rationale: "Clef Flash metadata suggestion (90% confidence). Review before uploading.",
          suggestedPieceId: samplePieceId,
        })),
      }),
    );
    await openAiReview();
    expect(mockMatchBulkPracticeTracks).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use Clef Flash" }));
    await waitFor(() => {
      expect(screen.getByText(/Evidence: Clef Flash metadata suggestion/)).toBeInTheDocument();
    });
    expect(mockMatchBulkPracticeTracks).toHaveBeenCalledWith(
      expect.objectContaining({
        useAi: true,
        performanceTitle: "Winter Concert",
        candidates: [expect.objectContaining({ pieceId: samplePieceId })],
        groups: [expect.objectContaining({ fileNames: ["Hallelujah - Soprano.mp3"] })],
      }),
    );
    expect(JSON.stringify(mockMatchBulkPracticeTracks.mock.calls[0])).not.toContain("audio/mpeg");
    expect(screen.getByRole("button", { name: "Confirm selections" })).toBeEnabled();
  });

  it("preserves manual selections on failure and allows retry", async () => {
    mockMatchBulkPracticeTracks.mockRejectedValueOnce(new Error("Clef Flash is unavailable."));
    await openAiReview();
    fireEvent.click(screen.getByRole("button", { name: "Use Clef Flash" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your current selections are preserved",
    );
    expect(screen.getByRole("button", { name: "Confirm selections" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Use Clef Flash" })).toBeEnabled();
  });

  it("locks editing while a request runs and leaves uncertain choices for manual assignment", async () => {
    let resolveMatch: ((response: MusicTrackImportMatchResponse) => void) | undefined;
    mockMatchBulkPracticeTracks.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMatch = resolve;
        }),
    );
    await openAiReview();
    fireEvent.click(screen.getByRole("button", { name: "Use Clef Flash" }));
    expect(screen.getByRole("button", { name: "Confirm selections" })).toBeDisabled();
    expect(
      screen.getAllByRole("combobox").every((element) => element.hasAttribute("disabled")),
    ).toBe(true);
    const groupId = mockMatchBulkPracticeTracks.mock.calls[0]?.[0].groups[0]?.groupId;
    expect(groupId).toBeDefined();
    resolveMatch?.({
      model: "@cf/cloudflare/clef-flash",
      requestId: "req-1",
      suggestions: [
        {
          confidence: "none",
          groupId: groupId ?? "",
          rationale: "Choose a piece manually.",
          suggestedPieceId: null,
        },
      ],
    });
    await screen.findByText("No piece selected");
    expect(screen.getByRole("button", { name: "Use Clef Flash" })).toBeEnabled();
  });
});
