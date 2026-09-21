import type {
  OrganizationProviderStatusResponse,
  OrganizationStripeConnectStatusResponse,
} from "@choir/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  OrganizationProviderStatus,
  OrganizationStripeConnectSetup,
} from "./OrganizationProviderStatus";
import * as authApi from "../auth/api";

vi.mock("../auth/api", async () => {
  const actual = await vi.importActual("../auth/api");
  return {
    ...actual,
    getOrganizationProviderStatus: vi.fn(),
    getOrganizationStripeConnectStatus: vi.fn(),
    startOrganizationStripeConnectOnboarding: vi.fn(),
  };
});

const mockPlatformConfigured: OrganizationProviderStatusResponse = {
  brevo: {
    detail: "Email sends through the Cloudflare Email Sending binding.",
    status: "ok",
  },
  emailSender: { fromEmail: "admin@example.com", fromName: "Test Choir" },
  environment: "staging",
  externalEffectsMode: "sandbox",
  requestId: "11111111-1111-4111-8111-111111111111",
  stripe: {
    detail:
      "Stripe Connect platform credentials and webhook verification are configured. Organization Stripe Connect onboarding is available.",
    status: "ok",
  },
};

const mockPlatformAttention: OrganizationProviderStatusResponse = {
  ...mockPlatformConfigured,
  externalEffectsMode: "fake",
  stripe: {
    detail:
      "Stripe Connect platform credentials are configured, but checkout remains simulated in fake mode.",
    status: "attention",
  },
};

const mockPlatformError: OrganizationProviderStatusResponse = {
  ...mockPlatformConfigured,
  stripe: {
    detail: "Add STRIPE_SECRET_KEY for Stripe Connect onboarding.",
    status: "error",
  },
};

const mockConnectReady: OrganizationStripeConnectStatusResponse = {
  platformConfigured: true,
  requestId: "11111111-1111-4111-8111-111111111111",
  stripe: {
    accountId: "acct_1234567890",
    chargesEnabled: true,
    dashboardType: "full",
    detailsSubmitted: true,
    payoutsEnabled: true,
    requirementsDue: [],
    status: "ready",
  },
};

describe("OrganizationProviderStatus UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Stripe platform configuration as Configured when healthy", async () => {
    vi.mocked(authApi.getOrganizationProviderStatus).mockResolvedValue(mockPlatformConfigured);

    render(<OrganizationProviderStatus />);

    await waitFor(() => {
      expect(screen.getByText("Stripe platform configuration")).toBeInTheDocument();
    });

    const stripeRow = screen
      .getByText("Stripe platform configuration")
      .closest(".provider-status-card__row");
    expect(stripeRow).not.toBeNull();
    expect(stripeRow).toHaveTextContent("Configured");
    expect(
      screen.getByText(
        "Stripe Connect platform credentials and webhook verification are configured. Organization Stripe Connect onboarding is available.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
  });

  it("renders Needs attention when Stripe provider status is attention", async () => {
    vi.mocked(authApi.getOrganizationProviderStatus).mockResolvedValue(mockPlatformAttention);

    render(<OrganizationProviderStatus />);

    await waitFor(() => {
      expect(screen.getByText("Stripe platform configuration")).toBeInTheDocument();
    });

    const stripeRow = screen
      .getByText("Stripe platform configuration")
      .closest(".provider-status-card__row");
    expect(stripeRow).not.toBeNull();
    expect(stripeRow).toHaveTextContent("Needs attention");
  });

  it("renders Not configured when Stripe provider status is error", async () => {
    vi.mocked(authApi.getOrganizationProviderStatus).mockResolvedValue(mockPlatformError);

    render(<OrganizationProviderStatus />);

    await waitFor(() => {
      expect(screen.getByText("Stripe platform configuration")).toBeInTheDocument();
    });

    const stripeRow = screen
      .getByText("Stripe platform configuration")
      .closest(".provider-status-card__row");
    expect(stripeRow).not.toBeNull();
    expect(stripeRow).toHaveTextContent("Not configured");
  });

  it("regression: platform configured + Organization Connect ready displays Configured and Ready without platform warning", async () => {
    vi.mocked(authApi.getOrganizationProviderStatus).mockResolvedValue(mockPlatformConfigured);
    vi.mocked(authApi.getOrganizationStripeConnectStatus).mockResolvedValue(mockConnectReady);

    render(
      <div>
        <OrganizationStripeConnectSetup />
        <OrganizationProviderStatus />
      </div>,
    );

    // Organization Connect account shows Ready
    await waitFor(() => {
      expect(screen.getByText("Stripe Connect is ready for payments.")).toBeInTheDocument();
    });
    expect(screen.getByText("Ready")).toBeInTheDocument();

    // Platform provider row shows Configured
    const stripeRow = screen
      .getByText("Stripe platform configuration")
      .closest(".provider-status-card__row");
    expect(stripeRow).not.toBeNull();
    expect(stripeRow).toHaveTextContent("Configured");

    // There must be no "Needs attention" badge displayed
    expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
  });
});
