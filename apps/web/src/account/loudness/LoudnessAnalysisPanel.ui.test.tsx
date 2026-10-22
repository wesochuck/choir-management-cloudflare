import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { organizationMusicPieceSchema } from "@choir/contracts";
import { LoudnessAnalysisPanel } from "./LoudnessAnalysisPanel";

vi.mock("./client", () => {
  return {
    loudnessAnalysisEnabled: vi.fn(() => true),
    pauseLoudnessAnalysis: vi.fn(),
    loudnessRequest: vi.fn(),
    runLoudnessBatch: vi.fn(),
    statusesSchema: {
      parse: (val: unknown) => val,
    },
  };
});

import { loudnessRequest, runLoudnessBatch } from "./client";

describe("LoudnessAnalysisPanel failure reporting", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes the bounded LUFS setting, save, and reset", async () => {
    vi.mocked(loudnessRequest).mockResolvedValue({ statuses: [], failures: [] });
    const onTargetChange = vi.fn();
    const onSaveTarget = vi.fn();
    const { rerender } = render(
      <LoudnessAnalysisPanel
        targetLufs={-14}
        savedTargetLufs={-18}
        onTargetChange={onTargetChange}
        onSaveTarget={onSaveTarget}
      />,
    );
    expect(screen.getByRole("group", { name: "Practice recording loudness" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Target loudness (LUFS)"), { target: { value: "-24" } });
    expect(onTargetChange).toHaveBeenCalledWith(-24);
    await user.click(screen.getByRole("button", { name: "Save loudness target" }));
    expect(onSaveTarget).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Reset to −18 LUFS" }));
    expect(onTargetChange).toHaveBeenCalledWith(-18);
    rerender(
      <LoudnessAnalysisPanel
        targetLufs={-9}
        savedTargetLufs={-18}
        onTargetChange={onTargetChange}
        onSaveTarget={onSaveTarget}
      />,
    );
    expect(screen.getByRole("button", { name: "Save loudness target" })).toBeDisabled();
  });

  it("links a failed recording to its piece editor and original download", async () => {
    const fileId = "00000000-0000-4000-8000-000000000001";
    const pieceId = "00000000-0000-4000-8000-000000000002";
    vi.mocked(loudnessRequest).mockResolvedValue({
      statuses: [],
      failures: [
        {
          fileId,
          fileName: "original.mp3",
          pieceTitle: "Song",
          status: "failed",
          reasonCode: "invalid_audio",
        },
      ],
    });
    const piece = organizationMusicPieceSchema.parse({
      id: pieceId,
      title: "Song",
      trackFileIds: { tutti: fileId },
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    const navigate = vi.fn();
    render(<LoudnessAnalysisPanel pieces={[piece]} navigate={navigate} />);
    const link = (await screen.findAllByRole("link", { name: "Song" }))[0];
    if (!link) throw new Error("Missing piece link");
    await user.click(link);
    expect(navigate).toHaveBeenCalledWith(
      `/admin/library?pieceId=${pieceId}&returnTo=%2Fadmin%2Flibrary%2Fsettings`,
    );
    expect(screen.getAllByRole("link", { name: "Download" })[0]).toHaveAttribute(
      "href",
      `/api/organization/files/${fileId}`,
    );
    expect(
      screen.getAllByRole("button", { name: "Replace recording original.mp3" })[0],
    ).toBeEnabled();
  });

  it("renders the failed recordings table with piece title, file name, and issue description", async () => {
    vi.mocked(loudnessRequest).mockResolvedValue({
      statuses: [
        { status: "failed", count: 1 },
        { status: "ready", count: 6 },
      ],
      failures: [
        {
          fileId: "00000000-0000-4000-8000-000000000001",
          fileName: "alto_solo.mp3",
          pieceTitle: "Ave Verum Corpus",
          status: "failed",
          reasonCode: "invalid_audio",
        },
      ],
    });

    render(<LoudnessAnalysisPanel />);

    await waitFor(() => {
      expect(screen.getByText(/1 failed · 6 ready/)).toBeInTheDocument();
    });

    expect(
      screen.getByRole("heading", { name: "Failed or unsupported recordings" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Ave Verum Corpus")[0]).toBeInTheDocument();
    expect(screen.getAllByText("alto_solo.mp3")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Corrupt audio data")[0]).toBeInTheDocument();

    const [retryButton] = screen.getAllByRole("button", {
      name: "Retry analysis for Ave Verum Corpus - alto_solo.mp3",
    });
    expect(retryButton).toBeDefined();
    if (!retryButton) throw new Error("Retry button missing");

    await user.click(retryButton);
    expect(runLoudnessBatch).toHaveBeenCalledWith(
      { mode: "retry_failed", fileId: "00000000-0000-4000-8000-000000000001" },
      expect.any(AbortSignal),
      expect.any(Function),
    );
  });

  it("does not render the failed table when there are no failures", async () => {
    vi.mocked(loudnessRequest).mockResolvedValue({
      statuses: [{ status: "ready", count: 7 }],
      failures: [],
    });

    render(<LoudnessAnalysisPanel />);

    await waitFor(() => {
      expect(screen.getByText(/7 ready/)).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("heading", { name: "Failed or unsupported recordings" }),
    ).not.toBeInTheDocument();
  });
});
