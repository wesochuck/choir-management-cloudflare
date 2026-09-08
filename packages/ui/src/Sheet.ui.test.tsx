import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Sheet } from "./Sheet";

// Interaction coverage for the Sheet drawer (plan §4.13 — mobile
// navigation): opening moves focus inside, Escape and the close button
// dismiss, and focus is restored to the opener via restoreFocusRef.

function SheetHarness({ onClose }: { readonly onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
        }}
        ref={triggerRef}
        type="button"
      >
        Open workspace navigation
      </button>
      <Sheet
        onClose={() => {
          setOpen(false);
          onClose();
        }}
        open={open}
        restoreFocusRef={triggerRef}
        title="Workspace navigation"
      >
        <nav aria-label="Workspace">
          <a href="/dashboard">Dashboard</a>
          <a href="/admin/roster">Roster</a>
        </nav>
      </Sheet>
    </>
  );
}

describe("Sheet interaction", () => {
  it("moves focus inside the sheet when opened", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SheetHarness onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Open workspace navigation" }));
    const sheet = await screen.findByRole("dialog", { name: "Workspace navigation" });
    expect(sheet).toBeVisible();
    await waitFor(() => {
      expect(sheet.contains(document.activeElement)).toBe(true);
    });
  });

  it("closes on Escape and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SheetHarness onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Open workspace navigation" }));
    await screen.findByRole("dialog", { name: "Workspace navigation" });

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole("dialog", { name: "Workspace navigation" })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open workspace navigation" })).toHaveFocus();
    });
  });

  it("closes from the close button and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SheetHarness onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Open workspace navigation" }));
    const sheet = await screen.findByRole("dialog", { name: "Workspace navigation" });
    expect(sheet).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Close navigation" }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open workspace navigation" })).toHaveFocus();
    });
  });

  it("keeps navigation links reachable by keyboard inside the sheet", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SheetHarness onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Open workspace navigation" }));
    const sheet = await screen.findByRole("dialog", { name: "Workspace navigation" });

    screen.getByRole("button", { name: "Close navigation" }).focus();
    await user.tab();
    const focused = document.activeElement;
    expect(focused).not.toBeNull();
    expect(sheet.contains(focused)).toBe(true);
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Roster" })).toBeVisible();
  });
});
