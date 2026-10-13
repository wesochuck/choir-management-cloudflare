import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

import { CommandPaletteModal } from "./CommandPaletteModal";

describe("CommandPaletteModal workspace scoping", () => {
  const defaultProps = {
    isOwner: false,
    modules: ["events", "roster", "directory", "dues", "practice_player", "resources", "ticketing"],
    onClose: vi.fn(),
    onNavigate: vi.fn(),
    onToggleTheme: vi.fn(),
    open: true,
  };

  it("renders neutral 'Command Palette' title in member workspace", () => {
    render(<CommandPaletteModal {...defaultProps} selectedWorkspace="member" />);

    expect(screen.getByRole("dialog", { name: "Command Palette" })).toBeInTheDocument();
    expect(screen.getByText("Command Palette")).toBeInTheDocument();
    expect(screen.queryByText("Admin Command Palette")).toBeNull();
  });

  it("does not offer admin-only ticket pages when searching in member workspace", () => {
    render(<CommandPaletteModal {...defaultProps} selectedWorkspace="member" />);

    const searchInput = screen.getByRole("combobox");
    fireEvent.change(searchInput, { target: { value: "ticket" } });

    expect(screen.queryByText("Ticket Sales & Orders")).toBeNull();
    expect(screen.getByText(/no results found for/i)).toBeInTheDocument();
  });

  it("offers member pages in member workspace and navigates on select", () => {
    const onNavigate = vi.fn();
    render(
      <CommandPaletteModal {...defaultProps} onNavigate={onNavigate} selectedWorkspace="member" />,
    );

    const searchInput = screen.getByRole("combobox");
    fireEvent.change(searchInput, { target: { value: "schedule" } });

    const scheduleItem = screen.getByText("My Schedule");
    expect(scheduleItem).toBeInTheDocument();

    fireEvent.click(scheduleItem);
    expect(onNavigate).toHaveBeenCalledWith("/schedule");
  });

  it("hides 'Show hidden profiles' in member workspace and shows it in organization workspace", () => {
    const { rerender } = render(
      <CommandPaletteModal {...defaultProps} selectedWorkspace="member" />,
    );
    expect(screen.queryByText("Show hidden profiles")).toBeNull();

    rerender(<CommandPaletteModal {...defaultProps} selectedWorkspace="organization" />);
    expect(screen.getByText("Show hidden profiles")).toBeInTheDocument();
  });

  it("finds Ticket Sales & Orders in organization workspace", () => {
    render(<CommandPaletteModal {...defaultProps} selectedWorkspace="organization" />);

    const searchInput = screen.getByRole("combobox");
    fireEvent.change(searchInput, { target: { value: "ticket" } });

    expect(screen.getByText("Ticket Sales & Orders")).toBeInTheDocument();
  });
});
