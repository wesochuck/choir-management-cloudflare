import { afterEach, describe, expect, it, vi } from "vitest";
import { communicationHistorySearchSchema } from "@choir/contracts";
import { getOrganizationCommunicationHistory } from "./communications";
import { AuthApiError } from "./client";
const requestId = "11111111-1111-4111-8111-111111111111";
afterEach(() => vi.unstubAllGlobals());
describe("communication history search transport", () => {
  it("encodes search together with the cursor and dropdown filters and parses the page", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ requestId, items: [], nextCursor: "next" }));
    vi.stubGlobal("fetch", fetch);
    expect(
      await getOrganizationCommunicationHistory({
        search: " Christmas & confirmation ",
        cursor: "timestamp|3|id",
        status: "sent",
        origin: "automated",
        limit: 50,
        includePreviews: false,
      }),
    ).toMatchObject({ items: [], nextCursor: "next" });
    const call: unknown = fetch.mock.calls[0]?.[0];
    expect(typeof call).toBe("string");
    if (typeof call !== "string") throw new Error("Expected URL");
    const query = new URL(call, "https://example.test").searchParams;
    expect(Object.fromEntries(query.entries())).toEqual({
      q: "Christmas & confirmation",
      cursor: "timestamp|3|id",
      status: "sent",
      origin: "automated",
      limit: "50",
      includePreviews: "false",
    });
  });
  it("retains older callers without a query and validates input bounds", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ requestId, items: [], nextCursor: null }));
    vi.stubGlobal("fetch", fetch);
    await getOrganizationCommunicationHistory({ search: "   " });
    expect(fetch).toHaveBeenCalledWith(
      "/api/organization/communications/history",
      expect.any(Object),
    );
    expect(communicationHistorySearchSchema.parse(" November 2026 ")).toBe("November 2026");
    expect(communicationHistorySearchSchema.safeParse(null).success).toBe(false);
    expect(communicationHistorySearchSchema.safeParse("x".repeat(201)).success).toBe(false);
    expect(
      communicationHistorySearchSchema.safeParse(Array.from({ length: 13 }, () => "term").join(" "))
        .success,
    ).toBe(false);
  });
  it.each([400, 401, 403])("preserves typed API failures (%s)", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { requestId, code: "invalid_communication_search", message: "Search unavailable" },
            { status },
          ),
        ),
    );
    await expect(
      getOrganizationCommunicationHistory({ search: "Christmas" }),
    ).rejects.toBeInstanceOf(AuthApiError);
  });
  it("rejects malformed page responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ requestId, items: [] })));
    await expect(getOrganizationCommunicationHistory({ search: "Christmas" })).rejects.toThrow();
  });
});
