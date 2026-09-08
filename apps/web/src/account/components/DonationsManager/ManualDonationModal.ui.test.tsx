import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

import { ManualDonationModal } from "./ManualDonationModal";

// Interaction coverage for the manual-donation form (plan §4.13 — DatePicker
// and modal form behavior). The application deliberately uses native date
// inputs rather than a custom picker, so these specs pin the native control's
// labeling, keyboard reachability, value handling, and submission mapping
// instead of inventing picker behavior that does not exist.

function renderModal({
  onClose,
  onSave,
}: {
  readonly onClose: () => void;
  readonly onSave: (donation: {
    readonly amountCents: number;
    readonly buyerName: string;
    readonly receivedAt: string | undefined;
  }) => Promise<void>;
}) {
  render(
    <ManualDonationModal
      busy={false}
      onClose={onClose}
      onSave={(donation) =>
        onSave({
          amountCents: donation.amountCents,
          buyerName: donation.buyerName,
          receivedAt: donation.receivedAt,
        })
      }
      open
      suggestions={[]}
    />,
  );
}

describe("ManualDonationModal interaction", () => {
  it("labels the native date input and reaches it by keyboard", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSave = vi.fn((): Promise<void> => Promise.resolve());
    renderModal({ onClose, onSave });

    const dateInput = screen.getByLabelText("Date received");
    expect(dateInput).toHaveAttribute("type", "date");

    screen.getByLabelText("Amount (USD)").focus();
    await user.tab();
    expect(dateInput).toHaveFocus();
  });

  it("submits the chosen date as the received timestamp", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSave = vi.fn((): Promise<void> => Promise.resolve());
    renderModal({ onClose, onSave });

    await user.type(screen.getByLabelText("Amount (USD)"), "75");
    const dateInput = screen.getByLabelText("Date received");
    fireEvent.change(dateInput, { target: { value: "2026-08-15" } });
    expect(dateInput).toHaveValue("2026-08-15");

    await user.click(screen.getByRole("combobox", { name: "Donor name" }));
    await user.keyboard("Nora Noble");

    await user.click(screen.getByRole("button", { name: "Record donation" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCents: 7500,
        buyerName: "Nora Noble",
        receivedAt: "2026-08-15T12:00:00.000Z",
      }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("blocks submission with an accessible error when the amount is invalid", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSave = vi.fn((): Promise<void> => Promise.resolve());
    renderModal({ onClose, onSave });

    // "0" satisfies required-ness but violates the native min="0.01"
    // constraint, which blocks the click-to-submit path in real browsers. The
    // submit event is dispatched directly to exercise the form's own
    // validator, which must still reject non-positive amounts accessibly.
    await user.type(screen.getByLabelText("Amount (USD)"), "0");
    await user.click(screen.getByRole("combobox", { name: "Donor name" }));
    await user.keyboard("Nora Noble");
    const form = document.querySelector("form.form-stack");
    expect(form).not.toBeNull();
    if (!form) return;
    fireEvent.submit(form);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Provide a valid positive donation amount.",
    );
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
