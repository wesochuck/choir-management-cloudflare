import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../../../api/notifications";
import { NotificationPopout } from "./NotificationPopout";

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

describe("NotificationPopout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders notice list and marks all as read", async () => {
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

    const triggerRef = { current: document.createElement("button") };

    renderWithClient(
      <NotificationPopout
        isOpen={true}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        organizationId="org-1"
        triggerRef={triggerRef}
        userId="user-1"
        userRole="administrator"
      />,
    );

    expect(await screen.findByText("Audition inquiry: Alice")).toBeInTheDocument();
    const markAllButton = screen.getByRole("button", { name: /mark all as read/i });
    expect(markAllButton).toBeInTheDocument();

    fireEvent.click(markAllButton);
    await waitFor(() => {
      expect(markAllSpy).toHaveBeenCalledWith("2026-11-01T12:00:00.000Z");
    });
  });

  it("navigates to destination when clicked by authorized administrator", async () => {
    vi.spyOn(api, "listNotifications").mockResolvedValue({
      hasMoreUnread: false,
      nextCursor: null,
      notifications: [sampleNotice],
      requestId: "11111111-1111-4111-8111-111111111111",
      snapshotBoundary: "2026-11-01T12:00:00.000Z",
      unreadCount: 1,
    });
    const markReadSpy = vi.spyOn(api, "markNotificationRead").mockResolvedValue({
      notification: { ...sampleNotice, readAt: "2026-11-01T12:01:00.000Z" },
      requestId: "11111111-1111-4111-8111-111111111111",
      success: true,
    });

    const onNavigate = vi.fn();
    const onClose = vi.fn();
    const triggerRef = { current: document.createElement("button") };

    renderWithClient(
      <NotificationPopout
        isOpen={true}
        onClose={onClose}
        onNavigate={onNavigate}
        organizationId="org-1"
        triggerRef={triggerRef}
        userId="user-1"
        userRole="administrator"
      />,
    );

    const noticeButton = await screen.findByRole("button", { name: /audition inquiry: alice/i });
    fireEvent.click(noticeButton);

    await waitFor(() => {
      expect(markReadSpy).toHaveBeenCalledWith(sampleNotice.id);
    });
    expect(onNavigate).toHaveBeenCalledWith("/admin/auditions");
    expect(onClose).toHaveBeenCalled();
  });

  it("marks read but does not navigate to admin destination when user is ordinary member", async () => {
    vi.spyOn(api, "listNotifications").mockResolvedValue({
      hasMoreUnread: false,
      nextCursor: null,
      notifications: [sampleNotice],
      requestId: "11111111-1111-4111-8111-111111111111",
      snapshotBoundary: "2026-11-01T12:00:00.000Z",
      unreadCount: 1,
    });
    const markReadSpy = vi.spyOn(api, "markNotificationRead").mockResolvedValue({
      notification: { ...sampleNotice, readAt: "2026-11-01T12:01:00.000Z" },
      requestId: "11111111-1111-4111-8111-111111111111",
      success: true,
    });

    const onNavigate = vi.fn();
    const onClose = vi.fn();
    const triggerRef = { current: document.createElement("button") };

    renderWithClient(
      <NotificationPopout
        isOpen={true}
        onClose={onClose}
        onNavigate={onNavigate}
        organizationId="org-1"
        triggerRef={triggerRef}
        userId="user-1"
        userRole="member"
      />,
    );

    const noticeButton = await screen.findByRole("button", {
      name: /unread notification: audition inquiry: alice/i,
    });
    fireEvent.click(noticeButton);

    await waitFor(() => {
      expect(markReadSpy).toHaveBeenCalledWith(sampleNotice.id);
    });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("dismisses on Escape key and refocuses trigger", () => {
    vi.spyOn(api, "listNotifications").mockResolvedValue({
      hasMoreUnread: false,
      nextCursor: null,
      notifications: [],
      requestId: "11111111-1111-4111-8111-111111111111",
      snapshotBoundary: "2026-11-01T12:00:00.000Z",
      unreadCount: 0,
    });

    const onClose = vi.fn();
    const triggerButton = document.createElement("button");
    const focusSpy = vi.spyOn(triggerButton, "focus");
    const triggerRef = { current: triggerButton };

    renderWithClient(
      <NotificationPopout
        isOpen={true}
        onClose={onClose}
        onNavigate={vi.fn()}
        organizationId="org-1"
        triggerRef={triggerRef}
        userId="user-1"
        userRole="member"
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(focusSpy).toHaveBeenCalled();
  });
});
