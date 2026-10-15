import type { PublicWebsiteSettings } from "@choir/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../auth/api";
import { SaveBar, SaveCoordinatorProvider } from "../persistence";
import { PublicWebsiteManager } from "./PublicWebsiteManager";

vi.mock("../auth/api", async (importOriginal) => {
  const actual = await importOriginal<typeof authApi>();
  return {
    ...actual,
    getOrganizationPublicWebsiteSettings: vi.fn(),
    getPublishedOrganizationProjection: vi.fn(),
    publishOrganizationPublicWebsite: vi.fn(),
    updateOrganizationPublicWebsiteSettings: vi.fn(),
  };
});

const defaultSettings: PublicWebsiteSettings = {
  aboutUsText: "We are an all-volunteer community choir.",
  bodyFont: "system",
  contactEmail: "contact@example.test",
  enabledNavigation: ["tickets"],
  headerFont: "system",
  heroFileId: null,
  heroHeadline: "Welcome to Our Choir",
  heroSubtitle: "Voices in harmony",
  historyText: "",
  logoFileId: null,
  organizationName: "Test Chorus",
  publicationVersion: 0,
  publishedAt: null,
  showBrandingHeaderFooter: false,
  updatedAt: "2026-10-14T12:00:00.000Z",
};

describe("PublicWebsiteManager website publication readiness (#199, #255)", () => {
  beforeEach(() => {
    vi.mocked(authApi.getOrganizationPublicWebsiteSettings).mockReset();
    vi.mocked(authApi.getPublishedOrganizationProjection).mockReset();
    vi.mocked(authApi.publishOrganizationPublicWebsite).mockReset();
  });

  it("renders website readiness checklist with unpublished guidance when version is 0", async () => {
    vi.mocked(authApi.getOrganizationPublicWebsiteSettings).mockResolvedValue(defaultSettings);

    render(
      <SaveCoordinatorProvider>
        <PublicWebsiteManager enabled />
        <SaveBar />
      </SaveCoordinatorProvider>,
    );

    const readiness = await screen.findByRole("region", { name: "Website publication readiness" });
    expect(readiness).toHaveTextContent("Your public website is not published yet.");
    expect(readiness).toHaveTextContent("About Us: Draft ready");
    expect(readiness).toHaveTextContent(
      "Our History: Empty (History link stays hidden from navigation until published)",
    );
    expect(readiness).toHaveTextContent("Contact email: Configured (contact@example.test)");
    expect(readiness).toHaveTextContent("Navigation: Tickets");
    expect(readiness).toHaveTextContent(
      "Public navigation links (Performances and History) are hidden automatically whenever no published content exists for that section.",
    );
  });

  it("shows live publication version and date when published", async () => {
    vi.mocked(authApi.getOrganizationPublicWebsiteSettings).mockResolvedValue({
      ...defaultSettings,
      historyText: "Founded in 1999.",
      publicationVersion: 3,
      publishedAt: "2026-10-10T15:30:00.000Z",
    });

    render(
      <SaveCoordinatorProvider>
        <PublicWebsiteManager enabled />
        <SaveBar />
      </SaveCoordinatorProvider>,
    );

    const readiness = await screen.findByRole("region", { name: "Website publication readiness" });
    expect(readiness).toHaveTextContent(/Live version 3/);
    expect(readiness).toHaveTextContent(
      "Our History: Draft ready (History page appears in navigation)",
    );
  });

  it("publishes and confirms live version after successful projection verification", async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.getOrganizationPublicWebsiteSettings).mockResolvedValue(defaultSettings);
    vi.mocked(authApi.publishOrganizationPublicWebsite).mockResolvedValue({
      publishedAt: "2026-10-15T00:00:00.000Z",
      version: 1,
    });
    vi.mocked(authApi.getPublishedOrganizationProjection).mockResolvedValue({
      generatedAt: "2026-10-15T00:00:00.000Z",
      organizationId: "organization-alpha",
      payload: {
        mediaFileIds: [],
        organizationName: "Test Chorus",
        performances: [],
        settings: {
          aboutUsText: "We are an all-volunteer community choir.",
          bodyFont: "system",
          contactEmail: "contact@example.test",
          enabledNavigation: ["tickets"],
          headerFont: "system",
          heroFileId: null,
          heroHeadline: "Welcome to Our Choir",
          heroSubtitle: "Voices in harmony",
          historyText: "",
          logoFileId: null,
          showBrandingHeaderFooter: false,
        },
        ticketBundles: [],
        timezone: "UTC",
      },
      version: 1,
    });

    render(
      <SaveCoordinatorProvider>
        <PublicWebsiteManager enabled />
        <SaveBar />
      </SaveCoordinatorProvider>,
    );

    await screen.findByRole("region", { name: "Website publication readiness" });
    const publishButton = screen.getByRole("button", { name: "Publish saved draft" });
    await user.click(publishButton);

    expect(authApi.publishOrganizationPublicWebsite).toHaveBeenCalledTimes(1);
    expect(authApi.getPublishedOrganizationProjection).toHaveBeenCalledWith(undefined, {
      bypassCache: true,
    });

    const successMessage = await screen.findByRole("status");
    expect(successMessage).toHaveTextContent("Version 1 is live.");

    const readiness = screen.getByRole("region", { name: "Website publication readiness" });
    expect(readiness).toHaveTextContent("Version 1 is live.");
  });

  it("shows warning and allows retrying verification when initial projection verification fails", async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.getOrganizationPublicWebsiteSettings).mockResolvedValue(defaultSettings);
    vi.mocked(authApi.publishOrganizationPublicWebsite).mockResolvedValue({
      publishedAt: "2026-10-15T00:00:00.000Z",
      version: 2,
    });
    // First verification attempt fails
    vi.mocked(authApi.getPublishedOrganizationProjection).mockRejectedValueOnce(
      new Error("Network glitch"),
    );

    render(
      <SaveCoordinatorProvider>
        <PublicWebsiteManager enabled />
        <SaveBar />
      </SaveCoordinatorProvider>,
    );

    await screen.findByRole("region", { name: "Website publication readiness" });
    const publishButton = screen.getByRole("button", { name: "Publish saved draft" });
    await user.click(publishButton);

    // Shows verification warning
    const warning = await screen.findByRole("alert");
    expect(warning).toHaveTextContent("public verification could not be confirmed");
    expect(screen.getByRole("button", { name: "Retry verification" })).toBeInTheDocument();

    // Now resolve verification on retry
    vi.mocked(authApi.getPublishedOrganizationProjection).mockResolvedValueOnce({
      generatedAt: "2026-10-15T00:00:00.000Z",
      organizationId: "organization-alpha",
      payload: {
        mediaFileIds: [],
        organizationName: "Test Chorus",
        performances: [],
        settings: {
          aboutUsText: "We are an all-volunteer community choir.",
          bodyFont: "system",
          contactEmail: "contact@example.test",
          enabledNavigation: ["tickets"],
          headerFont: "system",
          heroFileId: null,
          heroHeadline: "Welcome to Our Choir",
          heroSubtitle: "Voices in harmony",
          historyText: "",
          logoFileId: null,
          showBrandingHeaderFooter: false,
        },
        ticketBundles: [],
        timezone: "UTC",
      },
      version: 2,
    });

    const retryButton = screen.getByRole("button", { name: "Retry verification" });
    await user.click(retryButton);

    // Should NOT have called publishOrganizationPublicWebsite again
    expect(authApi.publishOrganizationPublicWebsite).toHaveBeenCalledTimes(1);
    expect(authApi.getPublishedOrganizationProjection).toHaveBeenCalledTimes(2);

    const successMessage = await screen.findByRole("status");
    expect(successMessage).toHaveTextContent("Version 2 is live.");
  });
});
