import { describe, expect, it } from "vitest";

import {
  changedFolderEdits,
  filterMusicFolderSummaries,
  folderRowKey,
  hasUnsavedFolderDrafts,
  musicFolderStatusLabel,
} from "./model";

const summary = {
  assigned: 2,
  displayName: "Ada Adams",
  globalStatus: "Active" as const,
  notAssigned: 1,
  outstanding: 1,
  profileId: "00000000-0000-4000-8000-000000000001",
  returnRate: 0.5,
  returned: 1,
};

const row = {
  eventId: "00000000-0000-4000-8000-000000000002",
  eventTitle: "Spring Concert",
  folderNumber: "A-12",
  folderReturned: false,
  isArchived: false,
  isCanceled: false,
  profileId: summary.profileId,
  returnedAt: null,
  startsAt: "2026-05-01T00:00:00.000Z",
  status: "outstanding" as const,
  updatedAt: "2026-05-01T00:00:00.000Z",
};

describe("music folder report browser model", () => {
  it("filters by name and status without changing summary values", () => {
    expect(filterMusicFolderSummaries([summary], "ada", "returned")).toHaveLength(1);
    expect(filterMusicFolderSummaries([summary], "ada", "not-assigned")).toHaveLength(1);
    expect(filterMusicFolderSummaries([summary], "zoe", "all")).toHaveLength(0);
  });

  it("keeps only changed, applicable folder drafts", () => {
    const drafts = { [folderRowKey(row.profileId, row.eventId)]: " B-4 " };
    expect(changedFolderEdits([row], drafts)).toEqual([
      {
        eventId: row.eventId,
        expectedUpdatedAt: row.updatedAt,
        folderNumber: " B-4 ",
        profileId: row.profileId,
      },
    ]);
    expect(hasUnsavedFolderDrafts([row], drafts)).toBe(true);
  });

  it("uses explicit product labels", () => {
    expect(musicFolderStatusLabel("not_applicable")).toBe("Not Applicable");
    expect(musicFolderStatusLabel("not_assigned")).toBe("Not Assigned");
  });
});
