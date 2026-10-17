import { expect, it } from "vitest";
import { publicWebsiteSettingsRequestSchema } from "./organization";

it("keeps existing settings valid and accepts independent public labels and headings", () => {
  expect(publicWebsiteSettingsRequestSchema.parse({}).pageLabels).toBeUndefined();
  expect(
    publicWebsiteSettingsRequestSchema.parse({ pageLabels: undefined }).pageLabels,
  ).toBeUndefined();
  expect(
    publicWebsiteSettingsRequestSchema.parse({
      pageLabels: {
        history: { navigationLabel: "Our story", heading: "How we began" },
        auditions: { navigationLabel: "Join" },
      },
    }).pageLabels,
  ).toEqual({
    history: { navigationLabel: "Our story", heading: "How we began" },
    auditions: { navigationLabel: "Join" },
  });
});
it.each([
  null,
  { history: null },
  { history: { heading: " " } },
  { tickets: { navigationLabel: "x".repeat(61) } },
])("rejects invalid public page labels", (pageLabels) => {
  expect(publicWebsiteSettingsRequestSchema.safeParse({ pageLabels }).success).toBe(false);
});
