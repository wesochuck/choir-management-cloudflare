import { afterEach, expect, it, vi } from "vitest";
import { listOrganizationEventAttendance } from "./events";

const eventId = "11111111-1111-4111-8111-111111111111";
const profileId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const row = {
  profileId,
  displayName: "Singer",
  rsvp: "Yes",
  attendance: "Pending",
  updatedAt: null,
};
afterEach(() => vi.unstubAllGlobals());

it.each([
  undefined,
  null,
  { missedRehearsals: 3, threshold: 2, totalRehearsals: 5, status: "warning" },
])(
  "parses seating attendance metadata %j, including older responses",
  async (attendanceWarning) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ eventId, requestId, rows: [{ ...row, attendanceWarning }] }),
        ),
    );
    expect((await listOrganizationEventAttendance(eventId))[0]?.attendanceWarning).toEqual(
      attendanceWarning,
    );
  },
);
it("rejects malformed server metadata", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        eventId,
        requestId,
        rows: [{ ...row, attendanceWarning: { missedRehearsals: -1 } }],
      }),
    ),
  );
  await expect(listOrganizationEventAttendance(eventId)).rejects.toThrow();
});
it.each([400, 401, 403])("preserves validation/authorization errors (%s)", async (status) => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { requestId, code: "forbidden", message: "Attendance access denied." },
          { status },
        ),
      ),
  );
  await expect(listOrganizationEventAttendance(eventId)).rejects.toMatchObject({
    status,
    message: "Attendance access denied.",
  });
});
