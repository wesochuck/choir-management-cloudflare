import { afterEach, describe, expect, it, vi } from "vitest";

import { getMemberPracticeLink } from "./memberDashboard";

const eventId = "00000000-0000-4000-8000-000000000001";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("member dashboard practice link API", () => {
  it("builds a set-list-mode player link for the practice token", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          token: "signed-token",
          requestId: "00000000-0000-4000-8000-000000000002",
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getMemberPracticeLink(eventId)).resolves.toBe(
      "/player?mode=set-list&token=signed-token",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/singer/practice-links/${eventId}`,
      expect.anything(),
    );
  });
});
