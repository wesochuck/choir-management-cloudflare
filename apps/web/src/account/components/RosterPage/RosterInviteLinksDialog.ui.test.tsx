import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RosterInviteLinksDialog } from "./RosterInviteLinksDialog";
import * as api from "../../../api";
import { generateQRCodeDataUrl } from "../../../shared/qrCode";

vi.mock("../../../shared/qrCode", () => ({ generateQRCodeDataUrl: vi.fn() }));

vi.mock("../../../api", async () => {
  const actual = await vi.importActual("../../../api");
  return {
    ...actual,
    createRosterInviteLink: vi.fn(),
    listRosterInviteLinks: vi.fn(),
    revokeRosterInviteLink: vi.fn(),
    shareRosterInviteLink: vi.fn(),
  };
});

describe("RosterInviteLinksDialog UI interaction", () => {
  it("renders form, lists existing links, and allows creating a new link", async () => {
    const user = userEvent.setup();
    const mockLinks = [
      {
        activeReservations: 0,
        committedUses: 2,
        createdAt: new Date().toISOString(),
        createdByUserId: "user-1",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        id: "link-1",
        label: "Spring Alto Link",
        maxUses: 10,
        organizationId: "org-1",
        revokedAt: null,
        status: "active" as const,
      },
    ];

    vi.mocked(api.listRosterInviteLinks).mockResolvedValue({
      links: mockLinks,
      requestId: "req-1",
    });

    vi.mocked(api.createRosterInviteLink).mockResolvedValue({
      expiresAt: new Date(Date.now() + 86400000 * 7).toISOString(),
      id: "link-new",
      requestId: "req-2",
      shareUrl: "https://choir.test/join-roster#token=mock-token",
    });

    render(<RosterInviteLinksDialog onClose={vi.fn()} open={true} />);

    // Check heading & existing links
    expect(screen.getByText("Roster invite links")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByText("Spring Alto Link").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText("2 / 10").length).toBeGreaterThan(0);

    // Create a new link
    const labelInput = screen.getByLabelText("Link label");
    await user.clear(labelInput);
    await user.type(labelInput, "Fall Tenors");

    const maxUsesInput = screen.getByLabelText("Max uses (optional)");
    await user.type(maxUsesInput, "5");

    const submitBtn = screen.getByRole("button", { name: /create invite link/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(api.createRosterInviteLink).toHaveBeenCalledWith({
        expiresInDays: 7,
        label: "Fall Tenors",
        maxUses: 5,
      });
    });
  });

  it("copies share URL when copy link button is clicked", async () => {
    const mockLinks = [
      {
        activeReservations: 0,
        committedUses: 0,
        createdAt: new Date().toISOString(),
        createdByUserId: "user-1",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        id: "link-1",
        label: "Shareable Link",
        maxUses: null,
        organizationId: "org-1",
        revokedAt: null,
        status: "active" as const,
      },
    ];

    vi.mocked(api.listRosterInviteLinks).mockResolvedValue({
      links: mockLinks,
      requestId: "req-1",
    });

    vi.mocked(api.shareRosterInviteLink).mockResolvedValue({
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      id: "link-1",
      requestId: "req-share",
      shareUrl: "https://choir.test/join-roster#token=shared-token",
    });

    render(<RosterInviteLinksDialog onClose={vi.fn()} open={true} />);

    await waitFor(() => {
      expect(screen.getAllByText("Shareable Link").length).toBeGreaterThan(0);
    });

    const copyBtns = screen.getAllByRole("button", { name: "Copy link" });
    const copyBtn = copyBtns[0];
    expect(copyBtn).toBeDefined();
    if (copyBtn) {
      fireEvent.click(copyBtn);
    }

    await waitFor(() => {
      expect(api.shareRosterInviteLink).toHaveBeenCalledWith("link-1");
      expect(screen.getAllByText("Copied!").length).toBeGreaterThan(0);
    });
  });

  it("uses canonical form layout with full-width label, paired grid, and form-actions--end", async () => {
    vi.mocked(api.listRosterInviteLinks).mockResolvedValue({
      links: [],
      requestId: "req-layout",
    });

    render(<RosterInviteLinksDialog onClose={vi.fn()} open={true} />);
    await waitFor(() => {
      expect(screen.getByText("Roster invite links")).toBeInTheDocument();
    });

    const labelInput = screen.getByLabelText("Link label");
    const expirySelect = screen.getByLabelText("Expiration");
    const maxUsesInput = screen.getByLabelText("Max uses (optional)");

    // Link label is outside the form-grid
    expect(labelInput.closest(".form-grid")).toBeNull();

    // Expiration and Max uses are paired inside the form-grid
    const formGrid = expirySelect.closest(".form-grid");
    expect(formGrid).not.toBeNull();
    expect(maxUsesInput.closest(".form-grid")).toBe(formGrid);

    // Create button is in a form-actions--end container
    const createBtn = screen.getByRole("button", { name: "Create invite link" });
    const actionContainer = createBtn.closest(".form-actions");
    expect(actionContainer).toHaveClass("form-actions--end");
  });
});

describe("roster invite QR download", () => {
  const shareUrl = "https://alpha.example.test/join-roster#token=synthetic-test-token";
  beforeEach(() => {
    vi.mocked(api.listRosterInviteLinks).mockResolvedValue({
      requestId: "request",
      links: [
        {
          id: "invite-qr",
          label: "Community rehearsal",
          status: "active",
          maxUses: null,
          committedUses: 0,
          activeReservations: 0,
          createdByUserId: "admin",
          organizationId: "alpha",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          revokedAt: null,
        },
      ],
    });
    vi.mocked(api.shareRosterInviteLink)
      .mockReset()
      .mockResolvedValue({
        id: "invite-qr",
        shareUrl,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        requestId: "request",
      });
    vi.mocked(generateQRCodeDataUrl).mockReset().mockResolvedValue("data:image/png;base64,cG5n");
  });
  it("downloads a PNG using the unmodified sharing URL", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.download).toMatch(/roster_invite_qr.*\.png$/);
      expect(this.href).toBe("data:image/png;base64,cG5n");
    });
    try {
      render(<RosterInviteLinksDialog open onClose={vi.fn()} />);
      const buttons = await screen.findAllByRole("button", {
        name: "Download QR code",
      });
      const button = buttons.at(0);
      if (!button) throw new Error("Missing QR action");
      fireEvent.click(button);
      await waitFor(() => {
        expect(click).toHaveBeenCalledTimes(1);
      });
      expect(api.shareRosterInviteLink).toHaveBeenCalledWith("invite-qr");
      expect(generateQRCodeDataUrl).toHaveBeenCalledWith({ payload: shareUrl, width: 512 });
      expect(screen.getByRole("status")).toHaveTextContent("QR image downloaded");
    } finally {
      click.mockRestore();
    }
  });
  it.each(["share", "generation"])("reports %s failure and allows retry", async (failure) => {
    if (failure === "share")
      vi.mocked(api.shareRosterInviteLink).mockRejectedValue(new Error("failed"));
    else vi.mocked(generateQRCodeDataUrl).mockRejectedValue(new Error("failed"));
    render(<RosterInviteLinksDialog open onClose={vi.fn()} />);
    const button = (await screen.findAllByRole("button", { name: "Download QR code" })).at(0);
    if (!button) throw new Error("Missing QR action");
    fireEvent.click(button);
    await expect(screen.findByRole("alert")).resolves.toHaveTextContent(
      "Could not download the QR image",
    );
    expect(button).toBeEnabled();
  });
});
