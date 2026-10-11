import { describe, expect, it } from "vitest";

import type { OrganizationPollResultsResponse } from "@choir/contracts";

import { buildPollResultsCsvRows } from "./pollResultsCsv";

function resultsFixture(): OrganizationPollResultsResponse {
  return {
    archivedAt: "",
    createdAt: "2026-08-11T12:00:00.000Z",
    description: "Please vote",
    expiresAt: "2026-08-11T12:34:56.000Z",
    multipleChoice: false,
    options: [
      {
        count: 4,
        id: "a0000000-0000-4000-8000-000000000001",
        label: "Yes",
        percentage: 100,
        respondents: [
          {
            profileId: "b0000000-0000-4000-8000-000000000001",
            profileName: "Sarah Van Dyke",
            respondedAt: "2026-08-11T12:10:00.000Z",
            voicePart: "S1",
          },
          {
            profileId: "b0000000-0000-4000-8000-000000000002",
            profileName: "Mary Ann Smith",
            respondedAt: "2026-08-11T12:11:00.000Z",
            voicePart: "A1",
          },
          {
            profileId: "b0000000-0000-4000-8000-000000000003",
            profileName: "Maria de la Cruz",
            respondedAt: "2026-08-11T12:12:00.000Z",
            voicePart: "T1",
          },
          {
            profileId: "b0000000-0000-4000-8000-000000000004",
            profileName: "John Smith Jr.",
            respondedAt: "2026-08-11T12:13:00.000Z",
            voicePart: "B1",
          },
        ],
        sortOrder: 0,
      },
      {
        count: 0,
        id: "a0000000-0000-4000-8000-000000000002",
        label: "No",
        percentage: 0,
        respondents: [],
        sortOrder: 1,
      },
    ],
    pollId: "c0000000-0000-4000-8000-000000000001",
    requestId: "d0000000-0000-4000-8000-000000000001",
    title: "Attend?",
    totalResponses: 4,
  };
}

describe("poll results CSV export", () => {
  it("places Last Name directly after Respondent Name", () => {
    const [header] = buildPollResultsCsvRows(resultsFixture());
    expect(header).toEqual([
      "Poll Title",
      "Option",
      "Votes",
      "Percentage",
      "Respondent Name",
      "Last Name",
      "Voice Part",
      "Responded At",
    ]);
  });

  it("emits compound surnames, middle names, and suffixes in Last Name", () => {
    const rows = buildPollResultsCsvRows(resultsFixture());
    expect(rows).toContainEqual([
      "Attend?",
      "Yes",
      "4",
      "100%",
      "Sarah Van Dyke",
      "Van Dyke",
      "S1",
      "2026-08-11T12:10:00.000Z",
    ]);
    expect(rows).toContainEqual([
      "Attend?",
      "Yes",
      "4",
      "100%",
      "Mary Ann Smith",
      "Smith",
      "A1",
      "2026-08-11T12:11:00.000Z",
    ]);
    expect(rows).toContainEqual([
      "Attend?",
      "Yes",
      "4",
      "100%",
      "Maria de la Cruz",
      "de la Cruz",
      "T1",
      "2026-08-11T12:12:00.000Z",
    ]);
    expect(rows).toContainEqual([
      "Attend?",
      "Yes",
      "4",
      "100%",
      "John Smith Jr.",
      "Smith",
      "B1",
      "2026-08-11T12:13:00.000Z",
    ]);
  });

  it("keeps uniform 8-column counts including empty options", () => {
    const rows = buildPollResultsCsvRows(resultsFixture());
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      expect(row).toHaveLength(8);
    }
    expect(rows.at(-1)).toEqual(["Attend?", "No", "0", "0%", "", "", "", ""]);
  });
});
