import { describe, expect, it } from "vitest";
import {
  compilePublicationDeadline,
  publicationSubmissionStatus,
  type PublicationDeadlineRevision,
} from "./donationPublications";

// Fixed historical snapshots exercise policy history and DST, independently of today's date.
const initial: PublicationDeadlineRevision = {
  effectiveAt: "2024-03-01T00:00:00Z",
  deadlineDate: "2024-03-10",
  timezone: "America/New_York",
};

describe("publication submission eligibility", () => {
  it("keeps the whole Organization-local deadline date open across DST", () => {
    expect(publicationSubmissionStatus("2024-03-11T03:59:59.999Z", [initial])).toBe("on_time");
    expect(publicationSubmissionStatus("2024-03-11T04:00:00Z", [initial])).toBe("after_cutoff");
  });

  it("uses successful payment evidence rather than an absent/pending timestamp", () => {
    expect(publicationSubmissionStatus(null, [initial])).toBe("pending");
    expect(publicationSubmissionStatus(null, [])).toBe("unconfigured");
  });

  it("reevaluates late submissions after an extension", () => {
    const extension = {
      ...initial,
      effectiveAt: "2024-03-13T00:00:00Z",
      deadlineDate: "2024-03-15",
    };
    expect(publicationSubmissionStatus("2024-03-12T12:00:00Z", [initial, extension])).toBe(
      "on_time",
    );
  });

  it("preserves on-time submissions after shortening, but applies the new policy going forward", () => {
    const shortening = {
      ...initial,
      effectiveAt: "2024-03-09T12:00:00Z",
      deadlineDate: "2024-03-08",
    };
    expect(publicationSubmissionStatus("2024-03-09T11:00:00Z", [initial, shortening])).toBe(
      "on_time",
    );
    expect(publicationSubmissionStatus("2024-03-09T13:00:00Z", [initial, shortening])).toBe(
      "after_cutoff",
    );
  });

  it("does not impose a newly configured date on older submissions", () => {
    expect(publicationSubmissionStatus("2024-02-29T12:00:00Z", [initial])).toBe("unconfigured");
    expect(
      publicationSubmissionStatus("2024-03-12T12:00:00Z", [{ ...initial, deadlineDate: null }]),
    ).toBe("unconfigured");
  });

  it("rejects invalid evidence instead of silently treating it as on time", () => {
    expect(() => publicationSubmissionStatus("invalid", [initial])).toThrow();
  });
});

describe("compiled publication histories", () => {
  it("applies extensions to earlier facts but applies a later shortening to new facts", () => {
    const revisions = [
      initial,
      { ...initial, effectiveAt: "2024-03-12T00:00:00Z", deadlineDate: "2024-03-15" },
      { ...initial, effectiveAt: "2024-03-14T00:00:00Z", deadlineDate: "2024-03-13" },
    ];
    const compiled = compilePublicationDeadline(revisions);
    for (let day = 1; day <= 25; day++) {
      const at = `2024-03-${String(day).padStart(2, "0")}T12:00:00Z`;
      expect(compiled(at)).toBe(day <= 13 ? "on_time" : "after_cutoff");
    }
    expect(compilePublicationDeadline([{ ...initial, deadlineDate: null }])(null)).toBe(
      "unconfigured",
    );
  });
});
