import { describe, expect, it } from "vitest";
import type { CommunicationScheduledMessage } from "@choir/contracts";
import { parseCommunicationSearch, scheduledMessageActionLink } from "./utils";

describe("parseCommunicationSearch", () => {
  it("requires performer parts and compose mode for an RSVP request, and gives drafts precedence", () => {
    expect(
      parseCommunicationSearch("?tab=compose&rsvpEventId=event-1&rsvpPart=S1&rsvpPart=S1&rsvpPart=")
        .rsvpRequest,
    ).toEqual({ eventId: "event-1", voiceParts: ["S1"], globalStatuses: ["Active"] });
    expect(
      parseCommunicationSearch("?tab=compose&rsvpEventId=event-1").rsvpRequest,
    ).toBeUndefined();
    expect(
      parseCommunicationSearch("?rsvpEventId=event-1&rsvpPart=S1").rsvpRequest,
    ).toBeUndefined();
    expect(
      parseCommunicationSearch("?tab=compose&draftId=draft-1&rsvpEventId=event-1&rsvpPart=S1")
        .rsvpRequest,
    ).toBeUndefined();
  });
  it("preserves selected RSVP statuses and rejects invalid-only selections", () => {
    expect(
      parseCommunicationSearch(
        "?tab=compose&rsvpEventId=event-1&rsvpPart=S1&rsvpStatus=Idle&rsvpStatus=Inactive&rsvpStatus=Idle",
      ).rsvpRequest?.globalStatuses,
    ).toEqual(["Idle", "Inactive"]);
    expect(
      parseCommunicationSearch("?tab=compose&rsvpEventId=event-1&rsvpPart=S1&rsvpStatus=invalid")
        .rsvpRequest,
    ).toBeUndefined();
  });
  it("defaults to all status, all origins, and messages list for empty search", () => {
    const res = parseCommunicationSearch("");
    expect(res).toEqual({
      draftId: null,
      messageMode: "list",
      originFilter: "all",
      section: "messages",
      statusFilter: "all",
    });
  });

  it("handles legacy tab=drafts", () => {
    const res = parseCommunicationSearch("?tab=drafts");
    expect(res.statusFilter).toBe("draft");
    expect(res.originFilter).toBe("all");
    expect(res.section).toBe("messages");
    expect(res.messageMode).toBe("list");
  });

  it("handles legacy tab=upcoming", () => {
    const res = parseCommunicationSearch("?tab=upcoming");
    expect(res.statusFilter).toBe("scheduled");
    expect(res.originFilter).toBe("all");
    expect(res.section).toBe("messages");
  });

  it("handles legacy tab=history", () => {
    const res = parseCommunicationSearch("?tab=history");
    expect(res.statusFilter).toBe("all");
    expect(res.originFilter).toBe("all");
    expect(res.section).toBe("messages");
  });

  it("handles legacy tab=automated", () => {
    const res = parseCommunicationSearch("?tab=automated");
    expect(res.statusFilter).toBe("all");
    expect(res.originFilter).toBe("automated");
    expect(res.section).toBe("messages");
  });

  it("handles legacy filter=automated", () => {
    const res = parseCommunicationSearch("?filter=automated");
    expect(res.statusFilter).toBe("all");
    expect(res.originFilter).toBe("automated");
  });

  it("parses explicit status and type queries", () => {
    const res1 = parseCommunicationSearch("?status=sent&type=automated");
    expect(res1.statusFilter).toBe("sent");
    expect(res1.originFilter).toBe("automated");

    const res2 = parseCommunicationSearch("?status=failed&type=manual");
    expect(res2.statusFilter).toBe("failed");
    expect(res2.originFilter).toBe("manual");

    const res3 = parseCommunicationSearch("?status=queued&origin=automated");
    expect(res3.statusFilter).toBe("queued");
    expect(res3.originFilter).toBe("automated");
  });

  it("normalizes plural or alternate status names", () => {
    expect(parseCommunicationSearch("?status=drafts").statusFilter).toBe("draft");
    expect(parseCommunicationSearch("?status=upcoming").statusFilter).toBe("scheduled");
  });

  it("allows explicit status to override tab", () => {
    const res = parseCommunicationSearch("?tab=history&status=sent&type=manual");
    expect(res.statusFilter).toBe("sent");
    expect(res.originFilter).toBe("manual");
  });

  it("falls back safely on invalid status and origin values", () => {
    const res = parseCommunicationSearch("?status=unknown_val&type=bogus_val");
    expect(res.statusFilter).toBe("all");
    expect(res.originFilter).toBe("all");
  });

  it("handles draftId by switching to compose mode", () => {
    const res = parseCommunicationSearch("?draftId=draft-123");
    expect(res).toEqual({
      draftId: "draft-123",
      messageMode: "compose",
      originFilter: "all",
      section: "messages",
      statusFilter: "all",
    });
  });

  it("keeps contact list preselection limited to a new compose link", () => {
    expect(parseCommunicationSearch("?tab=compose&contactListId=list-1").contactListId).toBe(
      "list-1",
    );
    expect(parseCommunicationSearch("?contactListId=list-1").contactListId).toBeUndefined();
    expect(
      parseCommunicationSearch("?tab=compose&draftId=draft-1&contactListId=list-1").contactListId,
    ).toBeUndefined();
    // Keep malformed selections restrictive so API validation rejects them rather than broadening the audience.
    expect(parseCommunicationSearch("?tab=compose&contactListId=").contactListId).toBe("");
  });

  it("handles other navigation tabs", () => {
    expect(parseCommunicationSearch("?tab=compose").messageMode).toBe("compose");
    expect(parseCommunicationSearch("?tab=templates").section).toBe("templates");
    expect(parseCommunicationSearch("?tab=settings").section).toBe("settings");
  });
});

