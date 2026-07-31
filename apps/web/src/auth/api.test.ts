import { afterEach, describe, expect, it, vi } from "vitest";

import type { OrganizationAuditionSettings } from "@choir/contracts";

import { updateOrganizationAuditionSettings } from "./api";

const settings: OrganizationAuditionSettings = {
  adminNotifyEnabled: false,
  adminNotifyUsers: [],
  confirmationMessage: "We received your inquiry.",
  defaultPerformanceId: "00000000-0000-4000-8000-000000000001",
  enabled: true,
  slots: [
    {
      endsAt: "2026-08-26T14:15:00.000Z",
      id: "slot-1",
      startsAt: "2026-08-26T14:00:00.000Z",
    },
  ],
  venueId: "00000000-0000-4000-8000-000000000002",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("organization audition settings API", () => {
  it("sends refined settings without using response-schema omission", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ...settings,
          requestId: "00000000-0000-4000-8000-000000000003",
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(updateOrganizationAuditionSettings(settings)).resolves.toMatchObject(settings);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestInit = fetchMock.mock.calls[0]?.[1];
    expect(requestInit?.method).toBe("PUT");
    const requestBody = requestInit?.body;
    if (typeof requestBody !== "string") throw new Error("The audition settings body was missing.");
    expect(JSON.parse(requestBody)).toEqual(settings);
  });
});
