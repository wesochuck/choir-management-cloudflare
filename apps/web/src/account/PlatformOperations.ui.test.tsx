import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as platformApi from "../api/platform";
import * as authApi from "../auth/api";
import { PlatformOperations } from "./PlatformOperations";

vi.mock("../api/platform", () => ({
  getPlatformOrganizationStripeConnect: vi.fn(),
  resetPlatformOrganizationStripeConnect: vi.fn(),
  previewPlatformStripeReconciliation: vi.fn(),
  applyPlatformStripeReconciliation: vi.fn(),
}));
vi.mock("../auth/api", async (importOriginal) => ({
  ...(await importOriginal<typeof authApi>()),
  getPlatformOrganizationContext: vi.fn(),
  listPlatformOrganizations: vi.fn(),
}));
vi.mock("./components/PlatformOperations/OrganizationDomains", () => ({
  PlatformOrganizationDomains: () => null,
}));
vi.mock("./components/PlatformOperations/FleetSchemaPreparation", () => ({
  FleetSchemaPreparation: () => null,
}));

describe("Platform operations hostname placement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("directs product-base access visitors to the Organization directory", () => {
    render(<PlatformOperations mode="access" scope={{ kind: "product_base" }} />);
    expect(screen.getByRole("link", { name: "Organization directory" })).toHaveAttribute(
      "href",
      "/platform/organizations",
    );
    expect(screen.getByText(/choose “Manage access”/)).toBeInTheDocument();
    expect(platformApi.getPlatformOrganizationStripeConnect).not.toHaveBeenCalled();
  });

  it("offers refund preview on the Organization host without requesting base-only recovery", async () => {
    vi.mocked(authApi.getPlatformOrganizationContext).mockResolvedValue({
      canEdit: false,
      elevationExpiresAt: null,
      elevationId: null,
      organizationId: "org_test",
      requestId: "req_test",
      userId: "user_test",
    });
    vi.mocked(platformApi.previewPlatformStripeReconciliation).mockResolvedValue({
      accountId: "acct_test",
      hasMore: false,
      manualReviewCount: 0,
      matchedCount: 0,
      nextCursor: null,
      organizationId: "org_test",
      repairableCount: 0,
      requestId: "req_test",
      rows: [],
      scannedCount: 0,
      snapshotAt: "2026-09-26T12:00:00.000Z",
    });
    render(
      <PlatformOperations
        mode="access"
        scope={{ kind: "organization", organizationId: "org_test" }}
      />,
    );
    await screen.findByText("Read-only Platform access");
    fireEvent.click(screen.getByRole("button", { name: "Run reconciliation preview" }));
    await screen.findByText("Checked");
    expect(platformApi.previewPlatformStripeReconciliation).toHaveBeenCalledWith("org_test", {
      since: undefined,
    });
    expect(platformApi.getPlatformOrganizationStripeConnect).not.toHaveBeenCalled();
    expect(screen.queryByText("Stripe Connect recovery")).not.toBeInTheDocument();
  });

  it("loads Stripe recovery only when requested from the product-base directory", async () => {
    vi.mocked(authApi.listPlatformOrganizations).mockResolvedValue({
      nextCursor: null,
      organizations: [
        {
          canonicalHostname: "lmc.staging.musicsite.org",
          canonicalStatus: "active",
          lifecycleState: "active",
          name: "Lancaster Men's Chorus",
          operationalSchemaVersion: 1,
          organizationId: "org_test",
          provisionedAt: null,
          slug: "lmc",
        },
      ],
      requestId: "req_test",
    });
    vi.mocked(platformApi.getPlatformOrganizationStripeConnect).mockResolvedValue({
      accountId: null,
      activations: { tickets: false, donations: false, dues: false },
      eligibleForReset: false,
      hasPaymentHistory: false,
      hasPendingPayments: false,
      ineligibilityReason: null,
      organizationId: "org_test",
      requestId: "req_test",
      status: "not_started",
    });
    render(<PlatformOperations mode="organizations" scope={{ kind: "product_base" }} />);
    expect(await screen.findByRole("link", { name: "Manage access" })).toHaveAttribute(
      "href",
      "https://lmc.staging.musicsite.org/platform/access",
    );
    expect(platformApi.getPlatformOrganizationStripeConnect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Stripe Connect recovery" }));
    await screen.findByText("No Stripe account is currently connected to this Organization.");
    expect(platformApi.getPlatformOrganizationStripeConnect).toHaveBeenCalledWith(
      "org_test",
      expect.any(AbortSignal),
    );
  });
});
