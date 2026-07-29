import { describe, expect, it } from "vitest";
import { renderCalendarIcs, CalendarProjectionEvent } from "./calendarIcs";

describe("renderCalendarIcs", () => {
  const defaultProjection = {
    events: [],
    generatedAt: new Date("2024-01-01T12:00:00Z"),
    organizationName: "Test Choir",
    profileName: "John Doe",
    timezone: "America/New_York",
  };

  it("renders an empty calendar correctly", () => {
    const ics = renderCalendarIcs(defaultProjection);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("X-WR-CALNAME:Test Choir");
    expect(ics).toContain("X-WR-CALDESC:Personal schedule for John Doe");
    expect(ics).toContain("END:VCALENDAR");
  });

  it("escapes ICS text correctly", () => {
    const event: CalendarProjectionEvent = {
      callTime: "",
      details: "This is a test\nwith newlines, commas, and semi;colons\\",
      durationMinutes: 60,
      id: "event-1",
      location: "Location, NY",
      resolvedRsvp: "Yes",
      setListApproved: false,
      setListJson: "[]",
      startsAt: "2024-01-01T10:00:00Z",
      title: "Test, Event; with \\ backslash",
      type: "Rehearsal",
      venueAddress: "",
      venueName: "",
    };
    const projection = { ...defaultProjection, events: [event] };
    const ics = renderCalendarIcs(projection);

    // Testing title escaping
    expect(ics).toContain("SUMMARY:Test\\, Event\\; with \\\\ backslash");
    // Testing location escaping
    expect(ics).toContain("LOCATION:Location\\, NY");
    // Testing description details escaping
    expect(ics).toContain(
      "Details:\\nThis is a test\\nwith newlines\\, commas\\, and semi\\;colons\\\\",
    );
  });

  it("generates a basic event with start and end times", () => {
    const event: CalendarProjectionEvent = {
      callTime: "",
      details: "",
      durationMinutes: 90,
      id: "event-1",
      location: "Rehearsal Hall",
      resolvedRsvp: "Pending",
      setListApproved: false,
      setListJson: "[]",
      startsAt: "2024-01-01T10:00:00Z",
      title: "Weekly Rehearsal",
      type: "Rehearsal",
      venueAddress: "",
      venueName: "",
    };
    const projection = { ...defaultProjection, events: [event] };
    const ics = renderCalendarIcs(projection);

    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:event-event-1@choir-management.local");
    expect(ics).toContain("DTSTAMP:20240101T120000Z");
    expect(ics).toContain("DTSTART:20240101T100000Z");
    expect(ics).toContain("DTEND:20240101T113000Z"); // 90 mins after 10:00
    expect(ics).toContain("SUMMARY:Weekly Rehearsal");
    expect(ics).toContain("LOCATION:Rehearsal Hall");
    expect(ics).toContain("END:VEVENT");
  });

  it("uses default durations if durationMinutes is null", () => {
    const performanceEvent: CalendarProjectionEvent = {
      callTime: "",
      details: "",
      durationMinutes: null,
      id: "perf-1",
      location: "Concert Hall",
      resolvedRsvp: "Yes",
      setListApproved: false,
      setListJson: "[]",
      startsAt: "2024-01-01T19:00:00Z",
      title: "Spring Concert",
      type: "Performance",
      venueAddress: "",
      venueName: "",
    };

    const rehearsalEvent: CalendarProjectionEvent = {
      callTime: "",
      details: "",
      durationMinutes: null,
      id: "reh-1",
      location: "Rehearsal Hall",
      resolvedRsvp: "Yes",
      setListApproved: false,
      setListJson: "[]",
      startsAt: "2024-01-02T19:00:00Z",
      title: "Weekly Rehearsal",
      type: "Rehearsal",
      venueAddress: "",
      venueName: "",
    };

    const projection = { ...defaultProjection, events: [performanceEvent, rehearsalEvent] };
    const ics = renderCalendarIcs(projection);

    // Performance default is 150 mins
    expect(ics).toContain("DTSTART:20240101T190000Z");
    expect(ics).toContain("DTEND:20240101T213000Z"); // 19:00 + 150m

    // Rehearsal default is 120 mins
    expect(ics).toContain("DTSTART:20240102T190000Z");
    expect(ics).toContain("DTEND:20240102T210000Z"); // 19:00 + 120m
  });

  it("ignores events with invalid start times", () => {
    const event: CalendarProjectionEvent = {
      callTime: "",
      details: "",
      durationMinutes: 60,
      id: "event-invalid",
      location: "",
      resolvedRsvp: "Yes",
      setListApproved: false,
      setListJson: "[]",
      startsAt: "invalid-date",
      title: "Invalid Event",
      type: "Rehearsal",
      venueAddress: "",
      venueName: "",
    };
    const projection = { ...defaultProjection, events: [event] };
    const ics = renderCalendarIcs(projection);

    expect(ics).not.toContain("BEGIN:VEVENT");
    expect(ics).not.toContain("Invalid Event");
  });

  it("combines venueName and venueAddress for location if present", () => {
    const event: CalendarProjectionEvent = {
      callTime: "",
      details: "",
      durationMinutes: 60,
      id: "event-loc",
      location: "Fallback Location",
      resolvedRsvp: "Yes",
      setListApproved: false,
      setListJson: "[]",
      startsAt: "2024-01-01T10:00:00Z",
      title: "Event",
      type: "Rehearsal",
      venueAddress: "123 Main St",
      venueName: "Great Hall",
    };
    const projection = { ...defaultProjection, events: [event] };
    const ics = renderCalendarIcs(projection);

    expect(ics).toContain("LOCATION:Great Hall\\, 123 Main St");
  });

  it("generates a call time event if call time is before start time", () => {
    const event: CalendarProjectionEvent = {
      callTime: "18:00", // Call time
      details: "",
      durationMinutes: 120,
      id: "event-call",
      location: "",
      resolvedRsvp: "Yes",
      setListApproved: false,
      setListJson: "[]",
      startsAt: "2024-01-01T23:30:00Z", // 18:30 in America/New_York
      title: "Concert",
      type: "Performance",
      venueAddress: "",
      venueName: "",
    };
    const projection = { ...defaultProjection, timezone: "America/New_York", events: [event] };
    const ics = renderCalendarIcs(projection);

    // Call time event
    expect(ics).toContain("UID:call-event-event-call@choir-management.local");
    expect(ics).toContain("DTSTART:20240101T230000Z"); // 18:00 EST -> 23:00 UTC
    expect(ics).toContain("DTEND:20240101T233000Z"); // 18:30 EST -> 23:30 UTC
    expect(ics).toContain("SUMMARY:Call Time: Concert");
    expect(ics).toContain("DESCRIPTION:Arrival and warm-up for Concert.");

    // Main event
    expect(ics).toContain("UID:event-event-call@choir-management.local");
    expect(ics).toContain("DTSTART:20240101T233000Z"); // 18:30 EST
  });

  it("does not generate call time event if call time is after or equal to start time", () => {
    const event: CalendarProjectionEvent = {
      callTime: "19:00", // Call time after start time
      details: "",
      durationMinutes: 120,
      id: "event-late-call",
      location: "",
      resolvedRsvp: "Yes",
      setListApproved: false,
      setListJson: "[]",
      startsAt: "2024-01-01T23:30:00Z", // 18:30 in America/New_York
      title: "Concert",
      type: "Performance",
      venueAddress: "",
      venueName: "",
    };
    const projection = { ...defaultProjection, timezone: "America/New_York", events: [event] };
    const ics = renderCalendarIcs(projection);

    expect(ics).not.toContain("UID:call-event-event-late-call@choir-management.local");
  });

  it("renders RSVP status and details in description", () => {
    const event: CalendarProjectionEvent = {
      callTime: "",
      details: "Wear concert black.",
      durationMinutes: 120,
      id: "event-rsvp",
      location: "",
      resolvedRsvp: "Pending",
      setListApproved: false,
      setListJson: "[]",
      startsAt: "2024-01-01T10:00:00Z",
      title: "Event",
      type: "Rehearsal",
      venueAddress: "",
      venueName: "",
    };
    const projection = { ...defaultProjection, events: [event] };
    const ics = renderCalendarIcs(projection);

    expect(ics).toContain(
      "DESCRIPTION:Type: Rehearsal\\nYour Status: Pending RSVP\\n\\nDetails:\\nWear concert black.",
    );
  });

  it("renders set list if approved, RSVP is Yes, and set list is not empty", () => {
    const event: CalendarProjectionEvent = {
      callTime: "",
      details: "",
      durationMinutes: 120,
      id: "event-setlist",
      location: "",
      resolvedRsvp: "Yes",
      setListApproved: true,
      setListJson: JSON.stringify([
        { title: "Song 1", composer: "Composer A", isFeaturedNumber: false },
        {
          title: "Song 2",
          composer: "",
          soloSmallGroup: true,
          performerCredits: [{ displayName: "Jane Doe" }],
        },
        {
          title: "Song 3",
          isFeaturedNumber: true,
          performerCredits: [{ displayName: "John Doe" }, { displayName: "Jane Doe" }],
        },
        { title: "Intermission", type: "intermission" },
        { title: "Song 5", isFeaturedNumber: true, performerCredits: [] },
      ]),
      startsAt: "2024-01-01T10:00:00Z",
      title: "Event",
      type: "Performance",
      venueAddress: "",
      venueName: "",
    };
    const projection = { ...defaultProjection, events: [event] };
    const ics = renderCalendarIcs(projection);

    const description =
      "DESCRIPTION:Type: Performance\\nYour Status: Attending\\n\\nSet List:\\n" +
      "1. Song 1 (Composer A)\\n" +
      "2. Song 2\\n   Solo — Jane Doe\\n" +
      "3. Song 3\\n   Group — John Doe\\, Jane Doe\\n" +
      "4. Intermission\\n" +
      "5. Song 5\\n   Featured Number — Performers TBA";

    expect(ics).toContain(description);
  });

  it("ignores set list if not approved", () => {
    const event: CalendarProjectionEvent = {
      callTime: "",
      details: "",
      durationMinutes: 120,
      id: "event-no-setlist",
      location: "",
      resolvedRsvp: "Yes",
      setListApproved: false,
      setListJson: JSON.stringify([{ title: "Song 1" }]),
      startsAt: "2024-01-01T10:00:00Z",
      title: "Event",
      type: "Performance",
      venueAddress: "",
      venueName: "",
    };
    const projection = { ...defaultProjection, events: [event] };
    const ics = renderCalendarIcs(projection);

    expect(ics).not.toContain("Set List:");
  });

  it("ignores set list if RSVP is not Yes", () => {
    const event: CalendarProjectionEvent = {
      callTime: "",
      details: "",
      durationMinutes: 120,
      id: "event-no-setlist-rsvp",
      location: "",
      resolvedRsvp: "Pending",
      setListApproved: true,
      setListJson: JSON.stringify([{ title: "Song 1" }]),
      startsAt: "2024-01-01T10:00:00Z",
      title: "Event",
      type: "Performance",
      venueAddress: "",
      venueName: "",
    };
    const projection = { ...defaultProjection, events: [event] };
    const ics = renderCalendarIcs(projection);

    expect(ics).not.toContain("Set List:");
  });
});
