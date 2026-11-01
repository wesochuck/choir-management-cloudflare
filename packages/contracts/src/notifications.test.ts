import { describe, expect, it } from "vitest";

import {
  organizationNotificationSchema,
  organizationNotificationsResponseSchema,
  organizationNotificationReadAllRequestSchema,
  organizationNotificationReadAllResponseSchema,
  organizationNotificationReadResponseSchema,
} from "./notifications";

describe("organizationNotificationSchema", () => {
  it("validates valid notification records", () => {
    const notice = {
      body: "Jane Doe submitted an audition inquiry.",
      createdAt: "2026-11-01T12:00:00.000Z",
      destinationPath: "/admin/auditions",
      expiresAt: "2027-01-30T12:00:00.000Z",
      id: "11111111-1111-4111-8111-111111111111",
      kind: "audition" as const,
      readAt: null,
      title: "Audition inquiry: Jane Doe",
    };
    expect(organizationNotificationSchema.parse(notice)).toEqual(notice);
  });

  it("validates notifications response envelope with pagination and unread counts", () => {
    const response = {
      hasMoreUnread: false,
      nextCursor: "2026-11-01T12:00:00.000Z:11111111-1111-4111-8111-111111111111",
      notifications: [
        {
          body: "Ticket purchase confirmed.",
          createdAt: "2026-11-01T12:00:00.000Z",
          destinationPath: "/admin/tickets",
          expiresAt: "2027-01-30T12:00:00.000Z",
          id: "11111111-1111-4111-8111-111111111111",
          kind: "ticket_sale" as const,
          readAt: "2026-11-01T12:30:00.000Z",
          title: "Ticket sale: Spring Concert",
        },
      ],
      requestId: "22222222-2222-4222-8222-222222222222",
      snapshotBoundary: "2026-11-01T12:35:00.000Z",
      unreadCount: 0,
    };
    expect(organizationNotificationsResponseSchema.parse(response)).toEqual(response);
  });

  it("validates mark read and mark-all read payloads", () => {
    const readResponse = {
      notification: {
        body: "Donation received.",
        createdAt: "2026-11-01T12:00:00.000Z",
        destinationPath: "/admin/donations",
        expiresAt: "2027-01-30T12:00:00.000Z",
        id: "11111111-1111-4111-8111-111111111111",
        kind: "donation" as const,
        readAt: "2026-11-01T12:05:00.000Z",
        title: "Donation receipt: Jane Doe",
      },
      requestId: "33333333-3333-4333-8333-333333333333",
      success: true as const,
    };
    expect(organizationNotificationReadResponseSchema.parse(readResponse)).toEqual(readResponse);

    const markAllReq = {
      boundary: "2026-11-01T12:00:00.000Z",
    };
    expect(organizationNotificationReadAllRequestSchema.parse(markAllReq)).toEqual(markAllReq);

    const markAllResp = {
      markedCount: 5,
      requestId: "44444444-4444-4444-8444-444444444444",
      success: true as const,
    };
    expect(organizationNotificationReadAllResponseSchema.parse(markAllResp)).toEqual(markAllResp);
  });
});
