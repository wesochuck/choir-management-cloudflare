import { afterEach, expect, it, vi } from "vitest";
import { organizationProfileRequestSchema, organizationProfileSchema } from "@choir/contracts";
import {
  createOrganizationProfile,
  deleteOrganizationProfile,
  importOrganizationProfilesCsv,
  updateOrganizationProfile,
} from "./profiles";

const profile = organizationProfileSchema.parse({
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "Roster Person",
  email: "person@example.test",
  phone: "+12025550123",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});
const requestId = "22222222-2222-4222-8222-222222222222";
afterEach(() => vi.unstubAllGlobals());

it("sends contact email on save, including explicit removal, independently of account identity", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ ...profile, requestId }));
  vi.stubGlobal("fetch", fetchMock);
  expect(
    await createOrganizationProfile(organizationProfileRequestSchema.parse(profile)),
  ).toMatchObject({ email: profile.email, phone: profile.phone });
  expect(fetchMock.mock.calls[0]?.[1]?.body).toContain('"email":"person@example.test"');
  fetchMock.mockResolvedValue(Response.json({ ...profile, email: "", requestId }));
  expect(
    await updateOrganizationProfile(profile.id, {
      ...organizationProfileRequestSchema.parse(profile),
      email: "",
    }),
  ).toMatchObject({ email: "", phone: profile.phone });
  expect(fetchMock.mock.calls[1]?.[1]?.body).toContain('"email":""');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it("returns actual import outcomes and actionable conflicting rows", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        requestId,
        imported: 1,
        emailsPersisted: 1,
        phonesPersisted: 1,
        conflicts: [{ row: 3, message: "Email already belongs to a Contact." }],
      }),
    ),
  );
  expect(
    await importOrganizationProfilesCsv("Name,Email\nPerson,person@example.test"),
  ).toMatchObject({ emailsPersisted: 1, conflicts: [{ row: 3 }] });
});
it.each([400, 401, 403])("preserves validation and authorization failures (%s)", async (status) => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { requestId, code: "contact_duplicate_email", message: "Resolve the existing Contact." },
          { status },
        ),
      ),
  );
  await expect(
    createOrganizationProfile(organizationProfileRequestSchema.parse(profile)),
  ).rejects.toMatchObject({ status, code: "contact_duplicate_email" });
});

it.each(["keep", "delete_unused"] as const)(
  "sends explicit profile deletion contact choice %s",
  async (contacts) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ deleted: true, profileId: profile.id, requestId }));
    vi.stubGlobal("fetch", fetchMock);
    await deleteOrganizationProfile(profile.id, { contacts });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/organization/profiles/${profile.id}?contacts=${contacts}`,
      expect.objectContaining({ method: "DELETE" }),
    );
  },
);
it("defaults old browser callers to retaining Contacts", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ deleted: true, profileId: profile.id, requestId }));
  vi.stubGlobal("fetch", fetchMock);
  await deleteOrganizationProfile(profile.id);
  expect(fetchMock.mock.calls[0]?.[0]).toBe(
    `/api/organization/profiles/${profile.id}?contacts=keep`,
  );
});
it.each([400, 401, 403, 409, 503])("preserves profile deletion errors (%s)", async (status) => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          code: "deletion_blocked",
          message: "Keep the Contact or archive the Profile.",
          requestId,
        },
        { status },
      ),
    ),
  );
  await expect(deleteOrganizationProfile(profile.id)).rejects.toMatchObject({
    status,
    code: "deletion_blocked",
    message: "Keep the Contact or archive the Profile.",
  });
});
