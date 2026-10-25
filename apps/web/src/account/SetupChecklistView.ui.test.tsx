import type { SetupStatus } from "@choir/contracts";
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSetupStatus } from "../api/setup";
import { SetupChecklistView } from "./SetupChecklistView";

vi.mock("../api/setup", () => ({ getSetupStatus: vi.fn() }));
vi.mock("./OrganizationProviderStatus", () => ({
  OrganizationProviderStatus: () => null,
  OrganizationStripeConnectSetup: () => null,
}));

const completeSetup: SetupStatus = {
  allModulesConfigured: true,
  completedSteps: ["organization_info", "modules", "theme", "launch"],
  currentStep: null,
  launched: true,
  organizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  organizationName: "Test Choir",
};

describe("Setup checklist required progress", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([{ optionalSteps: [] }, { optionalSteps: ["data_import"] }])(
    "reports setup complete regardless of optional import history %j",
    async ({ optionalSteps }) => {
      vi.mocked(getSetupStatus).mockResolvedValue({
        ...completeSetup,
        completedSteps: [...completeSetup.completedSteps, ...optionalSteps],
      });
      render(<SetupChecklistView />);
      expect(await screen.findByText("4 of 4 required steps completed.")).toBeVisible();
      expect(screen.getByRole("status")).toHaveTextContent("Setup is complete.");
      expect(screen.queryByText("Not completed.")).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Import existing data" })).not.toBeInTheDocument();
      expect(screen.getByText(/Data imports are optional and are not required/)).toBeVisible();
      expect(screen.getByRole("link", { name: "Roster" })).toHaveAttribute("href", "/admin/roster");
      expect(screen.getByRole("link", { name: "Music Library" })).toHaveAttribute(
        "href",
        "/admin/library",
      );
    },
  );

  it("continues to show missing required steps even if import was completed", async () => {
    vi.mocked(getSetupStatus).mockResolvedValue({
      ...completeSetup,
      completedSteps: ["modules", "theme", "data_import", "launch"],
    });
    render(<SetupChecklistView />);
    expect(await screen.findByText("3 of 4 required steps completed.")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("still need attention");
    const info = within(screen.getByRole("group", { name: "Organization Info" }));
    expect(info.getByText("Not completed.")).toBeInTheDocument();
    expect(info.getByRole("link", { name: "Complete organization info" })).toHaveAttribute(
      "href",
      "/setup",
    );
  });
});
