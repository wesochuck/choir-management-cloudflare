import { describe, expect, it } from "vitest";
import { publicWebsiteSettingsRequestSchema, publicWebsiteSettingsSchema } from "./organization";
import {
  normalizedPublicWebsitePages,
  publicWebsitePagesSchema,
  isPublicContentPath,
  reservedPublicWebsiteSlugs,
} from "./publicWebsitePages";
const page = {
  id: "story",
  title: "Our story",
  slug: "our-story",
  body: "Sing together",
  showInNavigation: true,
};
describe("bounded website pages", () => {
  it("preserves omitted legacy History and distinct labels, but never regenerates an explicit deletion", () => {
    const legacy = {
      historyText: "History",
      pageLabels: { history: { heading: "Our beginnings", navigationLabel: "Story" } },
    };
    expect(normalizedPublicWebsitePages(legacy)).toEqual([
      {
        id: "legacy-history",
        title: "Our beginnings",
        slug: "history",
        body: "History",
        navigationLabel: "Story",
        showInNavigation: true,
      },
    ]);
    expect(normalizedPublicWebsitePages({ ...legacy, pages: [] })).toEqual([]);
    expect(normalizedPublicWebsitePages({ historyText: " " })).toEqual([]);
    expect(publicWebsiteSettingsRequestSchema.parse({}).pages).toBeUndefined();
    expect(publicWebsiteSettingsRequestSchema.parse({ pages: [] }).pages).toEqual([]);
  });
  it("validates identity, route ownership, and collection bounds", () => {
    expect(publicWebsitePagesSchema.safeParse([page]).success).toBe(true);
    expect(publicWebsitePagesSchema.safeParse([page, page]).success).toBe(false);
    expect(publicWebsitePagesSchema.safeParse([page, { ...page, id: "two" }]).success).toBe(false);
    for (const slug of [
      ...reservedPublicWebsiteSlugs,
      "A",
      "a/b",
      "%68istory",
      "a%2fb",
      "a.b",
      "a--b",
      "-a",
      "a-",
      "a?b",
      "a#b",
      "a\\b",
    ]) {
      expect(isPublicContentPath(`/${slug}`), slug).toBe(false);
    }
    expect(
      publicWebsitePagesSchema.safeParse(
        Array.from({ length: 51 }, (_, i) => ({
          ...page,
          id: String(i),
          slug: `page-${String(i)}`,
        })),
      ).success,
    ).toBe(false);
    expect(publicWebsitePagesSchema.safeParse([{ ...page, title: "a".repeat(121) }]).success).toBe(
      false,
    );
    expect(
      publicWebsitePagesSchema.safeParse([{ ...page, body: "a".repeat(100_001) }]).success,
    ).toBe(false);
  });
  it("enforces UTF-8 aggregate bytes as well as character limits", () => {
    const pages = Array.from({ length: 4 }, (_, i) => ({
      ...page,
      id: String(i),
      slug: `page-${String(i)}`,
      body: "é".repeat(80_000),
    }));
    expect(publicWebsiteSettingsRequestSchema.safeParse({ pages }).success).toBe(false);
    expect(
      publicWebsiteSettingsRequestSchema.safeParse({ pages: [{ ...page, body: "" }] }).success,
    ).toBe(true);
    expect(publicWebsiteSettingsRequestSchema.safeParse({ pages: null }).success).toBe(false);
  });
  it("counts content consistently at the byte limit without counting response or concurrency metadata", () => {
    const base = publicWebsiteSettingsRequestSchema.parse({
      pages: Array.from({ length: 4 }, (_, index) => ({
        ...page,
        id: String(index),
        slug: `page-${String(index)}`,
        body: "a".repeat(100_000),
      })),
    });
    const available = 500_000 - new TextEncoder().encode(JSON.stringify(base)).byteLength;
    const full = { ...base, aboutUsText: "a".repeat(available) };
    expect(
      publicWebsiteSettingsRequestSchema.safeParse({ ...full, expectedDraftRevision: 10 }).success,
    ).toBe(true);
    expect(
      publicWebsiteSettingsSchema.safeParse({
        ...full,
        organizationName: "Choir",
        publicationVersion: 1,
        publishedAt: null,
        draftRevision: 10,
        updatedAt: "2026-10-31T12:00:00Z",
      }).success,
    ).toBe(true);
    expect(
      publicWebsiteSettingsRequestSchema.safeParse({ ...full, aboutUsText: `${full.aboutUsText}a` })
        .success,
    ).toBe(false);
  });
});
