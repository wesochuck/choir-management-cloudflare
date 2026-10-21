import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
