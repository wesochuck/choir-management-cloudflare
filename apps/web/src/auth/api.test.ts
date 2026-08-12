import { afterEach, describe, expect, it, vi } from "vitest";

import type { OrganizationAuditionSettings } from "@choir/contracts";

import {
  dismissPlatformJobDeadLetter,
  listPlatformEmailSuppressions,
  listPlatformJobDeadLetters,
  releasePlatformEmailSuppression,
  retryPlatformJobDeadLetter,
  signOut,
  updateOrganizationAuditionSettings,
} from "./api";

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

describe("account authentication API", () => {
  it("sends JSON when signing out", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(signOut()).resolves.toBeUndefined();
    const requestInit = fetchMock.mock.calls[0]?.[1];
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.body).toBe("{}");
    expect(new Headers(requestInit?.headers).get("content-type")).toBe("application/json");
  });
});

describe("platform email suppression API", () => {
  it("requests the selected recipient and active-state filters", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          nextCursor: null,
          requestId: "00000000-0000-4000-8000-000000000003",
          suppressions: [
            {
              active: true,
              createdAt: "2026-08-06T17:07:28.817Z",
              detail: "Mailbox unavailable",
              email: "bounce@example.test",
              providerMessageId: "provider-bounce",
              reason: "bounce",
              sourceEventId: "event-bounce",
              updatedAt: "2026-08-06T17:07:28.817Z",
            },
          ],
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listPlatformEmailSuppressions({
        cursor: "2026-08-06T17:07:28.817Z|bounce@example.test",
        query: "bounce@example.test",
        status: "all",
      }),
    ).resolves.toMatchObject({ suppressions: [{ email: "bounce@example.test" }] });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/platform/email-suppressions?cursor=2026-08-06T17%3A07%3A28.817Z%7Cbounce%40example.test&q=bounce%40example.test&status=all",
    );
  });

  it("posts an audited release reason for a suppression", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          active: false,
          email: "bounce@example.test",
          requestId: "00000000-0000-4000-8000-000000000003",
          updatedAt: "2026-08-06T17:08:28.817Z",
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      releasePlatformEmailSuppression(
        "bounce@example.test",
        "Mailbox issue was resolved and verified.",
      ),
    ).resolves.toMatchObject({ active: false, email: "bounce@example.test" });
    const requestInit = fetchMock.mock.calls[0]?.[1];
    expect(requestInit?.method).toBe("POST");
    const requestBody = requestInit?.body;
    if (typeof requestBody !== "string")
      throw new Error("The suppression release body was missing.");
    expect(JSON.parse(requestBody)).toEqual({
      email: "bounce@example.test",
      reason: "Mailbox issue was resolved and verified.",
    });
  });
});

describe("platform queue dead-letter API", () => {
  it("requests the selected dead-letter view", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          deadLetters: [
            {
              actionAt: null,
              actionError: "",
              actionReason: null,
              actionStatus: "open",
              firstSeenAt: "2026-08-06T17:07:28.817Z",
              id: "jobs-dlq:message-1",
              idempotencyKey: "organization-export:job-1",
              jobId: "00000000-0000-4000-8000-000000000001",
              jobKind: "organization_export",
              lastSeenAt: "2026-08-06T17:07:28.817Z",
              messageId: "message-1",
              messageValid: true,
              observationCount: 1,
              observedAttempt: 2,
              organizationId: "organization-alpha",
              queueName: "jobs-dlq",
            },
          ],
          nextCursor: null,
          requestId: "00000000-0000-4000-8000-000000000003",
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listPlatformJobDeadLetters(null, undefined, "all")).resolves.toMatchObject({
      deadLetters: [{ actionStatus: "open", id: "jobs-dlq:message-1" }],
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/platform/job-dead-letters?view=all");
  });

  it("posts retry and dismissal reasons to the protected action endpoints", async () => {
    const responseBody = {
      actionStatus: "retry_queued",
      deadLetterId: "jobs-dlq:message-1",
      requestId: "00000000-0000-4000-8000-000000000003",
      retryAttempt: 1,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(responseBody), {
          headers: { "content-type": "application/json" },
          status: 202,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ...responseBody, actionStatus: "dismissed", retryAttempt: 1 }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      retryPlatformJobDeadLetter("jobs-dlq:message-1", "The export source is fixed."),
    ).resolves.toMatchObject({ actionStatus: "retry_queued" });
    await expect(
      dismissPlatformJobDeadLetter("jobs-dlq:message-1", "Retry was reviewed."),
    ).resolves.toMatchObject({ actionStatus: "dismissed" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/platform/job-dead-letters/jobs-dlq%3Amessage-1/retry",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/platform/job-dead-letters/jobs-dlq%3Amessage-1/dismiss",
    );
  });
});
