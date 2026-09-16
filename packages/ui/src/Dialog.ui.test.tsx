import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Dialog, DialogClose } from "./Dialog";

// Interaction coverage for the shared Dialog primitive (plan §4.13). The SSR
// markup tests remain untouched; these specs prove focus and keyboard behavior
// that string assertions cannot: initial focus, focus trap, Escape dismissal,
// dirty-guard confirmation, and focus restoration.

function DialogHarness({
  dirty = false,
  onClose,
}: {
  readonly dirty?: boolean;
  readonly onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
        }}
        type="button"
      >
        Open dialog
      </button>
      <Dialog
        description="Dialog description"
        dirty={dirty}
        onClose={() => {
          setOpen(false);
          onClose();
        }}
        open={open}
        title="Test dialog"
      >
        <label>
          Dialog input
          <input type="text" />
        </label>
        <DialogClose asChild>
          <button type="button">Cancel</button>
        </DialogClose>
      </Dialog>
    </>
  );
}

async function openDialog(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Open dialog" }));
  await screen.findByRole("dialog", { name: "Test dialog" });
}

describe("Dialog interaction", () => {
  it("moves initial focus inside the dialog when opened", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DialogHarness onClose={onClose} />);

    await openDialog(user);

    const dialog = screen.getByRole("dialog", { name: "Test dialog" });
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
  });

  it("traps Tab focus inside the dialog", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DialogHarness onClose={onClose} />);

    await openDialog(user);

    const dialog = screen.getByRole("dialog", { name: "Test dialog" });
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
    // More Tab presses than focusable elements (close, input, Cancel).
    for (let index = 0; index < 6; index += 1) {
      await user.tab();
    }
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("closes on Escape and releases focus from the dialog", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DialogHarness onClose={onClose} />);

    await openDialog(user);
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole("dialog", { name: "Test dialog" })).not.toBeInTheDocument();
    // This controlled Dialog has no Radix Trigger, so Radix releases focus to
    // the document on close. Explicit opener restoration is owned by Sheet via
    // restoreFocusRef and is proven in Sheet.ui.test.tsx.
    await waitFor(() => {
      expect(document.activeElement).toBe(document.body);
    });
  });

  it("requires discard confirmation before closing a dirty dialog with Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DialogHarness dirty onClose={onClose} />);

    await openDialog(user);
    await user.keyboard("{Escape}");

    const confirmation = await screen.findByRole("dialog", {
      name: "Discard unsaved changes?",
    });
    // The confirmation is a second modal layer, so Radix hides the underlying
    // dialog from the accessibility tree until the confirmation resolves.
    expect(confirmation).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(within(confirmation).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Discard unsaved changes?" }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByRole("dialog", { name: "Test dialog" })).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    const reopened = await screen.findByRole("dialog", {
      name: "Discard unsaved changes?",
    });
    await user.click(within(reopened).getByRole("button", { name: "Discard changes" }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole("dialog", { name: "Test dialog" })).not.toBeInTheDocument();
  });

  it("renders custom footer slot when footer prop is provided", () => {
    const onClose = vi.fn();
    render(
      <Dialog
        footer={
          <button onClick={onClose} type="button">
            Footer action
          </button>
        }
        onClose={onClose}
        open
        title="Footer test"
      >
        <p>Body content</p>
      </Dialog>,
    );

    expect(screen.getByRole("button", { name: "Footer action" })).toBeInTheDocument();
  });
});
