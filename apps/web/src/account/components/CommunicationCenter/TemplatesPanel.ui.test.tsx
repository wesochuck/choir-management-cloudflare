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
  vi.restoreAllMocks();
});

describe("TemplatesPanel", () => {
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
});
