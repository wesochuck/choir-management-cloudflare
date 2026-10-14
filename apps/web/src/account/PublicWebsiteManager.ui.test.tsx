import type { PublicWebsiteSettings } from "@choir/contracts";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../auth/api";
import { SaveBar, SaveCoordinatorProvider } from "../persistence";
import { PublicWebsiteManager } from "./PublicWebsiteManager";

vi.mock("../auth/api", async (importOriginal) => {
  const actual = await importOriginal<typeof authApi>();
  return {
    ...actual,
    getOrganizationPublicWebsiteSettings: vi.fn(),
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

describe("PublicWebsiteManager website publication readiness (#199)", () => {
  beforeEach(() => {
    vi.mocked(authApi.getOrganizationPublicWebsiteSettings).mockReset();
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
});
