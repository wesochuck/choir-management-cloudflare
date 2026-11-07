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

  it("renders the page header, category selector, and first expanded notification", async () => {
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
    expect(screen.getByRole("combobox", { name: "Show notifications" })).toHaveValue("all");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "All notifications",
      "Unread",
      "Auditions",
      "Ticket sales",
      "Donations",
      "RSVP declines",
      "Compliance",
    ]);
    expect(await screen.findByText("Audition inquiry: Alice")).toBeInTheDocument();
    expect(screen.getByText(sampleNotice.body)).toBeVisible();
    expect(screen.getByText(sampleNotice.title).closest("details")).toHaveAttribute("open");
  });

  it("changes the selector and triggers the filtered list query", async () => {
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

    fireEvent.change(await screen.findByRole("combobox", { name: "Show notifications" }), {
      target: { value: "audition" },
    });

    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: "audition",
      }),
    );
  });

  it("reveals details without marking read and preserves authorized record actions", async () => {
    vi.spyOn(api, "listNotifications").mockResolvedValue({
      hasMoreUnread: false,
      nextCursor: null,
      notifications: [
        sampleNotice,
        {
          ...sampleNotice,
          id: "33333333-3333-4333-8333-333333333333",
          title: "Second inquiry",
          body: "Second inquiry details.",
        },
      ],
      requestId: "11111111-1111-4111-8111-111111111111",
      snapshotBoundary: sampleNotice.createdAt,
      unreadCount: 2,
    });
    const markRead = vi.spyOn(api, "markNotificationRead").mockResolvedValue({
      notification: { ...sampleNotice, readAt: new Date().toISOString() },
      requestId: "11111111-1111-4111-8111-111111111111",
      success: true,
    });
    const navigate = vi.fn();
    renderWithClient(
      <NotificationInboxPage
        onNavigate={navigate}
        organizationId="org-1"
        userId="user-1"
        userRole="administrator"
      />,
    );
    const heading = await screen.findByRole("heading", { name: "Second inquiry" });
    const details = heading.closest("details");
    const summary = heading.closest("summary");
    expect(details).not.toHaveAttribute("open");
    if (!summary) throw new Error("Expected a native disclosure summary.");
    fireEvent.click(summary);
    expect(details).toHaveAttribute("open");
    expect(markRead).not.toHaveBeenCalled();
    const viewRecord = screen.getAllByRole("button", { name: "View record →" })[1];
    if (!viewRecord) throw new Error("Expected the second record action.");
    fireEvent.click(viewRecord);
    await waitFor(() => {
      expect(markRead).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333");
    });
    expect(navigate).toHaveBeenCalledWith("/admin/auditions");
  });

  it("keeps details available without exposing unauthorized admin links", async () => {
    vi.spyOn(api, "listNotifications").mockResolvedValue({
      hasMoreUnread: false,
      nextCursor: null,
      notifications: [sampleNotice],
      requestId: "11111111-1111-4111-8111-111111111111",
      snapshotBoundary: sampleNotice.createdAt,
      unreadCount: 1,
    });
    renderWithClient(
      <NotificationInboxPage
        onNavigate={vi.fn()}
        organizationId="org-1"
        userId="user-1"
        userRole="member"
      />,
    );
    expect(await screen.findByText(sampleNotice.body)).toBeVisible();
    expect(screen.queryByRole("button", { name: "View record →" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark as read" })).toBeVisible();
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
