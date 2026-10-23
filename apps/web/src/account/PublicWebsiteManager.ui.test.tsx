import type { PublicWebsiteSettings } from "@choir/contracts";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../auth/api";
import * as api from "../api";
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

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    createOrganizationPublicDocument: vi.fn(),
    deleteOrganizationPublicDocument: vi.fn(),
    deletePrivateOrganizationFile: vi.fn(),
    listOrganizationPublicDocuments: vi.fn(),
    updateOrganizationPublicDocument: vi.fn(),
    uploadPrivateOrganizationFile: vi.fn(),
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
    vi.mocked(api.listOrganizationPublicDocuments).mockReset();
    vi.mocked(api.listOrganizationPublicDocuments).mockResolvedValue([]);
    vi.mocked(api.createOrganizationPublicDocument).mockReset();
    vi.mocked(api.updateOrganizationPublicDocument).mockReset();
    vi.mocked(api.deleteOrganizationPublicDocument).mockReset();
    vi.mocked(api.uploadPrivateOrganizationFile).mockReset();
    vi.mocked(api.deletePrivateOrganizationFile).mockReset();
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

  it("preserves in-progress edits when switching between editor tabs (#259)", async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.getOrganizationPublicWebsiteSettings).mockResolvedValue(defaultSettings);

    render(
      <SaveCoordinatorProvider>
        <PublicWebsiteManager enabled />
        <SaveBar />
      </SaveCoordinatorProvider>,
    );

    await screen.findByRole("region", { name: "Website publication readiness" });

    // In Home tab, edit hero headline
    const headlineInput = screen.getByLabelText("Hero headline");
    await user.clear(headlineInput);
    await user.type(headlineInput, "New Unsaved Headline");

    // Switch to History tab
    const historyTab = screen.getByRole("tab", { name: "History" });
    await user.click(historyTab);

    // Edit history text
    const historyTextarea = screen.getByLabelText("Our History (Markdown)");
    await user.type(historyTextarea, "Founded in 2026.");

    // Switch back to Home tab
    const homeTab = screen.getByRole("tab", { name: "Home" });
    await user.click(homeTab);

    expect(screen.getByLabelText("Hero headline")).toHaveValue("New Unsaved Headline");

    // Switch back to History tab
    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(screen.getByLabelText("Our History (Markdown)")).toHaveValue("Founded in 2026.");
  });

  it("updates the preview immediately as administrator edits fields (#259)", async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.getOrganizationPublicWebsiteSettings).mockResolvedValue(defaultSettings);

    render(
      <SaveCoordinatorProvider>
        <PublicWebsiteManager enabled />
        <SaveBar />
      </SaveCoordinatorProvider>,
    );

    const preview = await screen.findByRole("region", {
      name: "Public website draft preview",
    });
    expect(preview).toHaveTextContent("Welcome to Our Choir");

    const headlineInput = screen.getByLabelText("Hero headline");
    await user.clear(headlineInput);
    await user.type(headlineInput, "Voices of the Community");

    // Preview reflects immediately
    expect(preview).toHaveTextContent("Voices of the Community");
    expect(preview).toHaveTextContent("Draft — not public");
  });

  it("disables publish button when draft is dirty and requires saving first (#259)", async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.getOrganizationPublicWebsiteSettings).mockResolvedValue(defaultSettings);

    render(
      <SaveCoordinatorProvider>
        <PublicWebsiteManager enabled />
        <SaveBar />
      </SaveCoordinatorProvider>,
    );

    await screen.findByRole("region", { name: "Website publication readiness" });
    const publishButton = screen.getByRole("button", { name: "Publish saved draft" });
    expect(publishButton).not.toBeDisabled();

    // Type an edit
    const headlineInput = screen.getByLabelText("Hero headline");
    await user.type(headlineInput, " (Edited)");

    // Publish button is disabled with explanatory title and text
    expect(publishButton).toBeDisabled();
    expect(screen.getByText("Save your draft before publishing.")).toBeInTheDocument();
  });

  it("supports preview page and viewport simulation toggles without editorial prompts (#259)", async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.getOrganizationPublicWebsiteSettings).mockResolvedValue({
      ...defaultSettings,
      historyText: "Our history started long ago.",
    });

    render(
      <SaveCoordinatorProvider>
        <PublicWebsiteManager enabled />
        <SaveBar />
      </SaveCoordinatorProvider>,
    );

    const preview = await screen.findByRole("region", {
      name: "Public website draft preview",
    });

    // Switch preview page to History
    const pageGroup = screen.getByRole("group", { name: "Preview page" });
    const historyPreviewBtn = within(pageGroup).getByRole("button", { name: "History" });
    await user.click(historyPreviewBtn);
    expect(preview).toHaveTextContent("Our history started long ago.");

    // Toggle viewport to Mobile
    const mobileBtn = screen.getByRole("button", { name: "Mobile" });
    await user.click(mobileBtn);
    expect(mobileBtn).toHaveAttribute("aria-pressed", "true");

    // Verify editorial advice like "Make it welcoming" is NOT present anywhere
    expect(screen.queryByText(/Make it welcoming/i)).toBeNull();
    expect(screen.queryByText(/Make it yours/i)).toBeNull();
    expect(screen.queryByText(/A sentence or two works best/i)).toBeNull();
  });

  it("switches to Documents tab and renders uploaded documents list", async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.getOrganizationPublicWebsiteSettings).mockResolvedValue(defaultSettings);
    vi.mocked(api.listOrganizationPublicDocuments).mockResolvedValue([
      {
        contentType: "application/pdf",
        createdAt: "2026-01-01T00:00:00Z",
        downloadPath: "/api/public/documents/donation-form.pdf",
        fileId: "file-123",
        fileName: "donation-form.pdf",
        id: "doc-123",
        sizeBytes: 1024 * 50,
        slug: "donation-form",
        sortOrder: 0,
        title: "Mail-In Donation Form",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ]);

    render(
      <SaveCoordinatorProvider>
        <PublicWebsiteManager enabled />
        <SaveBar />
      </SaveCoordinatorProvider>,
    );

    await screen.findByRole("region", { name: "Website publication readiness" });
    expect(
      screen.getByRole("region", { name: "Public website draft preview" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish saved draft" })).toBeInTheDocument();

    // Click the Documents tab
    const documentsTab = screen.getByRole("tab", { name: "Documents" });
    await user.click(documentsTab);

    // Verify preview and draft actions are hidden on Documents tab
    expect(screen.queryByRole("region", { name: "Public website draft preview" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish saved draft" })).toBeNull();

    // Verify document table is rendered (DataTable renders both table rows and responsive mobile cards)
    const titles = await screen.findAllByText("Mail-In Donation Form");
    expect(titles.length).toBeGreaterThanOrEqual(1);

    expect(screen.getAllByText("PDF").length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText("/api/public/documents/donation-form.pdf").length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByRole("button", { name: "Copy link for Mail-In Donation Form" }).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByRole("link", { name: "Preview Mail-In Donation Form" })[0],
    ).toHaveAttribute("href", "/api/public/documents/donation-form.pdf");

    // Switching back to Home restores preview and draft actions
    await user.click(screen.getByRole("tab", { name: "Home" }));
    expect(
      screen.getByRole("region", { name: "Public website draft preview" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish saved draft" })).toBeInTheDocument();
  });
});
