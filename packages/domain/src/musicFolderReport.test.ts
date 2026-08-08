import { describe, expect, it } from "vitest";

import {
  calculateMusicFolderCounts,
  deriveMusicFolderStatus,
  normalizeFolderNumber,
  normalizedFolderNumberKey,
  renderMusicFolderReportCsv,
  sortMusicFolderProfiles,
} from "./musicFolderReport";

describe("music folder report domain rules", () => {
  it("derives the four report states", () => {
    expect(deriveMusicFolderStatus("A-12", false)).toBe("outstanding");
    expect(deriveMusicFolderStatus(" A-12 ", true)).toBe("returned");
    expect(deriveMusicFolderStatus("", false)).toBe("not_assigned");
    expect(deriveMusicFolderStatus("A-12", true, false)).toBe("not_applicable");
  });

  it("normalizes folder values without changing stored display text", () => {
    expect(normalizeFolderNumber("  A-12  ")).toBe("A-12");
    expect(normalizedFolderNumberKey("  A-12  ")).toBe("a-12");
    expect(normalizedFolderNumberKey("a-12")).toBe("a-12");
  });

  it("excludes not applicable and not assigned from the return denominator", () => {
    expect(
      calculateMusicFolderCounts([
        { status: "returned" },
        { status: "outstanding" },
        { status: "not_assigned" },
        { status: "not_applicable" },
      ]),
    ).toEqual({
      assigned: 2,
      notAssigned: 1,
      outstanding: 1,
      returnRate: 0.5,
      returned: 1,
    });
  });

  it("sorts by last name and then stable identity", () => {
    expect(
      sortMusicFolderProfiles([
        { displayName: "Zoe Adams", profileId: "2" },
        { displayName: "Amy Smith", profileId: "3" },
        { displayName: "Aaron Smith", profileId: "1" },
      ]).map((profile) => profile.profileId),
    ).toEqual(["2", "1", "3"]);
  });

  it("renders formula-safe, ordered CSV", () => {
    expect(
      renderMusicFolderReportCsv([
        {
          eventTitle: "Spring, Gala",
          folderNumber: "=12",
          isArchived: false,
          isCanceled: false,
          profileName: "Zoe Adams",
          returnedAt: null,
          startsAt: "2026-05-01T00:00:00.000Z",
          status: "outstanding",
        },
        {
          eventTitle: "Winter",
          folderNumber: "A-1",
          isArchived: false,
          isCanceled: false,
          profileName: "Amy Smith",
          returnedAt: "2026-01-02T00:00:00.000Z",
          startsAt: "2026-01-02T00:00:00.000Z",
          status: "returned",
        },
      ]),
    ).toContain('"\'=12"');
    expect(renderMusicFolderReportCsv([])).toBe(
      '"Profile","Performance","Performance Start","Performance State","Folder Number","Folder Return Status","Returned At"\r\n',
    );
  });
});
