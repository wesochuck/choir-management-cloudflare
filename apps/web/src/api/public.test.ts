import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearPublishedOrganizationProjectionCache,
  getPublishedOrganizationProjection,
  publishOrganizationPublicWebsite,
} from "./public";

const mockProjection = {
  generatedAt: "2026-07-20T12:00:00.000Z",
  organizationId: "11111111-1111-4111-8111-111111111111",
  payload: {
    mediaFileIds: [],
    organizationName: "Test Chorus",
    performances: [],
    settings: {
      aboutUsText: "About us",
      bodyFont: "system",
      contactEmail: "info@example.test",
      enabledNavigation: [],
      headerFont: "system",
      heroFileId: null,
      heroHeadline: "Welcome",
      heroSubtitle: "Subtitle",
      historyText: "",
      logoFileId: null,
      showBrandingHeaderFooter: false,
    },
    ticketBundles: [],
    timezone: "America/New_York",
  },
  version: 1,
};

describe("getPublishedOrganizationProjection in-memory deduplication and caching", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearPublishedOrganizationProjectionCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearPublishedOrganizationProjectionCache();
    globalThis.fetch = originalFetch;
  });

  it("deduplicates concurrent in-flight requests into a single network fetch", async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      return Promise.resolve(
        new Response(JSON.stringify(mockProjection), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
    });
    globalThis.fetch = fetchMock;

    const [first, second] = await Promise.all([
      getPublishedOrganizationProjection(),
      getPublishedOrganizationProjection(),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(mockProjection);
    expect(second).toEqual(mockProjection);
  });

  it("serves subsequent calls from in-memory cache without extra network fetches", async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      return Promise.resolve(
        new Response(JSON.stringify(mockProjection), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
    });
    globalThis.fetch = fetchMock;

    const first = await getPublishedOrganizationProjection();
    const second = await getPublishedOrganizationProjection();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(mockProjection);
    expect(second).toEqual(mockProjection);
  });

  it("bypasses in-memory cache when bypassCache option is specified", async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      return Promise.resolve(
        new Response(JSON.stringify(mockProjection), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
    });
    globalThis.fetch = fetchMock;

    await getPublishedOrganizationProjection();
    await getPublishedOrganizationProjection(undefined, { bypassCache: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("clears in-memory projection cache on publish", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : "href" in input ? input.href : input.url;
      if (url.includes("/api/organization/website/publish")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              publishedAt: "2026-07-20T12:00:00.000Z",
              requestId: "11111111-1111-4111-8111-111111111111",
              version: 2,
            }),
            {
              headers: { "content-type": "application/json" },
              status: 200,
            },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(mockProjection), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
    });
    globalThis.fetch = fetchMock;

    await getPublishedOrganizationProjection();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await publishOrganizationPublicWebsite();
    expect(fetchMock).toHaveBeenCalledTimes(2); // publish request

    await getPublishedOrganizationProjection();
    expect(fetchMock).toHaveBeenCalledTimes(3); // fresh projection fetch
  });

  it("isolates caller abort signals so aborting the first caller does not fail concurrent callers", async () => {
    let resolveResponse!: (value: Response) => void;
    const fetchMock = vi.fn().mockImplementation(() => {
      return new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      });
    });
    globalThis.fetch = fetchMock;

    const firstController = new AbortController();
    const secondController = new AbortController();

    const firstPromise = getPublishedOrganizationProjection(firstController.signal);
    const secondPromise = getPublishedOrganizationProjection(secondController.signal);

    firstController.abort();
    await expect(firstPromise).rejects.toThrow();

    resolveResponse(
      new Response(JSON.stringify(mockProjection), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );

    const secondResult = await secondPromise;
    expect(secondResult).toEqual(mockProjection);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
