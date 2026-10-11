import { describe, expect, it } from "vitest";

import { eventRsvpExportFilename, renderEventRsvpCsv } from "./eventRsvpCsv";
import { lastNameSortKey } from "./name";

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
        "Name,Last Name,Section,Performer,Event Title,RSVP Status",
        '"Attending (Yes)",,,,,',
        '"John Doe","Doe","Sopranos","S1","Spring Concert 2026!","Yes"',
        "",
        '"Declined (No)",,,,,',
        '"\'=Alice Smith","Smith","Altos","A1","Spring Concert 2026!","No"',
        "",
        '"No Response (Pending)",,,,,',
        '"No Voice","Voice","Unassigned","Not sure","Spring Concert 2026!","Pending"',
        "",
        "Section Leaders,,,,,",
        "Name,Last Name,Section,Performer,Event Title,RSVP Status",
        '"John Doe","Doe","Sopranos","S1","Spring Concert 2026!","Yes"',
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
    ).toBe("Name,Last Name,Section,Performer,Event Title,RSVP Status");
  });

  it("normalizes compound surnames and suffixes with the shared export rule", () => {
    expect(lastNameSortKey("Mary Van Dyke")).toBe("van dyke");
    expect(lastNameSortKey("Sarah Van Dyke")).toBe("van dyke");
    expect(lastNameSortKey("Mary Ann Smith")).toBe("smith");
    expect(lastNameSortKey("Maria de la Cruz")).toBe("de la cruz");
    expect(lastNameSortKey("John Smith Jr.")).toBe("smith");
  });

  it("ensures uniform 6-column counts across all rows including separators", () => {
    const csv = renderEventRsvpCsv({
      eventTitle: "Spring Concert",
      sections: [{ code: "S", name: "Sopranos" }],
      singers: [
        { displayName: "Sarah Van Dyke", isSectionLeader: true, rsvp: "Yes", voicePart: "S1" },
        { displayName: "Mary Ann Smith", isSectionLeader: false, rsvp: "No", voicePart: "S1" },
      ],
      sort: "lastName",
      voiceParts: [{ label: "S1", sectionCode: "S" }],
    });
    const lines = csv.split("\n").filter(Boolean);
    for (const line of lines) {
      expect(line.split(",").length).toBeGreaterThanOrEqual(6);
    }
  });
});
