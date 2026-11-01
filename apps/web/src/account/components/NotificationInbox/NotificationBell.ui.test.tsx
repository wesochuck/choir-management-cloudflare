import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../../../api/notifications";
import * as sidebarTransitions from "../AuthenticatedShell/sidebarTransitions";
import { NotificationBell } from "./NotificationBell";

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("NotificationBell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(sidebarTransitions, "readNarrowViewport").mockReturnValue(false);
  });

  it("renders bell with unread badge capped at 99+", async () => {
    vi.spyOn(api, "listNotifications").mockResolvedValue({
      hasMoreUnread: true,
      nextCursor: null,
      notifications: [],
      requestId: "11111111-1111-4111-8111-111111111111",
      snapshotBoundary: "2026-11-01T12:00:00.000Z",
      unreadCount: 100,
    });

    renderWithClient(
      <NotificationBell
        onNavigate={vi.fn()}
        organizationId="org-1"
        userId="user-1"
        userRole="member"
      />,
    );

    const button = await screen.findByRole("button", { name: /notifications, 99\+ unread/i });
    expect(button).toBeInTheDocument();
    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  it("renders unread badge for single-digit unread notices", async () => {
    vi.spyOn(api, "listNotifications").mockResolvedValue({
      hasMoreUnread: false,
      nextCursor: null,
      notifications: [],
      requestId: "11111111-1111-4111-8111-111111111111",
      snapshotBoundary: "2026-11-01T12:00:00.000Z",
      unreadCount: 3,
    });

    renderWithClient(
      <NotificationBell
        onNavigate={vi.fn()}
        organizationId="org-1"
        userId="user-1"
        userRole="member"
      />,
    );

    const button = await screen.findByRole("button", { name: /notifications, 3 unread/i });
    expect(button).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("does not render badge when unreadCount is 0", async () => {
    vi.spyOn(api, "listNotifications").mockResolvedValue({
      hasMoreUnread: false,
      nextCursor: null,
      notifications: [],
      requestId: "11111111-1111-4111-8111-111111111111",
      snapshotBoundary: "2026-11-01T12:00:00.000Z",
      unreadCount: 0,
    });

    renderWithClient(
      <NotificationBell
        onNavigate={vi.fn()}
        organizationId="org-1"
        userId="user-1"
        userRole="member"
      />,
    );

    const button = await screen.findByRole("button", { name: /^notifications$/i });
    expect(button).toBeInTheDocument();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("opens popout on desktop click", async () => {
    vi.spyOn(sidebarTransitions, "readNarrowViewport").mockReturnValue(false);
    vi.spyOn(api, "listNotifications").mockResolvedValue({
      hasMoreUnread: false,
      nextCursor: null,
      notifications: [],
      requestId: "11111111-1111-4111-8111-111111111111",
      snapshotBoundary: "2026-11-01T12:00:00.000Z",
      unreadCount: 0,
    });

    renderWithClient(
      <NotificationBell
        onNavigate={vi.fn()}
        organizationId="org-1"
        userId="user-1"
        userRole="member"
      />,
    );

    const button = await screen.findByRole("button", { name: /^notifications$/i });
    expect(screen.queryByRole("region", { name: "Notifications" })).toBeNull();

    fireEvent.click(button);
    expect(screen.getByRole("region", { name: "Notifications" })).toBeInTheDocument();
  });

  it("navigates directly to /account/notifications on mobile viewport click", async () => {
    vi.spyOn(sidebarTransitions, "readNarrowViewport").mockReturnValue(true);
    const onNavigate = vi.fn();
    vi.spyOn(api, "listNotifications").mockResolvedValue({
      hasMoreUnread: false,
      nextCursor: null,
      notifications: [],
      requestId: "11111111-1111-4111-8111-111111111111",
      snapshotBoundary: "2026-11-01T12:00:00.000Z",
      unreadCount: 2,
    });

    renderWithClient(
      <NotificationBell
        onNavigate={onNavigate}
        organizationId="org-1"
        userId="user-1"
        userRole="member"
      />,
    );

    const button = await screen.findByRole("button", { name: /notifications, 2 unread/i });
    fireEvent.click(button);

    expect(onNavigate).toHaveBeenCalledWith("/account/notifications");
    expect(screen.queryByRole("region", { name: "Notifications" })).toBeNull();
  });
});
