import { afterEach, expect, it, vi } from "vitest";
import { publicWebsiteSettingsResponseSchema } from "@choir/contracts";
import {
  getOrganizationPublicWebsiteSettings,
  updateOrganizationPublicWebsiteSettings,
} from "./public";

const settings = publicWebsiteSettingsResponseSchema.parse({
  organizationName: "Alpha Choir",
  publicationVersion: 0,
  publishedAt: null,
  updatedAt: new Date().toISOString(),
  requestId: "11111111-1111-4111-8111-111111111111",
  footerText: "Our supporters",
  footerEmbeds: [{ kind: "image", title: "Our badge", src: "https://example.org/badge.svg" }],
});
afterEach(() => vi.unstubAllGlobals());
it("round trips Organization footer content through the browser API parser", async () => {
  const mock = vi
    .fn<typeof fetch>()
    .mockImplementation(() => Promise.resolve(Response.json(settings)));
  vi.stubGlobal("fetch", mock);
  await expect(updateOrganizationPublicWebsiteSettings(settings)).resolves.toMatchObject({
    footerText: settings.footerText,
    footerEmbeds: settings.footerEmbeds,
  });
  const body = mock.mock.calls[0]?.[1]?.body;
  if (typeof body !== "string") throw new Error("Missing settings body");
  expect(JSON.parse(body)).toMatchObject({
    footerEmbeds: settings.footerEmbeds,
  });
});
it("accepts older response payloads and rejects unsafe embed responses", async () => {
  const older = { ...settings };
  delete older.footerText;
  delete older.footerEmbeds;
  const mock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(older))
    .mockResolvedValueOnce(
      Response.json({
        ...settings,
        footerEmbeds: [{ ...settings.footerEmbeds?.[0], src: "javascript:bad()" }],
      }),
    );
  vi.stubGlobal("fetch", mock);
  await expect(getOrganizationPublicWebsiteSettings()).resolves.toMatchObject({
    organizationName: "Alpha Choir",
  });
  await expect(getOrganizationPublicWebsiteSettings()).rejects.toThrow();
});
it("preserves authorization errors", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { code: "forbidden", detail: "Administrator access required" },
          { status: 403 },
        ),
      ),
  );
  await expect(getOrganizationPublicWebsiteSettings()).rejects.toMatchObject({ status: 403 });
});