describe("scheduledMessageActionLink", () => {
  const baseMessage: CommunicationScheduledMessage = {
    eventId: null,
    eventTitle: "",
    id: "00000000-0000-0000-0000-000000000001",
    kind: "audition_confirmation",
    recipientCount: 1,
    scheduledAt: "2026-10-17T12:00:00Z",
    status: "Sent",
    subject: "Test subject",
  };

  it("routes ticket confirmations with null eventId (bundles) to /admin/tickets with 'View ticketing'", () => {
    const link = scheduledMessageActionLink({
      ...baseMessage,
      eventId: null,
      kind: "ticket_confirmation",
    });
    expect(link).toEqual({ href: "/admin/tickets", label: "View ticketing" });
  });

  it("routes ticket reminders with eventId to /admin/tickets?eventId=... with 'View ticketing'", () => {
    const link = scheduledMessageActionLink({
      ...baseMessage,
      eventId: "11111111-1111-4111-8111-111111111111",
      kind: "ticket_reminder",
    });
    expect(link).toEqual({
      href: "/admin/tickets?eventId=11111111-1111-4111-8111-111111111111",
      label: "View ticketing",
    });
  });

  it("routes ticket refunds to /admin/tickets with 'View ticketing'", () => {
    const link = scheduledMessageActionLink({
      ...baseMessage,
      eventId: null,
      kind: "ticket_refund",
    });
    expect(link).toEqual({ href: "/admin/tickets", label: "View ticketing" });
  });

  it("routes audition confirmations and reminders to /admin/auditions with 'View auditions'", () => {
    expect(scheduledMessageActionLink({ ...baseMessage, kind: "audition_confirmation" })).toEqual({
      href: "/admin/auditions",
      label: "View auditions",
    });
    expect(scheduledMessageActionLink({ ...baseMessage, kind: "audition_reminder" })).toEqual({
      href: "/admin/auditions",
      label: "View auditions",
    });
  });

  it("routes attendance reports to /admin/attendance with 'View attendance'", () => {
    expect(scheduledMessageActionLink({ ...baseMessage, kind: "attendance_report" })).toEqual({
      href: "/admin/attendance",
      label: "View attendance",
    });
  });

  it("routes event reminders and RSVP follow-ups to /admin/rsvp with 'View event'", () => {
    expect(
      scheduledMessageActionLink({
        ...baseMessage,
        eventId: "22222222-2222-4222-8222-222222222222",
        kind: "event_reminder",
      }),
    ).toEqual({
      href: "/admin/rsvp?eventId=22222222-2222-4222-8222-222222222222",
      label: "View event",
    });
    expect(
      scheduledMessageActionLink({
        ...baseMessage,
        eventId: "22222222-2222-4222-8222-222222222222",
        kind: "rsvp_follow_up",
      }),
    ).toEqual({
      href: "/admin/rsvp?eventId=22222222-2222-4222-8222-222222222222",
      label: "View event",
    });
    expect(
      scheduledMessageActionLink({
        ...baseMessage,
        eventId: null,
        kind: "event_reminder",
      }),
    ).toEqual({
      href: "/admin/rsvp",
      label: "View event",
    });
  });
});
