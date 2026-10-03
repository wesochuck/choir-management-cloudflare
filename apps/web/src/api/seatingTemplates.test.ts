import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSeatingConfiguration } from "@choir/domain";
import {
  getOrganizationSeatingConfiguration,
  updateOrganizationSeatingConfiguration,
} from "./organization";
const requestId = "11111111-1111-4111-8111-111111111111";
const configuration = {
  ...defaultSeatingConfiguration,
  formations: defaultSeatingConfiguration.formations.map((formation) => ({
    ...formation,
    sectionOrder: [...formation.sectionOrder],
  })),
  templates: [
    {
      id: requestId,
      name: "Reference",
      formation: {
        ...defaultSeatingConfiguration.formations[0],
        sectionOrder: ["S", "A", "T", "B"],
      },
      rowCounts: [1],
      assignments: [{ seatKey: "0-0", name: "Unresolved Singer" }],
    },
  ],
};
afterEach(() => {
  vi.unstubAllGlobals();
});
describe("seating template client parsing", () => {
  it("round-trips templates without dropping saved singer names", async () => {
    const mock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(Response.json({ configuration, requestId })));
    vi.stubGlobal("fetch", mock);
    await expect(getOrganizationSeatingConfiguration()).resolves.toEqual(configuration);
    await expect(updateOrganizationSeatingConfiguration(configuration)).resolves.toEqual(
      configuration,
    );
    const body = mock.mock.calls[1]?.[1]?.body;
    if (typeof body !== "string") throw new Error("Expected JSON configuration.");
    expect(JSON.parse(body)).toEqual(configuration);
  });
  it("accepts pre-template responses and rejects malformed saved templates", async () => {
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ configuration: defaultSeatingConfiguration, requestId }),
      )
      .mockResolvedValueOnce(
        Response.json({
          configuration: {
            ...configuration,
            templates: [{ ...configuration.templates[0], rowCounts: [] }],
          },
          requestId,
        }),
      );
    vi.stubGlobal("fetch", mock);
    await expect(getOrganizationSeatingConfiguration()).resolves.toEqual(
      defaultSeatingConfiguration,
    );
    await expect(getOrganizationSeatingConfiguration()).rejects.toThrow();
  });
  it("surfaces authorization failures without retrying a mutation", async () => {
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { code: "forbidden", message: "Only managers may save templates.", requestId },
          { status: 403 },
        ),
      );
    vi.stubGlobal("fetch", mock);
    await expect(updateOrganizationSeatingConfiguration(configuration)).rejects.toThrow(
      "Only managers may save templates.",
    );
    expect(mock).toHaveBeenCalledOnce();
  });
});
