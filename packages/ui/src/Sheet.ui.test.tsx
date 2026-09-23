import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Sheet } from "./Sheet";

// Interaction coverage for the Sheet drawer (plan §4.13 — mobile
// navigation): opening moves focus inside, Escape and the close button
// dismiss, and focus is restored to the opener via restoreFocusRef.

function SheetHarness({
  onClose,
  presentation = "side",
  title = "Workspace navigation",
}: {
  readonly onClose: () => void;
  readonly presentation?: "side" | "mobile-fullscreen";
  readonly title?: string;
}) {
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
        {title === "Workspace navigation" ? "Open workspace navigation" : `Open ${title}`}
      </button>
      <Sheet
        onClose={() => {
          setOpen(false);
          onClose();
        }}
        open={open}
        presentation={presentation}
        restoreFocusRef={triggerRef}
        title={title}
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
    expect(sheet).toHaveClass("sheet");
    expect(sheet).not.toHaveClass("sheet--mobile-fullscreen");
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

    await user.click(screen.getByRole("button", { name: "Close Workspace navigation" }));
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

    screen.getByRole("button", { name: "Close Workspace navigation" }).focus();
    await user.tab();
    const focused = document.activeElement;
    expect(focused).not.toBeNull();
    expect(sheet.contains(focused)).toBe(true);
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Roster" })).toBeVisible();
  });

  it("opts into the mobile fullscreen class and uses a contextual close label", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SheetHarness onClose={onClose} presentation="mobile-fullscreen" title="Set List" />);

    await user.click(screen.getByRole("button", { name: "Open Set List" }));
    const sheet = await screen.findByRole("dialog", { name: "Set List" });
    expect(sheet).toHaveClass("sheet", "sheet--mobile-fullscreen");

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open Set List" })).toHaveFocus();
    });

    await user.click(screen.getByRole("button", { name: "Open Set List" }));
    await screen.findByRole("dialog", { name: "Set List" });
    await user.click(screen.getByRole("button", { name: "Close Set List" }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open Set List" })).toHaveFocus();
    });
  });
});
