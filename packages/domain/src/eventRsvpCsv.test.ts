import { describe, expect, it } from "vitest";

import { eventRsvpExportFilename, renderEventRsvpCsv } from "./eventRsvpCsv";

describe("event RSVP CSV", () => {
  it("preserves legacy grouping, section sorting, formula safety, leaders, and filename", () => {
    const csv = renderEventRsvpCsv({
      eventTitle: "Spring Concert 2026!",
      sections: [
        { code: "S", name: "Sopranos" },
        { code: "A", name: "Altos" },
      ],
      singers: [
        { displayName: "=Alice Smith", isSectionLeader: false, rsvp: "No", voicePart: "A1" },
        { displayName: "John Doe", isSectionLeader: true, rsvp: "Yes", voicePart: "S1" },
        { displayName: "No Voice", isSectionLeader: false, rsvp: "Pending", voicePart: "" },
      ],
      sort: "section",
      voiceParts: [
        { label: "S1", sectionCode: "S" },
        { label: "A1", sectionCode: "A" },
      ],
    });
    expect(csv).toBe(
      [
        "Name,Section,Voice Part,Event Title,RSVP Status",
        '"Attending (Yes)",,,,',
        '"John Doe","Sopranos","S1","Spring Concert 2026!","Yes"',
        "",
        '"Declined (No)",,,,',
        '"\'=Alice Smith","Altos","A1","Spring Concert 2026!","No"',
        "",
        '"No Response (Pending)",,,,',
        '"No Voice","Unassigned","Not sure","Spring Concert 2026!","Pending"',
        "",
        "Section Leaders",
        "Name,Section,Voice Part,Event Title,RSVP Status",
        '"John Doe","Sopranos","S1","Spring Concert 2026!","Yes"',
      ].join("\n"),
    );
    expect(eventRsvpExportFilename("Spring Concert 2026!", "Performance")).toBe(
      "spring_concert_2026__rsvp_export.csv",
    );
  });

  it("renders only the header for an empty roster", () => {
    expect(
      renderEventRsvpCsv({
        eventTitle: "Empty",
        sections: [],
        singers: [],
        sort: "lastName",
        voiceParts: [],
      }),
    ).toBe("Name,Section,Voice Part,Event Title,RSVP Status");
  });
});
