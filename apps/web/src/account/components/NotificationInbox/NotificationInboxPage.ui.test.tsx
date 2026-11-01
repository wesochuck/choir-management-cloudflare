import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../../../api/notifications";
import { NotificationInboxPage } from "./NotificationInboxPage";

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const sampleNotice = {
  body: "Alice submitted an audition inquiry.",
  createdAt: "2026-11-01T12:00:00.000Z",
  destinationPath: "/admin/auditions",
  expiresAt: "2027-01-30T12:00:00.000Z",
  id: "22222222-2222-4222-8222-222222222222",
  kind: "audition" as const,
  readAt: null,
  title: "Audition inquiry: Alice",
};

describe("NotificationInboxPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.scrollTo = vi.fn();
  });

  it("renders page header and tabs", async () => {
    vi.spyOn(api, "listNotifications").mockResolvedValue({
      hasMoreUnread: false,
      nextCursor: null,
      notifications: [sampleNotice],
      requestId: "11111111-1111-4111-8111-111111111111",
      snapshotBoundary: "2026-11-01T12:00:00.000Z",
      unreadCount: 1,
    });

    renderWithClient(
      <NotificationInboxPage
        onNavigate={vi.fn()}
        organizationId="org-1"
        userId="user-1"
        userRole="administrator"
      />,
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Notifications" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "All" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Unread" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Auditions" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Ticket sales" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Donations" })).toBeInTheDocument();
    expect(await screen.findByText("Audition inquiry: Alice")).toBeInTheDocument();
  });

  it("switches filter tabs and triggers filtered list query", async () => {
    const listSpy = vi.spyOn(api, "listNotifications").mockResolvedValue({
      hasMoreUnread: false,
      nextCursor: null,
      notifications: [],
      requestId: "11111111-1111-4111-8111-111111111111",
      snapshotBoundary: "2026-11-01T12:00:00.000Z",
      unreadCount: 0,
    });

    renderWithClient(
      <NotificationInboxPage
        onNavigate={vi.fn()}
        organizationId="org-1"
        userId="user-1"
        userRole="member"
      />,
    );

    const auditionsTab = await screen.findByRole("tab", { name: "Auditions" });
    fireEvent.click(auditionsTab);

    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: "audition",
      }),
    );
  });

  it("allows marking all as read", async () => {
    vi.spyOn(api, "listNotifications").mockResolvedValue({
      hasMoreUnread: false,
      nextCursor: null,
      notifications: [sampleNotice],
      requestId: "11111111-1111-4111-8111-111111111111",
      snapshotBoundary: "2026-11-01T12:00:00.000Z",
      unreadCount: 1,
    });
    const markAllSpy = vi.spyOn(api, "markAllNotificationsRead").mockResolvedValue({
      markedCount: 1,
      requestId: "11111111-1111-4111-8111-111111111111",
      success: true,
    });

    renderWithClient(
      <NotificationInboxPage
        onNavigate={vi.fn()}
        organizationId="org-1"
        userId="user-1"
        userRole="administrator"
      />,
    );

    const markAllButton = await screen.findByRole("button", { name: /mark all as read/i });
    fireEvent.click(markAllButton);

    await waitFor(() => {
      expect(markAllSpy).toHaveBeenCalledWith("2026-11-01T12:00:00.000Z");
    });
  });

  it("handles pagination controls", async () => {
    vi.spyOn(api, "listNotifications").mockResolvedValue({
      hasMoreUnread: false,
      nextCursor: "cursor-page-2",
      notifications: [sampleNotice],
      requestId: "11111111-1111-4111-8111-111111111111",
      snapshotBoundary: "2026-11-01T12:00:00.000Z",
      unreadCount: 0,
    });

    renderWithClient(
      <NotificationInboxPage
        onNavigate={vi.fn()}
        organizationId="org-1"
        userId="user-1"
        userRole="administrator"
      />,
    );

    const prevButton = await screen.findByRole("button", { name: /← previous/i });
    const nextButton = screen.getByRole("button", { name: /next →/i });

    expect(prevButton).toBeDisabled();
    expect(nextButton).not.toBeDisabled();

    fireEvent.click(nextButton);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /← previous/i })).not.toBeDisabled();
    });
  });
});
