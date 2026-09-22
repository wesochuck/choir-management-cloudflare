import type { CommunicationTemplate, TicketConfirmationSettings } from "@choir/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import * as apiModule from "../../../auth/api";
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
      contentMarkdown: "Unrelated template",
      createdAt: "2026-01-01T00:00:00Z",
      id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000001",
      isSystem: true,
      subject: "Audition Confirmation",
      title: "Audition Confirmation",
      updatedAt: "2026-01-01T00:00:00Z",
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
    });

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
});
