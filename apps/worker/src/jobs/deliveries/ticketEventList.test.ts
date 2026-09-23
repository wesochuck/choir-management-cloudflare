import { describe, expect, it } from "vitest";

import { formatTicketBundleEventList } from "./ticketEventList";

describe("ticket bundle event list", () => {
  it("sorts by event time, breaks time ties by title, and formats venue details in the event timezone", () => {
    const eventList = formatTicketBundleEventList(
      [
        {
          id: "later",
          location: "",
          startsAt: "2027-06-02T01:00:00.000Z",
          title: "Later Performance",
          venueAddress: "",
          venueName: "Later Hall",
        },
        {
          id: "tie-z",
          location: "Second Stage",
          startsAt: "2027-05-02T01:00:00.000Z",
          title: "Zulu Performance",
          venueAddress: "",
          venueName: "Downtown Stage",
        },
        {
          id: "tie-a",
          location: "Old venue location",
          startsAt: "2027-05-02T01:00:00.000Z",
          title: "Alpha Performance",
          venueAddress: "12 Main St",
          venueName: "Community Hall",
        },
        {
          id: "fallback",
          location: "Choir Studio",
          startsAt: "2027-05-03T01:00:00.000Z",
          title: "Fallback Performance",
          venueAddress: "",
          venueName: "",
        },
      ],
      "America/New_York",
    );

    expect(eventList.indexOf("Alpha Performance")).toBeLessThan(
      eventList.indexOf("Zulu Performance"),
    );
    expect(eventList.indexOf("Zulu Performance")).toBeLessThan(
      eventList.indexOf("Fallback Performance"),
    );
    expect(eventList.indexOf("Fallback Performance")).toBeLessThan(
      eventList.indexOf("Later Performance"),
    );
    expect(eventList).toContain("Saturday, May 1, 2027 at 9:00 PM");
    expect(eventList).toContain("**Location:** Community Hall, 12 Main St");
    expect(eventList).toContain("**Location:** Downtown Stage, Second Stage");
    expect(eventList).toContain("**Location:** Choir Studio");
    expect(eventList).not.toContain("Old venue location");
  });

  it("returns an empty list when a notification has no included bundle events", () => {
    expect(formatTicketBundleEventList([], "UTC")).toBe("");
  });
});
