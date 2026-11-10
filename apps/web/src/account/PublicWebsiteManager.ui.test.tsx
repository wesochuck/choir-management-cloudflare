import type { PublicWebsiteSettings } from "@choir/contracts";
import { render, screen, within, waitFor } from "@testing-library/react";
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
    vi.mocked(authApi.updateOrganizationPublicWebsiteSettings).mockReset();
    vi.mocked(api.listOrganizationPublicDocuments).mockReset();
    vi.mocked(api.listOrganizationPublicDocuments).mockResolvedValue([]);
    vi.mocked(api.createOrganizationPublicDocument).mockReset();
    vi.mocked(api.updateOrganizationPublicDocument).mockReset();
    vi.mocked(api.deleteOrganizationPublicDocument).mockReset();
    vi.mocked(api.uploadPrivateOrganizationFile).mockReset();
    vi.mocked(api.deletePrivateOrganizationFile).mockReset();
  });

  it("hides and restores the preview without changing drafts, page, or device", async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.getOrganizationPublicWebsiteSettings).mockResolvedValue({
      ...defaultSettings,
      historyText: "Our history",
    });
    render(
      <SaveCoordinatorProvider>
        <PublicWebsiteManager enabled />
        <SaveBar />
      </SaveCoordinatorProvider>,
    );
    await screen.findByLabelText("Publication state");
    await user.selectOptions(screen.getByRole("combobox", { name: "Page" }), "legacy-history");
    const body = screen.getByLabelText("Content (Markdown)");
    await user.type(body, " and more");
    if (!(body instanceof HTMLTextAreaElement)) throw new Error("Expected a textarea");
    const value = body.value;
    await user.click(
      within(screen.getByRole("group", { name: "Preview device" })).getByRole("button", {
        name: "Mobile",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Hide preview" }));
    expect(screen.queryByRole("group", { name: "Preview device" })).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Show preview" })).toHaveFocus());
    expect(body).toHaveValue(value);
    await user.click(screen.getByRole("button", { name: "Show preview" }));
    expect(
      within(screen.getByRole("group", { name: "Preview device" })).getByRole("button", {
        name: "Mobile",
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(body).toHaveValue(value);
    expect(screen.getByRole("combobox", { name: "Page" })).toHaveValue("legacy-history");
    expect(authApi.updateOrganizationPublicWebsiteSettings).not.toHaveBeenCalled();
  });
  it("shows compact unpublished state without a readiness checklist", async () => {
    vi.mocked(authApi.getOrganizationPublicWebsiteSettings).mockResolvedValue(defaultSettings);
    render(
      <SaveCoordinatorProvider>
        <PublicWebsiteManager enabled />
        <SaveBar />
      </SaveCoordinatorProvider>,
    );
    expect(await screen.findByLabelText("Publication state")).toHaveTextContent("Not published");
    expect(screen.getByLabelText("Content (Markdown)")).toHaveValue(defaultSettings.aboutUsText);
    expect(screen.queryByRole("heading", { name: "About Us" })).toBeNull();

    expect(screen.queryByRole("region", { name: "Website publication readiness" })).toBeNull();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Pages",
      "Appearance",
      "Labels & navigation",
      "Tracking",
      "Footer",
      "Documents",
    ]);
  });

  it("saves Google Ads tracking and retains it across editor tabs", async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.getOrganizationPublicWebsiteSettings).mockResolvedValue(defaultSettings);
    vi.mocked(authApi.updateOrganizationPublicWebsiteSettings).mockResolvedValue({
      ...defaultSettings,
      googleAdsTagId: "AW-123456789",
      draftRevision: 1,
    });
    render(
      <SaveCoordinatorProvider>
        <PublicWebsiteManager enabled />
        <SaveBar />
      </SaveCoordinatorProvider>,
    );
    await screen.findByLabelText("Publication state");
    await user.click(screen.getByRole("tab", { name: "Tracking" }));
    await user.type(screen.getByLabelText("Google Ads tag ID"), "AW-123456789");
    await user.click(screen.getByRole("tab", { name: "Appearance" }));
    await user.click(screen.getByRole("tab", { name: "Tracking" }));
    expect(screen.getByLabelText("Google Ads tag ID")).toHaveValue("AW-123456789");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => {
      expect(authApi.updateOrganizationPublicWebsiteSettings).toHaveBeenCalledWith(
        expect.objectContaining({ googleAdsTagId: "AW-123456789" }),
      );
    });
    expect(document.querySelector('script[src*="googletagmanager.com"]')).toBeNull();
  });

  it("edits the public menu option under Labels & navigation and preserves it across tabs and saving", async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.getOrganizationPublicWebsiteSettings).mockResolvedValue(defaultSettings);
    vi.mocked(authApi.updateOrganizationPublicWebsiteSettings).mockResolvedValueOnce({
      ...defaultSettings,
      showBrandingHeaderFooter: true,
      draftRevision: 1,
    });
    render(
      <SaveCoordinatorProvider>
        <PublicWebsiteManager enabled />
        <SaveBar />
      </SaveCoordinatorProvider>,
    );
    await screen.findByLabelText("Publication state");
    await user.click(screen.getByRole("tab", { name: "Appearance" }));
    const label = "Show website navigation on ticket, donation, and audition pages";
    expect(screen.queryByRole("checkbox", { name: label })).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Labels & navigation" }));
    const checkbox = screen.getByRole("checkbox", { name: label });
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
    await user.click(screen.getByRole("tab", { name: "Appearance" }));
    await user.click(screen.getByRole("tab", { name: "Labels & navigation" }));
    expect(screen.getByRole("checkbox", { name: label })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => {
      expect(authApi.updateOrganizationPublicWebsiteSettings).toHaveBeenCalledWith(
        expect.objectContaining({ showBrandingHeaderFooter: true }),
      );
    });
    expect(screen.getByRole("checkbox", { name: label })).toBeChecked();
  });

  it("does not claim a saved published version is verified live", async () => {
    vi.mocked(authApi.getOrganizationPublicWebsiteSettings).mockResolvedValue({
      ...defaultSettings,
      publicationVersion: 3,
    });
    render(
      <SaveCoordinatorProvider>
        <PublicWebsiteManager enabled />
        <SaveBar />
      </SaveCoordinatorProvider>,
    );
    expect(await screen.findByLabelText("Publication state")).toHaveTextContent(
      "Publication verification pending",
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

    await screen.findByLabelText("Publication state");
    const publishButton = screen.getByRole("button", { name: "Publish saved draft" });
    await user.click(publishButton);

    expect(authApi.publishOrganizationPublicWebsite).toHaveBeenCalledTimes(1);
    expect(authApi.getPublishedOrganizationProjection).toHaveBeenCalledWith(undefined, {
      bypassCache: true,
    });

    const successMessage = await screen.findByText(/Version \d+ is live\./);
    expect(successMessage).toHaveTextContent("Version 1 is live.");

    const readiness = screen.getByLabelText("Publication state");
    expect(readiness).toHaveTextContent("Live · Published");
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

    await screen.findByLabelText("Publication state");
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

    const successMessage = await screen.findByText(/Version \d+ is live\./);
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

    await screen.findByLabelText("Publication state");

    // In Home tab, edit hero headline
    const headlineInput = screen.getByLabelText("Hero headline");
    await user.clear(headlineInput);
    await user.type(headlineInput, "New Unsaved Headline");

    await user.click(screen.getByRole("button", { name: "Add page" }));
    await user.type(screen.getByLabelText("Page title"), "Our History");

    // Edit history text
    const historyTextarea = screen.getByLabelText("Content (Markdown)");
    await user.type(historyTextarea, "Founded in 2026.");

    // Switch back to Home tab
    await user.selectOptions(screen.getByRole("combobox", { name: "Page" }), "home");

    expect(screen.getByLabelText("Hero headline")).toHaveValue("New Unsaved Headline");

    // Switch back to History tab
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Page" }),
      screen.getByRole("option", { name: "Our History" }),
    );
    expect(screen.getByLabelText("Content (Markdown)")).toHaveValue("Founded in 2026.");
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

    await screen.findByLabelText("Publication state");
    const publishButton = screen.getByRole("button", { name: "Publish saved draft" });
    expect(publishButton).not.toBeDisabled();

    // Type an edit
    const headlineInput = screen.getByLabelText("Hero headline");
    await user.type(headlineInput, " (Edited)");

    // Publish button is disabled with explanatory title and text
    expect(publishButton).toBeDisabled();
    expect(screen.getByText("Save your draft before publishing.")).toBeInTheDocument();
  });

  it("follows editor tabs without duplicate preview page controls and retains viewport toggles", async () => {
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

    expect(screen.queryByRole("group", { name: "Preview page" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Page" }), "legacy-history");
    expect(preview).toHaveTextContent("Our history started long ago.");

    await user.click(screen.getByRole("tab", { name: "Appearance" }));
    expect(preview).toHaveTextContent("Our history started long ago.");
    await user.click(screen.getByRole("tab", { name: "Pages" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Page" }), "home");
    expect(within(preview).queryByRole("heading", { name: "Our History" })).not.toBeInTheDocument();

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

    await screen.findByLabelText("Publication state");
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
    await user.click(screen.getByRole("tab", { name: "Pages" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Page" }), "home");
    expect(
      screen.getByRole("region", { name: "Public website draft preview" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish saved draft" })).toBeInTheDocument();
  });
  it("keeps a manually chosen new URL across section switches and later title edits", async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.getOrganizationPublicWebsiteSettings).mockResolvedValue(defaultSettings);
    render(
      <SaveCoordinatorProvider>
        <PublicWebsiteManager enabled />
        <SaveBar />
      </SaveCoordinatorProvider>,
    );
    await screen.findByLabelText("Publication state");
    await user.click(screen.getByRole("button", { name: "Add page" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Page title")).toHaveFocus();
    });
    await user.type(screen.getByLabelText("Page title"), "Our story");
    expect(screen.getByLabelText("Page URL")).toHaveValue("our-story");
    await user.clear(screen.getByLabelText("Page URL"));
    await user.type(screen.getByLabelText("Page URL"), "story");
    await user.click(screen.getByRole("tab", { name: "Appearance" }));
    await user.click(screen.getByRole("tab", { name: "Pages" }));
    await user.type(screen.getByLabelText("Page title"), " together");
    expect(screen.getByLabelText("Page URL")).toHaveValue("story");
  });

  it("keeps local page edits and the SaveBar after a typed draft conflict", async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.getOrganizationPublicWebsiteSettings).mockResolvedValue({
      ...defaultSettings,
      draftRevision: 4,
      pages: [
        { id: "story", slug: "story", title: "Story", body: "Original", showInNavigation: true },
      ],
    });
    vi.mocked(authApi.updateOrganizationPublicWebsiteSettings).mockRejectedValue(
      new authApi.AuthApiError("This draft changed in another tab.", 409, "website_draft_conflict"),
    );
    render(
      <SaveCoordinatorProvider>
        <PublicWebsiteManager enabled />
        <SaveBar />
      </SaveCoordinatorProvider>,
    );
    await screen.findByLabelText("Publication state");
    await user.selectOptions(screen.getByRole("combobox", { name: "Page" }), "story");
    await user.type(screen.getByLabelText("Content (Markdown)"), " plus my changes");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("This draft changed in another tab.")).toBeInTheDocument();
    expect(screen.getByLabelText("Content (Markdown)")).toHaveValue("Original plus my changes");
    expect(screen.getByRole("region", { name: "Unsaved changes" })).toBeInTheDocument();
    expect(authApi.updateOrganizationPublicWebsiteSettings).toHaveBeenCalledWith(
      expect.objectContaining({ expectedDraftRevision: 4 }),
    );
  });
});
