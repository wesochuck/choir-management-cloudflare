import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

import { DropdownMenu } from "./DropdownMenu";

// Interaction coverage for the shared DropdownMenu primitive (plan §4.13):
// pointer opening, Escape dismissal with trigger focus restoration, item
// activation, disabled-item behavior, and link items.

function renderMenu({
  onDelete,
  onEdit,
}: {
  readonly onDelete: () => void;
  readonly onEdit: () => void;
}) {
  render(
    <DropdownMenu
      accessibleLabel="Row actions"
      items={[
        { label: "Edit", onSelect: onEdit },
        { label: "Delete", disabled: true, onSelect: onDelete },
        { label: "Help docs", href: "/docs" },
      ]}
      trigger={<button type="button">Actions</button>}
    />,
  );
}

describe("DropdownMenu interaction", () => {
  it("opens on trigger click and activates an item on click", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    renderMenu({ onDelete, onEdit });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Row actions" }));

    const menu = await screen.findByRole("menu");
    expect(menu).toBeVisible();
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });

  it("does not activate disabled items", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    renderMenu({ onDelete, onEdit });

    await user.click(screen.getByRole("button", { name: "Row actions" }));
    const disabledItem = await screen.findByRole("menuitem", { name: "Delete" });
    expect(disabledItem).toHaveAttribute("aria-disabled", "true");
    await user.click(disabledItem);
    expect(onDelete).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("renders link items as anchors with the expected href", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    renderMenu({ onDelete, onEdit });

    await user.click(screen.getByRole("button", { name: "Row actions" }));
    const docsItem = await screen.findByRole("menuitem", { name: "Help docs" });
    expect(docsItem.tagName).toBe("A");
    expect(docsItem).toHaveAttribute("href", "/docs");
  });

  it("dismisses on Escape and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    renderMenu({ onDelete, onEdit });

    await user.click(screen.getByRole("button", { name: "Row actions" }));
    await screen.findByRole("menu");

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Row actions" })).toHaveFocus();
  });
});
