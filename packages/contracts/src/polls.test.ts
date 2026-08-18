import { describe, expect, it } from "vitest";

import {
  organizationPollRequestSchema,
  organizationPollResultsResponseSchema,
  organizationPollSummarySchema,
} from "./polls";

const validPoll = {
  expiresAt: "2026-08-11T12:34:56.000Z",
  options: [
    { id: "a0000000-0000-4000-8000-000000000001", label: "Yes", sortOrder: 0 },
    { id: "a0000000-0000-4000-8000-000000000002", label: "No", sortOrder: 1 },
  ],
  title: "Attend?",
};

describe("organization poll request", () => {
  it("requires an expiration date and time", () => {
    expect(organizationPollRequestSchema.safeParse(validPoll).success).toBe(true);
    expect(organizationPollRequestSchema.safeParse({ ...validPoll, expiresAt: "" }).success).toBe(
      false,
    );
    const withoutExpiration: Record<string, unknown> = { ...validPoll };
    delete withoutExpiration.expiresAt;
    expect(organizationPollRequestSchema.safeParse(withoutExpiration).success).toBe(false);
  });
});

describe("organization poll results", () => {
  it("validates poll results with respondent rosters", () => {
    const validResults = {
      archivedAt: "",
      createdAt: "2026-08-11T12:00:00.000Z",
      description: "Please vote",
      expiresAt: "2026-08-11T12:34:56.000Z",
      multipleChoice: false,
      options: [
        {
          count: 1,
          id: "a0000000-0000-4000-8000-000000000001",
          label: "Yes",
          percentage: 100,
          respondents: [
            {
              profileId: "b0000000-0000-4000-8000-000000000001",
              profileName: "Jane Singer",
              respondedAt: "2026-08-11T12:10:00.000Z",
              voicePart: "Soprano 1",
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
      totalResponses: 1,
    };
    expect(organizationPollResultsResponseSchema.safeParse(validResults).success).toBe(true);
  });

  it("validates poll summary with option tallies", () => {
    const summary = {
      archivedAt: "",
      createdAt: "2026-08-11T12:00:00.000Z",
      expiresAt: "2026-08-11T12:34:56.000Z",
      id: "c0000000-0000-4000-8000-000000000001",
      optionTallies: [
        {
          count: 4,
          id: "a0000000-0000-4000-8000-000000000001",
          label: "Option A",
        },
      ],
      responseCount: 4,
      title: "Poll title",
    };
    expect(organizationPollSummarySchema.safeParse(summary).success).toBe(true);
  });
});
