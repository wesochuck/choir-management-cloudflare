import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "./ConfirmDialog";

// Interaction coverage for the destructive-action confirmation dialog
// (plan §4.13): explicit Cancel, destructive confirm, and Escape dismissal.

function renderConfirm({
  onCancel,
  onConfirm,
}: {
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  render(
    <ConfirmDialog
      confirmLabel="Delete entry"
      description="This entry will be permanently removed."
      destructive
      onCancel={onCancel}
      onConfirm={onConfirm}
      open
      title="Delete entry?"
    />,
  );
}

describe("ConfirmDialog interaction", () => {
  it("confirms the destructive action and labels it accessibly", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    renderConfirm({ onCancel, onConfirm });

    const dialog = screen.getByRole("dialog", { name: "Delete entry?" });
    expect(dialog).toBeVisible();
    const confirmButton = screen.getByRole("button", { name: "Delete entry" });
    expect(confirmButton.className).toMatch(/button--danger/);

    await user.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels from the visible Cancel action", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    renderConfirm({ onCancel, onConfirm });

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("treats Escape as cancellation", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    renderConfirm({ onCancel, onConfirm });

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
