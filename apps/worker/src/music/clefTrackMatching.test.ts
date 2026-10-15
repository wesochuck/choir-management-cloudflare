import { describe, expect, it, vi } from "vitest";
import { musicTrackImportMatchRequestSchema } from "@choir/contracts";
import { suggestClefTrackMatches } from "./clefTrackMatching";

const request = musicTrackImportMatchRequestSchema.parse({
  candidates: [{ pieceId: "11111111-1111-4111-8111-111111111111", title: "O Shenandoah" }],
  groups: [{ groupId: "group-1", fileNames: ["Shenandoah_Tenor.mp3"] }],
  useAi: true,
});
const answer = (choice = "p0", confidence = 0.9) => ({
  answers: {
    g0: {
      choice,
      confidence,
      probabilities: { none: 1 - confidence, p0: confidence },
      type: "choice",
    },
  },
});

describe("Clef track matching", () => {
  it("uses typed choices and maps compact IDs back to supplied groups and pieces", async () => {
    const run = vi.fn().mockResolvedValue(answer());
    const result = await suggestClefTrackMatches(request, run);
    expect(result[0]).toMatchObject({
      confidence: "high",
      groupId: "group-1",
      suggestedPieceId: request.candidates[0]?.pieceId,
    });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "clef-flash",
        questions: expect.objectContaining({ g0: expect.objectContaining({ type: "choice" }) }),
      }),
      expect.any(AbortSignal),
    );
  });

  it.each(["none", "p0"])("keeps %s uncertain decisions unassigned", async (choice) => {
    const run = vi.fn().mockResolvedValue(answer(choice, 0.4));
    expect((await suggestClefTrackMatches(request, run))[0]).toMatchObject({
      confidence: "none",
      suggestedPieceId: null,
    });
  });

  it.each([
    {},
    answer("foreign-piece"),
    answer("__proto__"),
    { answers: { g0: { choice: "p0", confidence: 2, probabilities: { p0: 1 }, type: "choice" } } },
    { answers: { g0: { choice: "p0", confidence: 0.9, probabilities: {}, type: "choice" } } },
  ])("rejects malformed or out-of-scope provider responses", async (response) => {
    await expect(
      suggestClefTrackMatches(request, vi.fn().mockResolvedValue(response)),
    ).rejects.toMatchObject({ code: "service_unavailable" });
  });

  it("preserves provider errors internally without exposing payloads", async () => {
    const cause = new Error("sensitive provider payload");
    await expect(
      suggestClefTrackMatches(request, vi.fn().mockRejectedValue(cause)),
    ).rejects.toMatchObject({ cause, message: expect.not.stringContaining("sensitive") });
  });

  it("rejects oversized input and duplicate IDs before inference", async () => {
    const run = vi.fn();
    await expect(
      suggestClefTrackMatches({ ...request, groups: [...request.groups, ...request.groups] }, run),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await expect(
      suggestClefTrackMatches(
        {
          ...request,
          candidates: request.candidates.map((candidate) => ({
            ...candidate,
            title: "x".repeat(49_000),
          })),
        },
        run,
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
    expect(run).not.toHaveBeenCalled();
  });

  it("batches groups and never mixes their answers", async () => {
    const groups = Array.from({ length: 6 }, (_, index) => ({
      groupId: `group-${String(index)}`,
      fileNames: ["track.mp3"],
      detectedParts: [],
    }));
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        answers: Object.fromEntries(
          Array.from({ length: 5 }, (_, index) => [`g${String(index)}`, answer().answers.g0]),
        ),
      })
      .mockResolvedValueOnce(answer());
    const result = await suggestClefTrackMatches({ ...request, groups }, run);
    expect(run).toHaveBeenCalledTimes(2);
    expect(result.map((suggestion) => suggestion.groupId)).toEqual(
      groups.map((group) => group.groupId),
    );
  });
});
