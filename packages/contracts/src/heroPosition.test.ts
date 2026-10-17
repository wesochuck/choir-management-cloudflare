import { expect, it } from "vitest";
import { publicWebsiteSettingsRequestSchema } from "./organization";

it("accepts old settings with omitted/undefined positions and bounded fractional focal points", () => {
  expect(publicWebsiteSettingsRequestSchema.parse({}).heroPosition).toBeUndefined();
  expect(
    publicWebsiteSettingsRequestSchema.parse({ heroPosition: undefined }).heroPosition,
  ).toBeUndefined();
  for (const heroPosition of [
    { x: 0, y: 100 },
    { x: 50.5, y: 25.25 },
  ])
    expect(publicWebsiteSettingsRequestSchema.parse({ heroPosition }).heroPosition).toEqual(
      heroPosition,
    );
});
it.each([null, { x: -1, y: 50 }, { x: 50, y: 101 }, { x: 50 }, { x: NaN, y: 50 }])(
  "rejects invalid focal points",
  (heroPosition) => {
    expect(publicWebsiteSettingsRequestSchema.safeParse({ heroPosition }).success).toBe(false);
  },
);
