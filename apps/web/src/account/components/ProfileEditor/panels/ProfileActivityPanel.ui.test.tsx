import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { OrganizationProfileActivityResponse } from "@choir/contracts";
import { ProfileActivityPanel } from "./ProfileActivityPanel";

afterEach(cleanup);

const linkedActivityData: OrganizationProfileActivityResponse = {
  attendance: {
    lastAttendedEvent: {
      eventId: "22222222-2222-4222-8222-222222222222",
      eventTitle: "Dress Rehearsal",
      eventType: "Rehearsal",
      startsAt: "2026-06-09T23:00:00.000Z",
    },
    recentRehearsals: {
      absentCount: 1,
      pendingCount: 0,
      presentCount: 5,
      totalCount: 6,
    },
  },
  emailHealth: {
    bounceReason: "",
    doNotEmail: false,
    lastBounceAt: null,
    lastDeliveredAt: "2026-06-11T15:00:00.000Z",
    providerEmailSuppressed: false,
  },
  lastPollResponseAt: "2026-06-07T16:30:00.000Z",
  lastRsvpResponseAt: "2026-06-05T14:00:00.000Z",
  portal: {
    emailVerified: true,
    hasGoogleAccount: true,
    hasPassword: true,
    joinedAt: "2026-01-15T12:00:00.000Z",
    joinedViaInviteLink: true,
    lastActiveAt: "2026-06-12T18:30:00.000Z",
    linked: true,
    passkeyCount: 2,
    pendingInvitation: null,
    role: "member",
    twoFactorEnabled: true,
  },
  profileCreatedAt: "2026-01-10T10:00:00.000Z",
  profileId: "11111111-1111-4111-8111-111111111111",
  profileUpdatedAt: "2026-06-10T10:00:00.000Z",
  requestId: "33333333-3333-4333-8333-333333333333",
  timeline: [
    {
      actorType: "member",
      detail: "Pending → Yes · Confirmed",
      id: "rsvp:1",
      kind: "rsvp_change",
      occurredAt: "2026-06-05T14:00:00.000Z",
      title: "RSVP updated for Spring Concert",
    },
    {
      actorType: "system",
      detail: "Returned to rehearsal",
      id: "status:1",
      kind: "status_change",
      occurredAt: "2026-06-04T12:00:00.000Z",
      title: "Status changed to Active",
    },
  ],
};

describe("ProfileActivityPanel", () => {
  it("renders loading and error states accessibly", () => {
    const { rerender } = render(<ProfileActivityPanel state={{ status: "loading" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading activity…");

    rerender(<ProfileActivityPanel state={{ status: "error" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Profile activity could not be loaded.");
  });

  it("renders linked portal access, auth readiness, attendance summary, and chronological timeline", () => {
    render(<ProfileActivityPanel state={{ data: linkedActivityData, status: "ready" }} />);

    expect(screen.getByRole("heading", { level: 3, name: "Activity" })).toBeInTheDocument();
    expect(screen.getByText("Linked")).toBeInTheDocument();
    expect(screen.getByText("Email verified")).toBeInTheDocument();
    expect(screen.getByText("2 passkeys")).toBeInTheDocument();
    expect(screen.getByText("Password")).toBeInTheDocument();
    expect(screen.getByText("Google")).toBeInTheDocument();
    expect(screen.getByText("2FA enabled")).toBeInTheDocument();
    expect(screen.getByText("Joined via invite link")).toBeInTheDocument();
    expect(screen.getByText(/Dress Rehearsal/)).toBeInTheDocument();
    expect(screen.getByText("5 present · 1 absent")).toBeInTheDocument();
    expect(screen.getByText("2 events")).toBeInTheDocument();
    expect(screen.getByText("RSVP updated for Spring Concert")).toBeInTheDocument();
    expect(screen.getByText("By member")).toBeInTheDocument();
    expect(screen.getByText("Automatic")).toBeInTheDocument();
  });

  it("renders unlinked pending invitation and email bounce warnings cleanly", () => {
    render(
      <ProfileActivityPanel
        state={{
          data: {
            ...linkedActivityData,
            attendance: {
              lastAttendedEvent: null,
              recentRehearsals: { absentCount: 0, pendingCount: 0, presentCount: 0, totalCount: 0 },
            },
            emailHealth: {
              bounceReason: "Mailbox full",
              doNotEmail: false,
              lastBounceAt: "2026-06-10T10:00:00.000Z",
              lastDeliveredAt: null,
              providerEmailSuppressed: true,
            },
            lastPollResponseAt: null,
            lastRsvpResponseAt: null,
            portal: {
              emailVerified: null,
              hasGoogleAccount: null,
              hasPassword: null,
              joinedAt: null,
              joinedViaInviteLink: false,
              lastActiveAt: null,
              linked: false,
              passkeyCount: null,
              pendingInvitation: {
                createdAt: "2026-06-01T12:00:00.000Z",
                expiresAt: "2026-06-09T12:00:00.000Z",
                role: "administrator",
              },
              role: null,
              twoFactorEnabled: null,
            },
            timeline: [],
          },
          status: "ready",
        }}
      />,
    );

    expect(screen.getByText("Pending invite")).toBeInTheDocument();
    expect(screen.getByText("Administrator (invited)")).toBeInTheDocument();
    expect(screen.getByText("No attendance recorded yet")).toBeInTheDocument();
    expect(screen.getByText("No rehearsals recorded")).toBeInTheDocument();
    expect(screen.getByText("Suppressed")).toBeInTheDocument();
    expect(screen.getByText(/Mailbox full/)).toBeInTheDocument();
    expect(
      screen.getByText("No activity has been recorded for this Profile yet."),
    ).toBeInTheDocument();
  });
});
