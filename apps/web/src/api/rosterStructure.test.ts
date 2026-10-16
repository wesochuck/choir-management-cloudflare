import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getOrganizationRosterConfiguration,
  updateOrganizationRosterConfiguration,
} from "./organization";
import { organizationRosterConfigurationRequestSchema } from "@choir/contracts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser roster structure contract", () => {
  const configuration = organizationRosterConfigurationRequestSchema.parse({
    rosterStructure: "sections_only",
    sections: [{ code: "F", name: "Flute", color: "#123456" }],
  });
  const requestId = "11111111-1111-4111-8111-111111111111";

  it("preserves the structure and normalized assignments on GET and PUT", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(Response.json({ ...configuration, requestId })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getOrganizationRosterConfiguration()).resolves.toEqual(configuration);
    await expect(updateOrganizationRosterConfiguration(configuration)).resolves.toEqual(
      configuration,
    );
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(JSON.stringify(configuration));
  });

  it.each([400, 401, 403, 409])("preserves failures from the API (%s)", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json(
            { code: "invalid_configuration", message: "Cannot save roster structure.", requestId },
            { status },
          ),
        ),
    );
    await expect(updateOrganizationRosterConfiguration(configuration)).rejects.toMatchObject({
      status,
    });
  });
});
