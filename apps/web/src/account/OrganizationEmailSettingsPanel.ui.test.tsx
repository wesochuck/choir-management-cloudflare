import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { OrganizationEmailSettings } from "@choir/contracts";
import { OrganizationEmailSettingsPanel } from "./OrganizationEmailSettingsPanel";

vi.mock("../auth/api", () => ({
  AuthApiError: class AuthApiError extends Error {},
  getOrganizationEmailSettings: vi.fn(),
  updateOrganizationEmailSettings: vi.fn(),
  verifyOrganizationEmailDomain: vi.fn(),
}));

import { getOrganizationEmailSettings } from "../auth/api";

const MOCK_SETTINGS: OrganizationEmailSettings = {
  customDomain: "choir.example.com",
  customDomainStatus: "pending",
  dnsRecords: [
    {
      name: "mail._domainkey.choir.example.com",
      purpose: "dkim",
      status: "valid",
      type: "TXT",
      value: "v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC3...",
    },
    {
      name: "choir.example.com",
      purpose: "return_path",
      status: "pending",
      type: "MX",
      value: "feedback-smtp.us-east-1.amazonses.com",
    },
  ],
  fromName: "Demo Choir",
  lastCheckedAt: null,
  replyToEmail: "info@choir.example.com",
  verifiedAt: null,
};

describe("OrganizationEmailSettingsPanel DNS table", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOrganizationEmailSettings).mockResolvedValue(MOCK_SETTINGS);
  });

  it("renders DNS authentication records in shared DataTable with sortable columns", async () => {
    render(<OrganizationEmailSettingsPanel />);

    await waitFor(() => {
      expect(screen.getByText("DNS Authentication Records")).toBeInTheDocument();
    });

    // Check DataTable structure
    const dnsPanel = document.querySelector(".dns-checklist-panel");
    expect(dnsPanel).not.toBeNull();
    if (!(dnsPanel instanceof HTMLElement)) throw new Error("dnsPanel missing");

    expect(dnsPanel.querySelector(".data-table-container")).toBeInTheDocument();
    expect(dnsPanel.querySelector("table.data-table")).toBeInTheDocument();
    expect(dnsPanel.querySelector(".data-table-cards")).toBeInTheDocument();

    // Check sortable headers
    expect(within(dnsPanel).getByRole("button", { name: "Sort by Type" })).toBeInTheDocument();
    expect(
      within(dnsPanel).getByRole("button", { name: "Sort by Name / Host" }),
    ).toBeInTheDocument();
    expect(
      within(dnsPanel).getByRole("button", { name: "Sort by Value / Destination" }),
    ).toBeInTheDocument();
    expect(within(dnsPanel).getByRole("button", { name: "Sort by Status" })).toBeInTheDocument();

    // Verify token class for break-all
    const tokens = dnsPanel.querySelectorAll(".dns-record-token");
    expect(tokens.length).toBeGreaterThan(0);
  });

  it("copies record value to clipboard with accessible button label", async () => {
    const user = userEvent.setup();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: writeTextMock,
      },
    });

    render(<OrganizationEmailSettingsPanel />);

    await waitFor(() => {
      expect(screen.getByText("DNS Authentication Records")).toBeInTheDocument();
    });

    const dnsPanel = document.querySelector(".dns-checklist-panel");
    if (!(dnsPanel instanceof HTMLElement)) throw new Error("dnsPanel missing");
    const table = dnsPanel.querySelector("table.data-table");
    if (!(table instanceof HTMLElement)) throw new Error("table missing");
    const copyButton = within(table).getByRole("button", {
      name: "Copy value for TXT record mail._domainkey.choir.example.com",
    });

    await user.click(copyButton);
    expect(writeTextMock).toHaveBeenCalledWith(
      "v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC3...",
    );
    expect(copyButton).toHaveTextContent("Copied!");
  });
});
