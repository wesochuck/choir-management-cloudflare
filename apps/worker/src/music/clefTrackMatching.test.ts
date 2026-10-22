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

  it.each(["none"])("keeps %s uncertain decisions unassigned", async (choice) => {
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
    const run = vi.fn().mockImplementation((input: { questions: Record<string, unknown> }) =>
      Promise.resolve({
        answers: Object.fromEntries(
          Object.keys(input.questions).map((id) => [id, answer().answers.g0]),
        ),
      }),
    );
    const result = await suggestClefTrackMatches({ ...request, groups }, run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.map((suggestion) => suggestion.groupId)).toEqual(
      groups.map((group) => group.groupId),
    );
  });

  it("exposes close arrangement alternatives without silently choosing one", async () => {
    const multiCandidateRequest = musicTrackImportMatchRequestSchema.parse({
      candidates: [
        {
          composer: "Franz Biebl",
          pieceId: "11111111-1111-4111-8111-111111111111",
          title: "Ave Maria",
        },
        {
          composer: "Tomás Luis de Victoria",
          pieceId: "22222222-2222-4222-8222-222222222222",
          title: "Ave Maria",
        },
      ],
      groups: [{ groupId: "group-1", fileNames: ["Ave_Maria.mp3"] }],
      useAi: true,
    });
    // Two close arrangements (prob 0.48 and 0.42, difference 0.06 <= 0.15)
    const run = vi.fn().mockResolvedValue({
      answers: {
        g0: {
          choice: "p0",
          confidence: 0.48,
          probabilities: { none: 0.1, p0: 0.48, p1: 0.42 },
          type: "choice",
        },
      },
    });

    const result = await suggestClefTrackMatches(multiCandidateRequest, run);
    expect(result[0]?.suggestedPieceId).toBeNull();
    expect(result[0]?.confidence).toBe("none");
    expect(result[0]?.rationale).toContain("close arrangements");
    expect(result[0]?.topCandidates).toHaveLength(2);
    expect(result[0]?.topCandidates?.[0]?.pieceId).toBe("11111111-1111-4111-8111-111111111111");
    expect(result[0]?.topCandidates?.[1]?.pieceId).toBe("22222222-2222-4222-8222-222222222222");

    // Verify candidate criteria sent to Clef contains real metadata
    const firstCallInput: unknown = run.mock.calls[0]?.[0];
    expect(firstCallInput).toBeDefined();
    expect(JSON.stringify(firstCallInput)).toContain("comp: Franz Biebl");
    expect(JSON.stringify(firstCallInput)).toContain("comp: Tomás Luis de Victoria");
  });

  it("suggests voice parts for unassigned files using configured part keys", async () => {
    const partRequest = musicTrackImportMatchRequestSchema.parse({
      candidates: [{ pieceId: "11111111-1111-4111-8111-111111111111", title: "Song" }],
      configuredPartKeys: ["soprano1", "alto1", "tenor1", "bass1"],
      groups: [
        {
          fileMetadata: [
            {
              clientFileId: "file-1",
              fileName: "Mystery_Recording.mp3",
              title: "Mystery Recording",
            },
          ],
          fileNames: ["Mystery_Recording.mp3"],
          groupId: "group-1",
        },
      ],
      useAi: true,
    });

    const run = vi.fn().mockResolvedValue({
      answers: {
        f_0_0: {
          choice: "alto1",
          confidence: 0.85,
          probabilities: { alto1: 0.85, none: 0.15 },
          type: "choice",
        },
        g0: {
          choice: "p0",
          confidence: 0.9,
          probabilities: { none: 0.1, p0: 0.9 },
          type: "choice",
        },
      },
    });

    const result = await suggestClefTrackMatches(partRequest, run);
    expect(result[0]?.filePartSuggestions).toEqual([
      {
        clientFileId: "file-1",
        probability: 0.85,
        suggestedPartKey: "alto1",
      },
    ]);
  });
});

