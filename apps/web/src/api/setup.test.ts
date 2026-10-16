import { afterEach, describe, expect, it, vi } from "vitest";
import { completeSetup } from "./setup";
import { AuthApiError } from "./client";

const fetchMock = vi.fn<typeof fetch>();
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function respond(body: unknown, status = 200) {
  vi.stubGlobal("fetch", fetchMock.mockResolvedValueOnce(Response.json(body, { status })));
}

describe("setup completion browser contract", () => {
  it("accepts the existing server completion response", async () => {
    respond({ completed: true });
    await expect(completeSetup()).resolves.toEqual({ completed: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/setup/complete",
      expect.objectContaining({ method: "POST", body: "{}" }),
    );
  });

  it.each([{}, { launched: true }, { completed: "true" }, { completed: null }])(
    "rejects malformed success responses: %j",
    async (body) => {
      respond(body);
      await expect(completeSetup()).rejects.toMatchObject({ code: "invalid_response_schema" });
    },
  );

  it.each([400, 401, 403, 409, 503])("preserves typed server failures (%s)", async (status) => {
    respond(
      {
        code: "setup_failed",
        message: "Setup needs attention.",
        requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
      status,
    );
    await expect(completeSetup()).rejects.toEqual(
      expect.objectContaining({ code: "setup_failed", message: "Setup needs attention.", status }),
    );
  });

  it("rejects server failures as the typed client error", async () => {
    respond({}, 503);
    await expect(completeSetup()).rejects.toBeInstanceOf(AuthApiError);
  });
});
