import {
  organizationEventSchema,
  organizationMusicPieceSchema,
  type OrganizationEvent,
  type OrganizationMusicPiece,
} from "@choir/contracts";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../../../auth/api";
import { copyRichLink } from "../../../shared/clipboard";
import * as qrCodeModule from "../../../shared/qrCode";
import { SetListManager } from "./controller";

vi.mock("../../../auth/api", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    generatePublicPlayerToken: vi.fn(),
    getOrganizationCalendarSettings: vi.fn(),
    getPublicPlayerLinkStatus: vi.fn(),
    listOrganizationEvents: vi.fn(),
    listOrganizationMusic: vi.fn(),
    listOrganizationProfiles: vi.fn(),
    listOrganizationVenues: vi.fn(),
    rotatePublicPlayerToken: vi.fn(),
    updateOrganizationEvent: vi.fn(),
  };
});

vi.mock("../../../shared/clipboard", () => ({
  copyRichLink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../shared/qrCode", () => ({
  generateQRCodeDataUrl: vi.fn().mockResolvedValue("data:image/png;base64,mockqr"),
  overlayLogoOnQrCode: vi.fn(),
}));

function pieceWithTrack(id: string, title: string): OrganizationMusicPiece {
  return organizationMusicPieceSchema.parse({
    composer: "Composer Name",
    createdAt: "2026-01-01T00:00:00.000Z",
    durationSeconds: 180,
    id,
    notes: "",
    title,
    trackFileIds: { tutti: "22222222-2222-4222-8222-222222222222" },
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

function performanceEvent(
  id: string,
  title: string,
  options: {
    readonly approved?: boolean;
    readonly pieceId?: string;
  } = {},
): OrganizationEvent {
  return organizationEventSchema.parse({
    createdAt: "2026-01-01T00:00:00.000Z",
    id,
    setList: options.pieceId
      ? [{ pieceId: options.pieceId, title: "Test Song", type: "song" }]
      : [],
    setListApproved: options.approved ?? true,
    startsAt: "2026-10-04T13:30:00.000Z",
    title,
    type: "Performance",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("SetListManager Practice Player sharing and link stability", () => {
  const musicPiece = pieceWithTrack("11111111-1111-4111-8111-111111111111", "Hallelujah");
  const testEvent = performanceEvent("33333333-3333-4333-8333-333333333333", "Fall Concert", {
    approved: true,
    pieceId: "11111111-1111-4111-8111-111111111111",
  });

  const activeExpiresAt = new Date("2026-10-11T13:30:00.000Z").getTime();
  const activeIssuedAt = new Date("2026-10-04T13:30:00.000Z").getTime();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listOrganizationEvents).mockResolvedValue([testEvent]);
    vi.mocked(api.listOrganizationMusic).mockResolvedValue([musicPiece]);
    vi.mocked(api.listOrganizationProfiles).mockResolvedValue([]);
    vi.mocked(api.listOrganizationVenues).mockResolvedValue([]);
    vi.mocked(api.getOrganizationCalendarSettings).mockResolvedValue({
      timezone: "America/New_York",
    });
  });

  const originalLocation = window.location;

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("displays helper text for status 'none' when no link exists", async () => {
    vi.mocked(api.getPublicPlayerLinkStatus).mockResolvedValue({
      active: false,
      eventId: testEvent.id,
      expiresAt: null,
      issuedAt: null,
      status: "none",
    });

    render(<SetListManager enabled initialEventId={testEvent.id} />);
    await flushAsync();

    expect(
      screen.getByText("A Practice Player link has not been created yet."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Rotate & copy link/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Renew player link/i)).not.toBeInTheDocument();
  });

  it("displays helper text and exact expiration for active link", async () => {
    vi.mocked(api.getPublicPlayerLinkStatus).mockResolvedValue({
      active: true,
      eventId: testEvent.id,
      expiresAt: activeExpiresAt,
      issuedAt: activeIssuedAt,
      status: "active",
    });

    render(<SetListManager enabled initialEventId={testEvent.id} />);
    await flushAsync();

    expect(screen.getByText(/Practice Player link expires Oct 11, 2026/i)).toBeInTheDocument();
    // Rotation and renewal controls must be absent while active
    expect(screen.queryByText(/Rotate/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Renew player link/i)).not.toBeInTheDocument();
  });

  it("reuses stable active link across Open, Copy, and QR without rotating", async () => {
    vi.mocked(api.getPublicPlayerLinkStatus).mockResolvedValue({
      active: true,
      eventId: testEvent.id,
      expiresAt: activeExpiresAt,
      issuedAt: activeIssuedAt,
      status: "active",
    });

    const activeLink = {
      expiresAt: activeExpiresAt,
      issuedAt: activeIssuedAt,
      token: "token-stable-123",
      url: "/player?mode=set-list&token=token-stable-123",
    };
    vi.mocked(api.generatePublicPlayerToken).mockResolvedValue(activeLink);

    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        assign: assignSpy,
        hash: "",
        href: "http://localhost:3000/admin/setlists",
        origin: "http://localhost:3000",
        search: "",
      },
    });

    render(<SetListManager enabled initialEventId={testEvent.id} />);
    await flushAsync();

    // 1. Click Copy player link
    const copyButton = screen.getByRole("button", { name: "Copy player link" });
    act(() => {
      fireEvent.click(copyButton);
    });
    await flushAsync();

    expect(api.generatePublicPlayerToken).toHaveBeenCalledTimes(1);
    expect(api.generatePublicPlayerToken).toHaveBeenCalledWith(testEvent.id);
    expect(api.rotatePublicPlayerToken).not.toHaveBeenCalled();
    expect(copyRichLink).toHaveBeenCalledTimes(1);
    expect(copyRichLink).toHaveBeenCalledWith({
      label: "Practice Player – Fall Concert",
      url: "http://localhost:3000/player?mode=set-list&token=token-stable-123",
    });

    // 2. Click Practice Player (open)
    const openButton = screen.getByRole("button", { name: "Practice Player" });
    act(() => {
      fireEvent.click(openButton);
    });
    await flushAsync();

    // Active link is cached in component state, so no extra network request
    expect(api.generatePublicPlayerToken).toHaveBeenCalledTimes(1);
    expect(api.rotatePublicPlayerToken).not.toHaveBeenCalled();
    expect(assignSpy).toHaveBeenCalledWith("/player?mode=set-list&token=token-stable-123");

    // 3. Click Player QR code
    const qrButton = screen.getByRole("button", { name: "Player QR code" });
    act(() => {
      fireEvent.click(qrButton);
    });
    await flushAsync();

    expect(api.generatePublicPlayerToken).toHaveBeenCalledTimes(1);
    expect(api.rotatePublicPlayerToken).not.toHaveBeenCalled();

    // Verify QR dialog opened with exact active URL
    expect(screen.getByRole("heading", { name: "Practice Player QR Code" })).toBeInTheDocument();
    expect(screen.getAllByText(/Practice Player link expires Oct 11, 2026/i).length).toBe(2);
    const qrImage = screen.getByAltText("Practice Player QR code for Fall Concert");
    expect(qrImage).toBeInTheDocument();
  });

  it("handles expired link: shows expired helper text, disables sharing, and allows renewal", async () => {
    const expiredTimestamp = new Date("2026-09-27T13:30:00.000Z").getTime();
    vi.mocked(api.getPublicPlayerLinkStatus).mockResolvedValue({
      active: false,
      eventId: testEvent.id,
      expiresAt: expiredTimestamp,
      issuedAt: expiredTimestamp - 604800000,
      status: "expired",
    });

    render(<SetListManager enabled initialEventId={testEvent.id} />);
    await flushAsync();

    // Expired helper text is shown
    expect(screen.getByText(/Practice Player link expired Sep 27, 2026/i)).toBeInTheDocument();

    // Copy and QR buttons should be disabled and must not silently generate a link
    const copyButton = screen.getByRole("button", { name: "Copy player link" });
    const qrButton = screen.getByRole("button", { name: "Player QR code" });
    const openButton = screen.getByRole("button", { name: "Practice Player" });
    expect(copyButton).toBeDisabled();
    expect(qrButton).toBeDisabled();
    expect(openButton).toBeDisabled();

    // Triggering click anyway must not call generatePublicPlayerToken or rotate
    act(() => {
      fireEvent.click(copyButton);
    });
    await flushAsync();
    expect(api.generatePublicPlayerToken).not.toHaveBeenCalled();
    expect(api.rotatePublicPlayerToken).not.toHaveBeenCalled();

    // Renew player link action is available
    const renewButton = screen.getByRole("button", { name: "Renew player link" });
    expect(renewButton).toBeInTheDocument();

    const renewedExpiresAt = new Date("2026-10-18T13:30:00.000Z").getTime();
    vi.mocked(api.generatePublicPlayerToken).mockResolvedValue({
      expiresAt: renewedExpiresAt,
      issuedAt: Date.now(),
      token: "token-renewed-456",
      url: "/player?mode=set-list&token=token-renewed-456",
    });

    act(() => {
      fireEvent.click(renewButton);
    });
    await flushAsync();

    // Activating renewal calls the normal non-rotating generate path
    expect(api.generatePublicPlayerToken).toHaveBeenCalledTimes(1);
    expect(api.generatePublicPlayerToken).toHaveBeenCalledWith(testEvent.id);
    expect(api.rotatePublicPlayerToken).not.toHaveBeenCalled();

    // UI state updates with new expiration and renewal button disappears
    expect(screen.getByText(/Practice Player link expires Oct 18, 2026/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Renew player link" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy player link" })).not.toBeDisabled();
  });

  it("downloads QR code PNG with safe event-specific filename", async () => {
    vi.mocked(api.getPublicPlayerLinkStatus).mockResolvedValue({
      active: true,
      eventId: testEvent.id,
      expiresAt: activeExpiresAt,
      issuedAt: activeIssuedAt,
      status: "active",
    });

    vi.mocked(api.generatePublicPlayerToken).mockResolvedValue({
      expiresAt: activeExpiresAt,
      issuedAt: activeIssuedAt,
      token: "token-123",
      url: "/player?mode=set-list&token=token-123",
    });

    render(<SetListManager enabled initialEventId={testEvent.id} />);
    await flushAsync();

    // Open QR dialog
    const qrButton = screen.getByRole("button", { name: "Player QR code" });
    act(() => {
      fireEvent.click(qrButton);
    });
    await flushAsync();

    const downloadButton = screen.getByRole("button", { name: "Download QR code" });
    expect(downloadButton).toBeInTheDocument();

    const clickSpy = vi.fn();
    const appendChildSpy = vi.spyOn(document.body, "appendChild").mockImplementation((node) => {
      if (node instanceof HTMLAnchorElement) {
        expect(node.download).toMatch(
          /_practice_player_qr_code_[0-9]{4}-[A-Z][a-z]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}-[0-9]{2}-(AM|PM)-UTC\.png$/,
        );
        node.click = clickSpy;
      }
      return node;
    });

    act(() => {
      fireEvent.click(downloadButton);
    });
    await flushAsync();

    expect(qrCodeModule.generateQRCodeDataUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCorrectionLevel: "H",
        payload: expect.stringContaining("/player?mode=set-list&token=token-123"),
        width: 512,
      }),
    );
    expect(clickSpy).toHaveBeenCalledTimes(1);

    appendChildSpy.mockRestore();
  });

  it("disables sharing controls when set list is not eligible (unapproved)", async () => {
    const unapprovedEvent = performanceEvent(
      "44444444-4444-4444-8444-444444444444",
      "Unapproved Concert",
      {
        approved: false,
        pieceId: "11111111-1111-4111-8111-111111111111",
      },
    );
    vi.mocked(api.listOrganizationEvents).mockResolvedValue([unapprovedEvent]);
    vi.mocked(api.getPublicPlayerLinkStatus).mockResolvedValue({
      active: false,
      eventId: unapprovedEvent.id,
      expiresAt: null,
      issuedAt: null,
      status: "none",
    });

    render(<SetListManager enabled initialEventId={unapprovedEvent.id} />);
    await flushAsync();

    const reason = "Approve this set list before opening the Practice Player.";
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Practice Player" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Copy player link" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Player QR code" })).toBeDisabled();
  });
});
