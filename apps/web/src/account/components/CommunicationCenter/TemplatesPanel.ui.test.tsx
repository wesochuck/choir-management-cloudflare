import type { CommunicationTemplate } from "@choir/contracts";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as apiModule from "../../../auth/api";
import * as organizationApi from "../../../api";
import { TemplatesPanel } from "./TemplatesPanel";

const systemTemplate: CommunicationTemplate = {
  channel: "Both",
  contentMarkdown: "Legacy announcement wording without current details.",
  createdAt: "2026-01-01T00:00:00Z",
  id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000001",
  isSystem: true,
  subject: "Legacy subject",
  title: "Legacy Announcement Name",
  updatedAt: "2026-01-02T00:00:00Z",
};

const customTemplate: CommunicationTemplate = {
  channel: "Email",
  contentMarkdown: "Custom message body.",
  createdAt: "2026-01-01T00:00:00Z",
  id: "7ad6f60b-d383-4b0c-8fa8-3bc22b0f1432",
  isSystem: false,
  subject: "Custom subject",
  title: "Custom announcement",
  updatedAt: "2026-01-02T00:00:00Z",
};

const resetTemplate: CommunicationTemplate = {
  ...systemTemplate,
  channel: "Email",
  contentMarkdown: "## Your announcement\n\n[Lead with the most important update.]",
  subject: "Choir update: [Key message]",
  title: "General Announcement",
  updatedAt: "2026-01-03T00:00:00Z",
};

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

describe("TemplatesPanel", () => {
  it("opens the linked template even when it is absent from the displayed page", async () => {
    window.history.replaceState(
      null,
      "",
      `/admin/communications?tab=templates&templateId=${systemTemplate.id}`,
    );
    vi.spyOn(apiModule, "listOrganizationCommunicationTemplates").mockResolvedValue([
      systemTemplate,
    ]);
    vi.spyOn(organizationApi, "getOrganizationCommunicationTemplatesPage").mockResolvedValue({
      templates: [customTemplate],
      nextCursor: null,
    });
    render(<TemplatesPanel />);
    const dialog = await screen.findByRole("dialog", { name: "Edit template wording" });
    expect(within(dialog).getByDisplayValue(systemTemplate.subject)).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue(systemTemplate.contentMarkdown)).toBeInTheDocument();
  });

  it("keeps the template list usable when a linked template no longer exists", async () => {
    window.history.replaceState(null, "", "/admin/communications?tab=templates&templateId=missing");
    vi.spyOn(apiModule, "listOrganizationCommunicationTemplates").mockResolvedValue([
      customTemplate,
    ]);
    vi.spyOn(organizationApi, "getOrganizationCommunicationTemplatesPage").mockResolvedValue({
      templates: [customTemplate],
      nextCursor: null,
    });
    render(<TemplatesPanel />);
    expect(
      await screen.findByText(
        "This template is unavailable. Choose a template from the list below.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Edit template wording" })).not.toBeInTheDocument();
    expect(await screen.findByRole("article", { name: customTemplate.title })).toBeInTheDocument();
  });

  it("resets system wording in place and omits reset for a custom template", async () => {
    const user = userEvent.setup();
    vi.spyOn(apiModule, "listOrganizationCommunicationTemplates").mockResolvedValue([
      systemTemplate,
      customTemplate,
    ]);
    const resetSpy = vi
      .spyOn(organizationApi, "resetOrganizationCommunicationTemplateToSystemDefault")
      .mockResolvedValue(resetTemplate);

    render(<TemplatesPanel />);
    await waitFor(() => {
      expect(screen.getByRole("article", { name: systemTemplate.title })).toBeInTheDocument();
    });

    const systemCard = screen.getByRole("article", { name: systemTemplate.title });
    await user.click(within(systemCard).getByRole("button", { name: "Edit wording" }));
    await user.click(screen.getByRole("button", { name: "Reset to system default" }));
    const confirmation = screen.getByRole("dialog", { name: "Reset template to system default?" });
    await user.click(within(confirmation).getByRole("button", { name: "Reset to system default" }));

    await waitFor(() => {
      expect(resetSpy).toHaveBeenCalledWith(systemTemplate.id);
      expect(screen.getByRole("article", { name: resetTemplate.title })).toBeInTheDocument();
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "General Announcement reset to the system default.",
    );
    expect(screen.getByRole("article", { name: resetTemplate.title })).toHaveTextContent("Email");
    expect(screen.getByRole("article", { name: resetTemplate.title })).toHaveTextContent(
      "Subject: Choir update: [Key message]",
    );

    const customCard = screen.getByRole("article", { name: customTemplate.title });
    await user.click(within(customCard).getByRole("button", { name: "Edit wording" }));
    expect(
      screen.queryByRole("button", { name: "Reset to system default" }),
    ).not.toBeInTheDocument();
  });

  it("paginates communication templates across pages", async () => {
    const user = userEvent.setup();
    const templatesPageSpy = vi
      .spyOn(organizationApi, "getOrganizationCommunicationTemplatesPage")
      .mockResolvedValueOnce({
        nextCursor: "cursor-page-2",
        templates: [systemTemplate],
      })
      .mockResolvedValueOnce({
        nextCursor: null,
        templates: [customTemplate],
      });

    render(<TemplatesPanel />);
    await waitFor(() => {
      expect(screen.getByRole("article", { name: systemTemplate.title })).toBeInTheDocument();
    });

    const nextButton = screen.getByRole("button", { name: "Next page" });
    expect(nextButton).toBeEnabled();
    const prevButton = screen.getByRole("button", { name: "Previous page" });
    expect(prevButton).toBeDisabled();

    await user.click(nextButton);

    await waitFor(() => {
      expect(screen.getByRole("article", { name: customTemplate.title })).toBeInTheDocument();
    });
    expect(templatesPageSpy).toHaveBeenCalledTimes(2);
    expect(nextButton).toBeDisabled();
    expect(prevButton).toBeEnabled();
  });

  it("displays placeholder guidance when templates contain event-required placeholders", async () => {
    const user = userEvent.setup();
    const eventReminderTemplate: CommunicationTemplate = {
      channel: "Email",
      contentMarkdown: "Reminder: we have rehearsal coming up. Don't forget your music!",
      createdAt: "2026-01-01T00:00:00Z",
      id: "7ad6f60b-d383-4b0c-8fa8-3bc22b0f1499",
      isSystem: false,
      subject: "Rehearsal reminder: {eventTitle}",
      title: "Event Reminder Custom",
      updatedAt: "2026-01-02T00:00:00Z",
    };
    vi.spyOn(apiModule, "listOrganizationCommunicationTemplates").mockResolvedValue([
      eventReminderTemplate,
    ]);

    render(<TemplatesPanel />);
    await waitFor(() => {
      expect(
        screen.getByRole("article", { name: eventReminderTemplate.title }),
      ).toBeInTheDocument();
    });

    const card = screen.getByRole("article", { name: eventReminderTemplate.title });
    await user.click(within(card).getByRole("button", { name: "Edit wording" }));

    const guidance = screen.getByRole("note", { name: "Template placeholder guidance" });
    expect(guidance).toBeInTheDocument();
    expect(guidance).toHaveTextContent(
      "Event variables ({eventTitle}) require an associated event and will only resolve during event-related sends or reminders.",
    );
  });
});
