import type { CommunicationTemplate, TicketConfirmationSettings } from "@choir/contracts";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import * as apiModule from "../../../auth/api";
import * as organizationApi from "../../../api";
import { ConfirmationPanel } from "./ConfirmationPanel";

describe("ConfirmationPanel", () => {
  const sampleSettings: TicketConfirmationSettings = {
    admissionInstructions: "Present your QR code at the door.",
    pendingMessage: "Order is processing.",
    qrCodeInstructions: "Show this code at the door.",
    successMessage: "Tickets confirmed!",
    willCallInstructions: "Present your QR code at the door.",
  };

  const sampleTemplates: readonly CommunicationTemplate[] = [
    {
      channel: "Email",
      contentMarkdown:
        "Hi {buyerName},\n\nYour ticket is confirmed: {eventTitle}\n\n{{TICKET_LINK}}",
      createdAt: "2026-01-01T00:00:00Z",
      id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000007",
      isSystem: true,
      subject: "Tickets confirmed: {eventTitle}",
      title: "Ticket Confirmation",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    {
      channel: "Email",
      contentMarkdown:
        "Hi {buyerName},\n\nBundle confirmed: {ticketBundleName}\n\n{{TICKET_EVENT_LIST}}\n\n{{TICKET_LINK}}",
      createdAt: "2026-01-01T00:00:00Z",
      id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000008",
      isSystem: true,
      subject: "Ticket bundle confirmed: {ticketBundleName}",
      title: "Bundle Ticket Confirmation",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    {
      channel: "Email",
      contentMarkdown:
        "Hi {buyerName},\n\nReminder for {eventTitle} at {venueName}.\n\n{{TICKET_LINK}}",
      createdAt: "2026-01-01T00:00:00Z",
      id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000009",
      isSystem: true,
      subject: "Reminder: {eventTitle}",
      title: "Ticket Concert Reminder",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    {
      channel: "Email",
      contentMarkdown:
        "Refund processed for {eventTitle}: {refundAmount} on {refundDate}. {{TICKET_ORDER_LINK}}",
      createdAt: "2026-01-01T00:00:00Z",
      id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000017",
      isSystem: true,
      subject: "Refund processed: {eventTitle}",
      title: "Ticket Refund Confirmation",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    {
      channel: "Email",
      contentMarkdown:
        "Bundle refund for {ticketBundleName}: {{TICKET_EVENT_LIST}} {{TICKET_ORDER_LINK}}",
      createdAt: "2026-01-01T00:00:00Z",
      id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000018",
      isSystem: true,
      subject: "Refund processed: {ticketBundleName}",
      title: "Bundle Ticket Refund Confirmation",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    {
      channel: "Email",
      contentMarkdown: "Unrelated template",
      createdAt: "2026-01-01T00:00:00Z",
      id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000001",
      isSystem: true,
      subject: "Audition Confirmation",
      title: "Audition Confirmation",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    {
      channel: "Email",
      contentMarkdown: "Customer-owned refund wording",
      createdAt: "2026-01-01T00:00:00Z",
      id: "5f0ca4a5-7e4c-4e1a-9a1c-999999999999",
      isSystem: false,
      subject: "Customer-owned refund wording",
      title: "Ticket Refund Confirmation",
      updatedAt: "2026-01-02T00:00:00Z",
    },
  ];

  it("renders admission wording fields and filters to ticket email templates", async () => {
    vi.spyOn(apiModule, "listOrganizationCommunicationTemplates").mockResolvedValue(
      sampleTemplates,
    );
    const setDraft = vi.fn();
    const onSubmit = vi.fn();

    render(
      <ConfirmationPanel
        confirmationDraft={sampleSettings}
        confirmationLoadError={null}
        confirmationLoaded={true}
        confirmationSaving={false}
        onSubmit={onSubmit}
        setConfirmationDraft={setDraft}
      />,
    );

    expect(screen.getByLabelText("Success Message")).toHaveValue("Tickets confirmed!");
    expect(screen.getByLabelText("Pending / Unverified Message")).toHaveValue(
      "Order is processing.",
    );
    expect(screen.getByLabelText("Admission Instructions")).toHaveValue(
      "Present your QR code at the door.",
    );
    expect(screen.getByLabelText("QR Code Instructions")).toHaveValue(
      "Show this code at the door.",
    );

    await waitFor(() => {
      expect(screen.getByText("Ticket Confirmation")).toBeInTheDocument();
      expect(screen.getByText("Bundle Ticket Confirmation")).toBeInTheDocument();
      expect(screen.getByText("Ticket Concert Reminder")).toBeInTheDocument();
      expect(screen.getByText("Ticket Refund Confirmation")).toBeInTheDocument();
      expect(screen.getByText("Bundle Ticket Refund Confirmation")).toBeInTheDocument();
    });
    expect(screen.getAllByText("Ticket Refund Confirmation")).toHaveLength(1);

    // Does not show unrelated system templates
    expect(screen.queryByText("Audition Confirmation")).not.toBeInTheDocument();
  });

  it("opens edit dialog, displays placeholders, and saves updated template", async () => {
    const user = userEvent.setup();
    vi.spyOn(apiModule, "listOrganizationCommunicationTemplates").mockResolvedValue(
      sampleTemplates,
    );
    const targetTemplate = sampleTemplates[0];
    if (!targetTemplate) {
      throw new Error("Missing sample template");
    }
    const updateSpy = vi
      .spyOn(apiModule, "updateOrganizationCommunicationTemplate")
      .mockResolvedValue({
        ...targetTemplate,
        contentMarkdown: "Updated message body {venueName}",
        subject: "Updated subject: {eventTitle}",
      });

    render(
      <ConfirmationPanel
        confirmationDraft={sampleSettings}
        confirmationLoadError={null}
        confirmationLoaded={true}
        confirmationSaving={false}
        onSubmit={vi.fn()}
        setConfirmationDraft={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Ticket Confirmation")).toBeInTheDocument();
    });

    const editButton = screen.getAllByRole("button", { name: "Edit wording" })[0];
    if (!editButton) {
      throw new Error("Missing edit button");
    }
    await user.click(editButton);

    // Dialog opens
    expect(screen.getByRole("heading", { name: "Edit Ticket Confirmation" })).toBeInTheDocument();
    expect(screen.getByLabelText("Subject")).toHaveValue("Tickets confirmed: {eventTitle}");
    expect(screen.getByText("{venueName}")).toBeInTheDocument();
    expect(screen.getByText("{{TICKET_LINK}}")).toBeInTheDocument();

    const subjectInput = screen.getByLabelText("Subject");
    fireEvent.change(subjectInput, { target: { value: "Updated subject: {eventTitle}" } });

    const contentInput = screen.getByLabelText("Message");
    fireEvent.change(contentInput, { target: { value: "Updated message body " } });

    // Click placeholder chip to insert
    const venueChip = screen.getByRole("button", { name: /{venueName}/i });
    await user.click(venueChip);

    expect(contentInput).toHaveValue("Updated message body  {venueName}");

    const saveButton = screen.getByRole("button", { name: "Save template" });
    await user.click(saveButton);

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(
        "5f0ca4a5-7e4c-4e1a-9a1c-000000000007",
        expect.objectContaining({
          contentMarkdown: "Updated message body  {venueName}",
          subject: "Updated subject: {eventTitle}",
        }),
      );
    });
  });

  it("describes included bundle concerts with date, venue, and location details", async () => {
    const user = userEvent.setup();
    vi.spyOn(apiModule, "listOrganizationCommunicationTemplates").mockResolvedValue(
      sampleTemplates,
    );

    render(
      <ConfirmationPanel
        confirmationDraft={sampleSettings}
        confirmationLoadError={null}
        confirmationLoaded={true}
        confirmationSaving={false}
        onSubmit={vi.fn()}
        setConfirmationDraft={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Bundle Ticket Confirmation")).toBeInTheDocument();
    });
    const editButton = screen.getAllByRole("button", { name: "Edit wording" })[1];
    if (!editButton) throw new Error("Missing bundle ticket template edit button");
    await user.click(editButton);

    expect(
      screen.getByText(
        "Included concerts in date order, with each title, date and time, venue, and address or event-location fallback",
      ),
    ).toBeInTheDocument();
  });

  it("resets a ticket system template and immediately updates the Ticketing view", async () => {
    const user = userEvent.setup();
    vi.spyOn(apiModule, "listOrganizationCommunicationTemplates").mockResolvedValue(
      sampleTemplates,
    );
    const targetTemplate = sampleTemplates[0];
    if (!targetTemplate) throw new Error("Missing sample ticket template");
    const canonicalTemplate: CommunicationTemplate = {
      ...targetTemplate,
      channel: "Email",
      contentMarkdown:
        "Hi {buyerName},\n\n- **Venue:** {venueName}\n- **Address:** {venueAddress}\n\n{{TICKET_LINK}}",
      subject: "Tickets confirmed: {eventTitle}",
      title: "Ticket Confirmation",
      updatedAt: "2026-01-03T00:00:00Z",
    };
    const resetSpy = vi
      .spyOn(organizationApi, "resetOrganizationCommunicationTemplateToSystemDefault")
      .mockResolvedValue(canonicalTemplate);

    render(
      <ConfirmationPanel
        confirmationDraft={sampleSettings}
        confirmationLoadError={null}
        confirmationLoaded={true}
        confirmationSaving={false}
        onSubmit={vi.fn()}
        setConfirmationDraft={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Ticket Confirmation")).toBeInTheDocument();
    });
    const editButton = screen.getAllByRole("button", { name: "Edit wording" }).at(0);
    if (!editButton) throw new Error("Missing ticket template edit button");
    await user.click(editButton);
    expect(screen.getByRole("button", { name: "Reset to system default" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset to system default" }));
    const confirmation = screen.getByRole("dialog", { name: "Reset template to system default?" });
    expect(confirmation).toHaveTextContent(
      "This will replace this Organization's customized subject and message with the current system default.",
    );
    await user.click(within(confirmation).getByRole("button", { name: "Cancel" }));
    expect(resetSpy).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Subject")).toHaveValue("Tickets confirmed: {eventTitle}");

    await user.click(screen.getByRole("button", { name: "Reset to system default" }));
    const secondConfirmation = screen.getByRole("dialog", {
      name: "Reset template to system default?",
    });
    await user.click(
      within(secondConfirmation).getByRole("button", { name: "Reset to system default" }),
    );

    await waitFor(() => {
      expect(resetSpy).toHaveBeenCalledWith(targetTemplate.id);
      expect(
        screen.queryByRole("heading", { name: "Edit Ticket Confirmation" }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Ticket Confirmation reset to the system default.",
    );
    expect(screen.getByText("Subject: Tickets confirmed: {eventTitle}")).toBeInTheDocument();
    const ticketCard = screen.getAllByRole("article").at(0);
    if (!ticketCard) throw new Error("Missing ticket confirmation card");
    expect(ticketCard).toHaveTextContent("**Venue:** {venueName}");
  });
});
