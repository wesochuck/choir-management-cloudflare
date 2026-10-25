import { expect, it } from "vitest";
import { publishedOrganizationProjectionSchema } from "./ticketing";

const projection = {
  generatedAt: "2026-10-25T12:00:00.000Z",
  organizationId: "organization-alpha",
  payload: {
    mediaFileIds: [],
    organizationName: "City Chorale",
    performances: [],
    settings: {},
    timezone: "America/New_York",
  },
  version: 1,
};

it("preserves configured public performer terminology through serialization", () => {
  const parsed = publishedOrganizationProjectionSchema.parse({
    ...projection,
    payload: { ...projection.payload, performerLabel: " Singer " },
  });
  expect(parsed.payload.performerLabel).toBe("Singer");
  expect(
    publishedOrganizationProjectionSchema.parse(JSON.parse(JSON.stringify(parsed))).payload
      .performerLabel,
  ).toBe("Singer");
});

it("accepts older published projections with omitted or undefined terminology", () => {
  expect(
    publishedOrganizationProjectionSchema.parse(projection).payload.performerLabel,
  ).toBeUndefined();
  expect(
    publishedOrganizationProjectionSchema.parse({
      ...projection,
      payload: { ...projection.payload, performerLabel: undefined },
    }).payload.performerLabel,
  ).toBeUndefined();
});

it.each([null, "", "   ", "x".repeat(51), 42])(
  "rejects invalid public performer terminology: %s",
  (performerLabel) => {
    expect(
      publishedOrganizationProjectionSchema.safeParse({
        ...projection,
        payload: { ...projection.payload, performerLabel },
      }).success,
    ).toBe(false);
  },
);
