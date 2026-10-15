import { afterEach, describe, expect, it, vi } from "vitest";
import { matchBulkPracticeTracks } from "./music";
import { AuthApiError } from "./client";

const pieceId = "11111111-1111-4111-8111-111111111111";
const request = {
  candidates: [{ occupiedPartKeys: [], pieceId, title: "Shenandoah" }],
  groups: [{ detectedParts: [], fileNames: ["track.mp3"], groupId: "one" }],
  useAi: true,
};
const fetchMock = vi.fn<typeof fetch>();
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});
function respond(body: unknown, status = 200) {
  vi.stubGlobal("fetch", fetchMock.mockResolvedValueOnce(Response.json(body, { status })));
}

describe("music track matching browser client", () => {
  it("sends opt-in metadata and validates suggestions", async () => {
    respond({
      model: "@cf/cloudflare/clef-flash",
      requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      suggestions: [{ confidence: "high", groupId: "one", suggestedPieceId: pieceId }],
    });
    const controller = new AbortController();
    expect(
      (await matchBulkPracticeTracks(request, controller.signal)).suggestions[0]?.suggestedPieceId,
    ).toBe(pieceId);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/organization/music/track-import/match",
      expect.objectContaining({
        body: JSON.stringify(request),
        method: "POST",
        signal: controller.signal,
      }),
    );
  });
  it("rejects malformed response data", async () => {
    respond({ suggestions: [{ suggestedPieceId: "invented" }] });
    await expect(matchBulkPracticeTracks(request)).rejects.toThrow();
  });
  it.each([400, 401, 403, 503])("preserves typed server errors (%s)", async (status) => {
    respond(
      {
        code: "matching_failed",
        message: "Choose a piece manually.",
        requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
      status,
    );
    await expect(matchBulkPracticeTracks(request)).rejects.toBeInstanceOf(AuthApiError);
  });
});
