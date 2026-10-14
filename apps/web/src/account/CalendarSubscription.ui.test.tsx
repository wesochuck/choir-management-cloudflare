import type { CalendarFeedUrlsResponse } from "@choir/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../auth/api";
import { CalendarSubscription } from "./CalendarSubscription";
import { maskCalendarUrl } from "./calendarFeedUtils";

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
  httpsUrl: "https://choir.test/api/calendar/feed?token=secret-calendar-jwt-token-12345",
  requestId: "req-1111",
  webcalUrl: "webcal://choir.test/api/calendar/feed?token=secret-calendar-jwt-token-12345",
};

const updatedFeedUrls: CalendarFeedUrlsResponse = {
  expiresAt: "2027-08-20T20:00:00.000Z",
  httpsUrl: "https://choir.test/api/calendar/feed?token=new-secret-jwt-token-67890",
  requestId: "req-2222",
  webcalUrl: "webcal://choir.test/api/calendar/feed?token=new-secret-jwt-token-67890",
};

describe("maskCalendarUrl helper", () => {
  it("masks token parameter with bullet dots", () => {
    const masked = maskCalendarUrl(sampleFeedUrls.httpsUrl);
    expect(masked).toBe(
      "https://choir.test/api/calendar/feed?token=%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A2",
    );
    expect(decodeURIComponent(masked)).toBe("https://choir.test/api/calendar/feed?token=••••••••");
  });

  it("handles non-token URLs gracefully", () => {
    expect(maskCalendarUrl("https://choir.test/calendar")).toBe("https://choir.test/calendar");
  });
});

describe("CalendarSubscription UI (#195)", () => {
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

  it("displays masked calendar token by default and explains privacy policy", async () => {
    vi.mocked(api.getCalendarFeedUrls).mockResolvedValue(sampleFeedUrls);

    render(<CalendarSubscription enabled />);

    await waitFor(() => {
      expect(screen.getByLabelText("HTTPS calendar address")).toBeInTheDocument();
    });

    const input = screen.getByLabelText<HTMLInputElement>("HTTPS calendar address");
    const maskedValue = input.value;
    expect(maskedValue.includes("token=")).toBe(true);
    expect(maskedValue.includes("secret-calendar-jwt-token-12345")).toBe(false);
    expect(maskedValue.includes(encodeURIComponent("••••••••"))).toBe(true);

    expect(
      screen.getByText("Anyone with this link can view your calendar. Do not share it."),
    ).toBeInTheDocument();
  });

  it("toggles URL reveal and hide on clicking reveal button", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getCalendarFeedUrls).mockResolvedValue(sampleFeedUrls);

    render(<CalendarSubscription enabled />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reveal address" })).toBeInTheDocument();
    });

    const input = screen.getByLabelText<HTMLInputElement>("HTTPS calendar address");
    const revealBtn = screen.getByRole("button", { name: "Reveal address" });

    // Click reveal
    await user.click(revealBtn);
    expect(input.value).toBe(sampleFeedUrls.httpsUrl);
    expect(screen.getByRole("button", { name: "Hide address" })).toBeInTheDocument();

    // Click hide
    await user.click(screen.getByRole("button", { name: "Hide address" }));
    expect(input.value.includes(encodeURIComponent("••••••••"))).toBe(true);
    expect(screen.getByRole("button", { name: "Reveal address" })).toBeInTheDocument();
  });

  it("copies unmasked URL to clipboard even when display is masked", async () => {
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

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Copy address" })).toBeInTheDocument();
    });

    const copyBtn = screen.getByRole("button", { name: "Copy address" });
    await user.click(copyBtn);

    // Verifies the clipboard receives the full unmasked raw URL
    expect(writeTextSpy).toHaveBeenCalledWith(sampleFeedUrls.httpsUrl);
    expect(screen.getByRole("button", { name: "✓ Copied!" })).toBeInTheDocument();
    expect(screen.getByText("Calendar address copied to clipboard.")).toBeInTheDocument();
  });

  it("opens modal confirmation on Reset calendar address and revokes on confirm", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getCalendarFeedUrls).mockResolvedValue(sampleFeedUrls);
    vi.mocked(api.resetCalendarFeedUrls).mockResolvedValue(updatedFeedUrls);

    render(<CalendarSubscription enabled />);

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

    const input = screen.getByLabelText<HTMLInputElement>("HTTPS calendar address");
    const resetValue = input.value;
    expect(resetValue.includes(encodeURIComponent("••••••••"))).toBe(true);
    expect(resetValue.includes("new-secret-jwt-token-67890")).toBe(false);
  });

  it("cancels reset dialog without calling reset API", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getCalendarFeedUrls).mockResolvedValue(sampleFeedUrls);

    render(<CalendarSubscription enabled />);

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
