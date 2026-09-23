import type { CommunicationTemplate } from "@choir/contracts";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as apiModule from "../../api";
import { SystemTemplateResetAction } from "./SystemTemplateResetAction";

const customizedTemplate: CommunicationTemplate = {
  channel: "Both",
  contentMarkdown: "Older wording without venue details.",
  createdAt: "2026-01-01T00:00:00Z",
  id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000007",
  isSystem: true,
  subject: "Older ticket subject",
  title: "Ticket Confirmation",
  updatedAt: "2026-01-02T00:00:00Z",
};

const resetTemplate: CommunicationTemplate = {
  ...customizedTemplate,
  channel: "Email",
  contentMarkdown:
    "- **Venue:** {venueName}\n- **Address:** {venueAddress}\n- **Tickets:** {ticketQuantity}",
  subject: "Tickets confirmed: {eventTitle}",
  title: "Ticket Confirmation",
  updatedAt: "2026-01-03T00:00:00Z",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SystemTemplateResetAction", () => {
  it("hides reset for custom templates and requires confirmation for system templates", async () => {
    const user = userEvent.setup();
    const resetSpy = vi
      .spyOn(apiModule, "resetOrganizationCommunicationTemplateToSystemDefault")
      .mockResolvedValue(resetTemplate);
    const onReset = vi.fn();

    const { rerender } = render(
      <SystemTemplateResetAction
        onReset={onReset}
        template={{ ...customizedTemplate, isSystem: false }}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Reset to system default" }),
    ).not.toBeInTheDocument();
    expect(resetSpy).not.toHaveBeenCalled();

    rerender(<SystemTemplateResetAction onReset={onReset} template={customizedTemplate} />);
    const resetButton = screen.getByRole("button", { name: "Reset to system default" });
    await user.click(resetButton);

    const confirmation = screen.getByRole("dialog", { name: "Reset template to system default?" });
    expect(confirmation).toHaveTextContent(
      "This will replace this Organization's customized subject and message with the current system default.",
    );
    await user.click(within(confirmation).getByRole("button", { name: "Cancel" }));
    expect(resetSpy).not.toHaveBeenCalled();

    await user.click(resetButton);
    const secondConfirmation = screen.getByRole("dialog", {
      name: "Reset template to system default?",
    });
    await user.click(
      within(secondConfirmation).getByRole("button", { name: "Reset to system default" }),
    );

    await waitFor(() => {
      expect(resetSpy).toHaveBeenCalledWith(customizedTemplate.id);
      expect(onReset).toHaveBeenCalledWith(resetTemplate);
    });
  });

  it("keeps the customized template intact and announces reset failures", async () => {
    const user = userEvent.setup();
    const resetSpy = vi
      .spyOn(apiModule, "resetOrganizationCommunicationTemplateToSystemDefault")
      .mockRejectedValue(new Error("Reset service unavailable"));
    const onReset = vi.fn();
    render(<SystemTemplateResetAction onReset={onReset} template={customizedTemplate} />);

    await user.click(screen.getByRole("button", { name: "Reset to system default" }));
    const confirmation = screen.getByRole("dialog", { name: "Reset template to system default?" });
    await user.click(within(confirmation).getByRole("button", { name: "Reset to system default" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Reset service unavailable");
    expect(resetSpy).toHaveBeenCalledWith(customizedTemplate.id);
    expect(onReset).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reset to system default" })).toBeInTheDocument();
  });
});