describe("AI matching safety boundaries", () => {
  it.each([0.5, 0.69])("retains a %s alternative without preselecting", async (probability) => {
    const result = await suggestClefTrackMatches(
      request,
      vi.fn().mockResolvedValue(answer("p0", probability)),
    );
    expect(result[0]?.suggestedPieceId).toBeNull();
    expect(result[0]?.topCandidates?.[0]?.probability).toBe(probability);
    expect(result[0]?.noneProbability).toBeCloseTo(1 - probability);
  });

  it("does not preselect a strong model estimate supported only by duration", async () => {
    const result = await suggestClefTrackMatches(
      {
        ...request,
        groups: [
          { groupId: "unknown", fileNames: ["Part2.mp3"], detectedParts: [], durationSeconds: 180 },
        ],
      },
      vi.fn().mockResolvedValue(answer()),
    );
    expect(result[0]?.suggestedPieceId).toBeNull();
  });

  it("packs many ambiguous files by bytes and questions with bounded concurrency", async () => {
    let active = 0;
    let peak = 0;
    const groups = Array.from({ length: 8 }, (_, g) => ({
      groupId: `group-${String(g)}`,
      detectedParts: [],
      fileNames: Array.from({ length: 50 }, (_, f) => `Song_${String(g)}_${String(f)}.mp3`),
      fileMetadata: Array.from({ length: 50 }, (_, f) => ({
        clientFileId: `${String(g)}-${String(f)}`,
        fileName: `Song_${String(g)}_${String(f)}.mp3`,
        title: "Song",
      })),
    }));
    const run = vi.fn(async (input: Record<string, unknown>) => {
      const parsed = input.questions;
      if (!parsed || typeof parsed !== "object") throw new Error("Missing questions");
      expect(Object.keys(parsed).length).toBeLessThanOrEqual(64);
      expect(new TextEncoder().encode(JSON.stringify(input)).length).toBeLessThanOrEqual(20_000);
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      active -= 1;
      return {
        answers: Object.fromEntries(
          Object.keys(parsed).map((id) => [
            id,
            id.startsWith("f_")
              ? { choice: "none", confidence: 1, probabilities: { none: 1 }, type: "choice" }
              : answer().answers.g0,
          ]),
        ),
      };
    });
    const results = await suggestClefTrackMatches(
      { ...request, groups, configuredPartKeys: ["Low"] },
      run,
    );
    expect(peak).toBe(2);
    expect(run.mock.calls.length).toBeGreaterThan(6);
    expect(results.map((r) => r.groupId)).toEqual(groups.map((g) => g.groupId));
    for (const result of results)
      expect(result.filePartSuggestions?.map((f) => f.clientFileId)).toEqual(
        groups.find((g) => g.groupId === result.groupId)?.fileMetadata.map((f) => f.clientFileId),
      );
  });

  it("enforces the shared deadline even when the provider ignores cancellation", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const pending = suggestClefTrackMatches(
        request,
        () =>
          new Promise(() => {
            /* Provider deliberately ignores cancellation. */
          }),
        controller.signal,
      );
      const rejection = expect(pending).rejects.toMatchObject({ code: "service_unavailable" });
      controller.abort();
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("preflights every planned call before starting inference", async () => {
    const run = vi.fn();
    await expect(
      suggestClefTrackMatches(
        {
          ...request,
          groups: [
            { groupId: "small", detectedParts: [], fileNames: ["Song.mp3"] },
            {
              groupId: "oversized",
              detectedParts: [],
              fileNames: Array.from({ length: 50 }, () => "x".repeat(500)),
            },
          ],
        },
        run,
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
    expect(run).not.toHaveBeenCalled();
  });
});

it.each([
  { choice: "foreign", probabilities: { foreign: 1, none: 0 } },
  { choice: "Low", probabilities: { Low: 0.9, none: 0.9 } },
  { choice: "Low", probabilities: { Low: 0.9, foreign: 0.1, none: 0 } },
  { choice: "Low", probabilities: { Low: 0.2, none: 0.8 } },
])("rejects invalid part distributions before applying any suggestions", async (value) => {
  const partRequest = {
    ...request,
    configuredPartKeys: ["Low"],
    groups: [
      {
        groupId: "group-1",
        detectedParts: [],
        fileNames: ["Song.mp3"],
        fileMetadata: [{ clientFileId: "stable", fileName: "Song.mp3" }],
      },
    ],
  };
  await expect(
    suggestClefTrackMatches(
      partRequest,
      vi.fn().mockResolvedValue({
        answers: {
          ...answer().answers,
          f_0_0: { ...value, confidence: 0.9, type: "choice" },
        },
      }),
    ),
  ).rejects.toMatchObject({ code: "service_unavailable" });
});

describe("Clef 3-stage track import matching (#289)", () => {
  it("proposes merge_groups in group_repair stage when AI confirms complementary song groups", async () => {
    const repairRequest = musicTrackImportMatchRequestSchema.parse({
      candidates: [{ pieceId: "11111111-1111-4111-8111-111111111111", title: "O Shenandoah" }],
      groups: [
        {
          detectedParts: ["soprano"],
          fileNames: ["Shenandoah_Soprano.mp3"],
          groupId: "group-1",
          inferredTitle: "Shenandoah",
        },
        {
          detectedParts: ["alto"],
          fileNames: ["Shenandoah_Alto.mp3"],
          groupId: "group-2",
          inferredTitle: "Shenandoah",
        },
      ],
      stage: "group_repair",
      useAi: true,
    });

    const run = vi.fn().mockResolvedValue({
      answers: {
        rm_0: {
          choice: "same_song",
          confidence: 0.92,
          probabilities: { different_song: 0.05, same_song: 0.92, uncertain: 0.03 },
          type: "choice",
        },
      },
    });

    const result = await suggestClefTrackMatches(repairRequest, run);
    expect(result.stage).toBe("group_repair");
    expect(result.stageStatus).toBe("complete");
    expect(result.groupRepairSuggestions).toEqual([
      expect.objectContaining({
        confidence: 0.92,
        groupIds: ["group-1", "group-2"],
        kind: "merge_groups",
      }),
    ]);
  });

  it("proposes split_group in group_repair stage when AI detects unrelated files in same group", async () => {
    const repairRequest = musicTrackImportMatchRequestSchema.parse({
      candidates: [{ pieceId: "11111111-1111-4111-8111-111111111111", title: "O Shenandoah" }],
      groups: [
        {
          detectedParts: ["tenor", "tenor"],
          fileMetadata: [
            {
              clientFileId: "f1",
              detectedPartKey: "tenor",
              fileName: "Shenandoah_Tenor.mp3",
              inferredTitle: "Shenandoah",
            },
            {
              clientFileId: "f2",
              detectedPartKey: "tenor",
              fileName: "Hallelujah_Tenor.mp3",
              inferredTitle: "Hallelujah",
            },
          ],
          fileNames: ["Shenandoah_Tenor.mp3", "Hallelujah_Tenor.mp3"],
          groupId: "group-mixed",
          inferredTitle: "Mixed Group",
        },
      ],
      stage: "group_repair",
      useAi: true,
    });

    const run = vi.fn().mockResolvedValue({
      answers: {
        rs_0: {
          choice: "different_song",
          confidence: 0.88,
          probabilities: { different_song: 0.88, same_song: 0.08, uncertain: 0.04 },
          type: "choice",
        },
      },
    });

    const result = await suggestClefTrackMatches(repairRequest, run);
    expect(result.stage).toBe("group_repair");
    expect(result.stageStatus).toBe("complete");
    expect(result.groupRepairSuggestions).toEqual([
      expect.objectContaining({
        confidence: 0.88,
        kind: "split_group",
        sourceGroupId: "group-mixed",
      }),
    ]);
  });

  it("scales beyond 200 candidates and 50 groups via deterministic shortlisting and batching", async () => {
    const manyCandidates = Array.from({ length: 250 }, (_, i) => ({
      pieceId: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
      title: i === 0 ? "Shenandoah" : `Catalog Song ${String(i)}`,
    }));
    const manyGroups = Array.from({ length: 65 }, (_, i) => ({
      fileNames: [`track_${String(i)}.mp3`],
      groupId: `g_${String(i)}`,
      inferredTitle: i === 0 ? "Shenandoah" : `Song ${String(i)}`,
    }));

    const bigRequest = musicTrackImportMatchRequestSchema.parse({
      candidates: manyCandidates,
      groups: manyGroups,
      stage: "piece_matching",
      useAi: true,
    });

    const run = vi.fn().mockImplementation((input: { questions: Record<string, unknown> }) => {
      // Must not exceed 64 questions per Clef call
      expect(Object.keys(input.questions).length).toBeLessThanOrEqual(64);
      return Promise.resolve({
        answers: Object.fromEntries(
          Object.keys(input.questions).map((qId) => [
            qId,
            {
              choice: "none",
              confidence: 0.5,
              probabilities: { none: 1 },
              type: "choice",
            },
          ]),
        ),
      });
    });

    const result = await suggestClefTrackMatches(bigRequest, run);
    expect(result.length).toBe(65);
    expect(result.stage).toBe("piece_matching");
    expect(result.stageStatus).toBe("complete");
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("returns partial results across stage timeout or batch failure instead of dropping all answers", async () => {
    const multiBatchRequest = musicTrackImportMatchRequestSchema.parse({
      candidates: [{ pieceId: "11111111-1111-4111-8111-111111111111", title: "Shenandoah" }],
      groups: Array.from({ length: 65 }, (_, i) => ({
        fileNames: [`track_${String(i)}.mp3`],
        groupId: `g_${String(i)}`,
        inferredTitle: `Song ${String(i)}`,
      })),
      stage: "piece_matching",
      useAi: true,
    });

    let callCount = 0;
    const run = vi.fn().mockImplementation((input: { questions: Record<string, unknown> }) => {
      callCount += 1;
      if (callCount === 2) {
        return Promise.reject(new Error("Transient provider timeout in batch 2"));
      }
      return Promise.resolve({
        answers: Object.fromEntries(
          Object.keys(input.questions).map((qId) => [
            qId,
            {
              choice: "none",
              confidence: 0.8,
              probabilities: { none: 1 },
              type: "choice",
            },
          ]),
        ),
      });
    });

    const result = await suggestClefTrackMatches(multiBatchRequest, run);
    expect(result.stageStatus).toBe("partial");
    expect(result.completedGroupIds?.length).toBeGreaterThan(0);
    expect(result.failedCount).toBe(1);
    expect(result.reason).toContain("partially");
  });

  it("returns part alternatives, reason, and readable roster part labels in part_review stage", async () => {
    const reviewRequest = musicTrackImportMatchRequestSchema.parse({
      candidates: [{ pieceId: "11111111-1111-4111-8111-111111111111", title: "Shenandoah" }],
      configuredParts: [
        { key: "T1", kind: "voice_part", label: "Tenor 1" },
        { key: "T2", kind: "voice_part", label: "Tenor 2" },
      ],
      configuredPartKeys: ["T1", "T2"],
      groups: [
        {
          fileMetadata: [
            {
              clientFileId: "f-review-1",
              detectedPartKey: "T1",
              fileName: "Shenandoah_T1.mp3",
              inferredTitle: "Shenandoah",
            },
          ],
          fileNames: ["Shenandoah_T1.mp3"],
          groupId: "g-part",
          inferredTitle: "Shenandoah",
        },
      ],
      stage: "part_review",
      useAi: true,
    });

    const run = vi
      .fn()
      .mockImplementation(
        (input: { questions: Record<string, { criteria: Record<string, string> }> }) => {
          const q = input.questions.f_0_0;
          expect(q?.criteria.T1).toBe("Tenor 1 (T1)");
          expect(q?.criteria.T2).toBe("Tenor 2 (T2)");
          return Promise.resolve({
            answers: {
              f_0_0: {
                choice: "T2",
                confidence: 0.8,
                probabilities: { T1: 0.18, T2: 0.8, none: 0.02 },
                type: "choice",
              },
            },
          });
        },
      );

    const result = await suggestClefTrackMatches(reviewRequest, run);
    expect(result.stage).toBe("part_review");
    expect(result.stageStatus).toBe("complete");
    const partSuggestions = result[0]?.filePartSuggestions;
    expect(partSuggestions).toHaveLength(1);
    expect(partSuggestions?.[0]).toMatchObject({
      alternatives: [{ partKey: "T1", probability: 0.18 }],
      clientFileId: "f-review-1",
      evidence: expect.stringContaining("80%"),
      probability: 0.8,
      reason: "correction",
      suggestedPartKey: "T2",
    });
  });
});
