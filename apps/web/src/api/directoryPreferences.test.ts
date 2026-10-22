import { afterEach, expect, it, vi } from "vitest";
import { getMemberProfile, updateMemberProfile } from "./profiles";

const profile = {
  displayName: "Directory Singer",
  email: "singer@example.test",
  phone: "555-0100",
  globalStatus: "Active",
  id: "11111111-1111-4111-8111-111111111111",
  voicePart: "S1",
  requestId: "22222222-2222-4222-8222-222222222222",
};
afterEach(() => vi.unstubAllGlobals());

it("parses older profile responses with both directory contact settings on", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json(profile)));
  await expect(getMemberProfile()).resolves.toMatchObject({
    showEmailInDirectory: true,
    showPhoneInDirectory: true,
  });
});
it("sends and parses independent saved contact choices", async () => {
  const preferences = { showEmailInDirectory: false, showPhoneInDirectory: true };
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ ...profile, ...preferences }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(
    updateMemberProfile({
      displayName: profile.displayName,
      phone: profile.phone,
      showInDirectory: true,
      ...preferences,
    }),
  ).resolves.toMatchObject(preferences);
  expect(fetchMock.mock.calls[0]?.[1]?.body).toContain('"showEmailInDirectory":false');
});
it.each([null, "false"])("rejects invalid directory preference responses (%s)", async (value) => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ...profile, showEmailInDirectory: value })),
  );
  await expect(getMemberProfile()).rejects.toThrow();
});
it.each([400, 401, 403])("preserves HTTP errors while updating visibility (%s)", async (status) => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ code: "rejected", message: "Request rejected" }, { status }),
      ),
  );
  await expect(
    updateMemberProfile({
      displayName: profile.displayName,
      phone: profile.phone,
      showInDirectory: true,
      showEmailInDirectory: false,
    }),
  ).rejects.toMatchObject({ status });
});
