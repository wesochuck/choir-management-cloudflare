import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { getTicketNotificationDetails } from "../../../api/communications";
import { TicketNotificationDetails } from "./TicketNotificationDetails";

vi.mock("../../../api/communications", () => ({ getTicketNotificationDetails: vi.fn() }));
const details = {
  id: crypto.randomUUID(),
  purchaseId: crypto.randomUUID(),
  buyerName: "Test Buyer",
  recipientEmail: "buyer@example.test",
  purchaseStatus: "refunded",
  refundedAt: "2026-09-22T05:20:00.000Z",
  status: "processing" as const,
  kind: "confirmation" as const,
  scheduledAt: "2026-09-22T05:18:00.000Z",
  updatedAt: "2026-09-22T05:45:00.000Z",
  failureDetail: "",
  providerStatus: null,
  providerMessageId: null,
  jobStatus: "failed" as const,
  jobAttempts: 6,
  canCancel: true,
};
beforeEach(() => {
  vi.mocked(getTicketNotificationDetails).mockReset();
});
describe("ticket notification details", () => {
  it("loads the exact order, requires a reason and confirms cancellation", async () => {
    vi.mocked(getTicketNotificationDetails).mockResolvedValue(details);
    const onCancel = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<TicketNotificationDetails notificationId={details.id} onCancel={onCancel} />);
    await user.click(screen.getByRole("button", { name: "View details" }));
    expect(await screen.findByText("Test Buyer")).toBeInTheDocument();
    expect(screen.getByText(details.purchaseId)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel notification" })).toBeDisabled();
    await user.type(screen.getByLabelText("Cancellation reason"), "Refunded test order");
    await user.click(screen.getByRole("button", { name: "Cancel notification" }));
    const confirmation = await screen.findByRole("dialog", { name: "Cancel ticket notification" });
    await user.click(within(confirmation).getByRole("button", { name: "Cancel notification" }));
    expect(onCancel).toHaveBeenCalledWith(`ticket:${details.id}`, "Refunded test order");
  });
  it("hides cancellation for active/completed messages and labels suppression as skipped", async () => {
    vi.mocked(getTicketNotificationDetails).mockResolvedValue({
      ...details,
      status: "suppressed",
      canCancel: false,
    });
    render(<TicketNotificationDetails notificationId={details.id} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "View details" }));
    expect(await screen.findByText("Skipped")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel notification" })).not.toBeInTheDocument();
  });
  it("shows read errors and allows retry", async () => {
    vi.mocked(getTicketNotificationDetails).mockRejectedValue(new Error("Unavailable"));
    render(<TicketNotificationDetails notificationId={details.id} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "View details" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });
  it("formats refund times in the Organization time zone", async () => {
    vi.mocked(getTicketNotificationDetails).mockResolvedValue(details);
    render(
      <TicketNotificationDetails
        notificationId={details.id}
        onCancel={vi.fn()}
        timezone="America/Los_Angeles"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "View details" }));
    expect(await screen.findByText(/Sep 21, 2026, 10:20 PM PDT/)).toBeInTheDocument();
  });
});
