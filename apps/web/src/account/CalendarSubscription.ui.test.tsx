import type { CalendarFeedUrlsResponse } from "@choir/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../auth/api";
import { CalendarSubscription } from "./CalendarSubscription";

vi.mock("../auth/api", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    getCalendarFeedUrls: vi.fn(),
    resetCalendarFeedUrls: vi.fn(),
  };
});

const sampleFeedUrls: CalendarFeedUrlsResponse = {
  expiresAt: "2027-08-20T20:00:00.000Z",
  httpsUrl:
    "https://choir.test/api/calendar/feed/Northwest%20Choir.ics?token=secret-calendar-jwt-token-12345",
  requestId: "req-1111",
  webcalUrl:
    "webcal://choir.test/api/calendar/feed/Northwest%20Choir.ics?token=secret-calendar-jwt-token-12345",
};

const updatedFeedUrls: CalendarFeedUrlsResponse = {
  expiresAt: "2027-08-20T20:00:00.000Z",
  httpsUrl:
    "https://choir.test/api/calendar/feed/Northwest%20Choir.ics?token=new-secret-jwt-token-67890",
  requestId: "req-2222",
  webcalUrl:
    "webcal://choir.test/api/calendar/feed/Northwest%20Choir.ics?token=new-secret-jwt-token-67890",
};

describe("CalendarSubscription UI", () => {
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: originalClipboard,
      writable: true,
    });
  });

  it("hides advanced link controls by default and reveals the address with its privacy guidance", async () => {
    vi.mocked(api.getCalendarFeedUrls).mockResolvedValue(sampleFeedUrls);

    render(<CalendarSubscription enabled />);
    await screen.findByRole("link", { name: "Google Calendar" });
    expect(screen.getByLabelText("Calendar subscription link")).not.toBeVisible();
    expect(screen.getByRole("button", { name: "Reset calendar address" })).not.toBeVisible();
    await userEvent.click(await screen.findByText("Other options", { exact: true }));

    await waitFor(() => {
      expect(screen.getByLabelText("Calendar subscription link")).toBeInTheDocument();
    });

    const input = screen.getByLabelText<HTMLInputElement>("Calendar subscription link");
    expect(input.value).toBe(sampleFeedUrls.httpsUrl);
    expect(screen.queryByRole("button", { name: "Reveal address" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hide address" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();

    expect(
      screen.getByText("Anyone with this link can view your calendar. Do not share it."),
    ).toBeInTheDocument();
  });

  it("provides direct subscription links for calendar apps and Google Calendar", async () => {
    vi.mocked(api.getCalendarFeedUrls).mockResolvedValue(sampleFeedUrls);

    render(<CalendarSubscription enabled />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Apple Calendar / Other app" })).toBeInTheDocument();
    });

    const calendarAppLink = screen.getByRole("link", { name: "Apple Calendar / Other app" });
    expect(calendarAppLink).toHaveAttribute("href", sampleFeedUrls.webcalUrl);

    const googleCalendarLink = screen.getByRole("link", {
      name: "Google Calendar",
    });
    expect(googleCalendarLink).toHaveAttribute(
      "href",
      `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(sampleFeedUrls.webcalUrl)}`,
    );
  });

  it("copies full URL to clipboard when Copy link is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getCalendarFeedUrls).mockResolvedValue(sampleFeedUrls);

    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: writeTextSpy,
      },
      writable: true,
    });

    render(<CalendarSubscription enabled />);
    await userEvent.click(await screen.findByText("Other options", { exact: true }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    });

    const copyBtn = screen.getByRole("button", { name: "Copy link" });
    await user.click(copyBtn);

    expect(writeTextSpy).toHaveBeenCalledWith(sampleFeedUrls.httpsUrl);
    expect(screen.getByRole("button", { name: "✓ Copied!" })).toBeInTheDocument();
    expect(screen.getByText("Calendar link copied to clipboard.")).toBeInTheDocument();
  });

  it("opens modal confirmation on Reset calendar address and revokes on confirm", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getCalendarFeedUrls).mockResolvedValue(sampleFeedUrls);
    vi.mocked(api.resetCalendarFeedUrls).mockResolvedValue(updatedFeedUrls);

    render(<CalendarSubscription enabled />);
    await userEvent.click(await screen.findByText("Other options", { exact: true }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reset calendar address" })).toBeInTheDocument();
    });

    // Dialog is initially not present
    expect(
      screen.queryByRole("dialog", { name: "Reset calendar address?" }),
    ).not.toBeInTheDocument();

    // Click reset button
    await user.click(screen.getByRole("button", { name: "Reset calendar address" }));

    // Modal dialog is opened with warning
    const dialog = screen.getByRole("dialog", { name: "Reset calendar address?" });
    expect(dialog).toBeInTheDocument();
    expect(
      screen.getByText(
        /Existing calendar subscriptions on all your devices will stop updating immediately/,
      ),
    ).toBeInTheDocument();

    // Confirm reset in dialog
    const confirmBtn = screen.getByRole("button", { name: "Reset address" });
    await user.click(confirmBtn);

    expect(api.resetCalendarFeedUrls).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(
        screen.getByText("Calendar subscription address reset. New link is ready."),
      ).toBeInTheDocument();
    });

    const input = screen.getByLabelText<HTMLInputElement>("Calendar subscription link");
    expect(input.value).toBe(updatedFeedUrls.httpsUrl);
  });

  it("cancels reset dialog without calling reset API", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getCalendarFeedUrls).mockResolvedValue(sampleFeedUrls);

    render(<CalendarSubscription enabled />);
    await userEvent.click(await screen.findByText("Other options", { exact: true }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reset calendar address" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Reset calendar address" }));
    expect(screen.getByRole("dialog", { name: "Reset calendar address?" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.resetCalendarFeedUrls).not.toHaveBeenCalled();
  });
});
