import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Autocomplete, type AutocompleteOption } from "./Autocomplete";

// Interaction coverage for the shared Autocomplete combobox (plan §4.13 —
// dropdown-style keyboard opening/navigation/dismissal): typing opens the
// listbox, arrows/Home/End move the active option, Enter selects, and Escape
// closes while restoring the last selected value.

const OPTIONS: readonly AutocompleteOption[] = [
  { id: "soprano", label: "Soprano" },
  { id: "alto", label: "Alto" },
  { id: "tenor", label: "Tenor" },
];

function AutocompleteHarness({
  disabled = false,
  onSelect,
}: {
  readonly disabled?: boolean;
  readonly onSelect: (option: AutocompleteOption) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <Autocomplete
      ariaLabel="Voice part"
      disabled={disabled}
      onSelect={(option) => {
        // Mirror real consumers (e.g. ManualDonationModal): selecting an option
        // commits its label to the controlled input value.
        setValue(option.label);
        onSelect(option);
      }}
      onValueChange={setValue}
      options={OPTIONS}
      value={value}
    />
  );
}

describe("Autocomplete interaction", () => {
  it("opens on typing and selects the active option with Enter", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<AutocompleteHarness onSelect={onSelect} />);

    const input = screen.getByRole("combobox", { name: "Voice part" });
    await user.click(input);
    await user.keyboard("sop");

    const listbox = await screen.findByRole("listbox");
    expect(listbox).toBeVisible();
    expect(input).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Enter}");

    expect(onSelect).toHaveBeenCalledWith({ id: "soprano", label: "Soprano" });
    await waitFor(() => {
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
  });

  it("navigates options with arrow keys before selecting", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<AutocompleteHarness onSelect={onSelect} />);

    const input = screen.getByRole("combobox", { name: "Voice part" });
    await user.click(input);
    await user.keyboard("o");
    await screen.findByRole("listbox");

    await user.keyboard("{ArrowDown}");
    expect(input.getAttribute("aria-activedescendant")).toContain("-option-1");
    await user.keyboard("{ArrowDown}");
    expect(input.getAttribute("aria-activedescendant")).toContain("-option-2");
    await user.keyboard("{ArrowUp}");
    expect(input.getAttribute("aria-activedescendant")).toContain("-option-1");
    await user.keyboard("{Enter}");

    expect(onSelect).toHaveBeenCalledWith({ id: "alto", label: "Alto" });
  });

  it("supports Home and End keys in the open listbox", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<AutocompleteHarness onSelect={onSelect} />);

    const input = screen.getByRole("combobox", { name: "Voice part" });
    await user.click(input);
    await user.keyboard("o");
    await screen.findByRole("listbox");

    await user.keyboard("{End}");
    expect(input.getAttribute("aria-activedescendant")).toContain("-option-2");
    await user.keyboard("{Home}");
    expect(input.getAttribute("aria-activedescendant")).toContain("-option-0");
  });

  it("restores the last selected label when Escape is pressed after editing", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<AutocompleteHarness onSelect={onSelect} />);

    const input = screen.getByRole("combobox", { name: "Voice part" });
    await user.click(input);
    await user.keyboard("sop");
    await screen.findByRole("listbox");
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);

    await user.click(input);
    await user.keyboard("xyz");
    expect(input).toHaveValue("Sopranoxyz");
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(input).toHaveValue("Soprano");
    });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("selects an option on pointer click", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<AutocompleteHarness onSelect={onSelect} />);

    await user.click(screen.getByRole("combobox", { name: "Voice part" }));
    await user.keyboard("e");
    await user.click(await screen.findByRole("option", { name: "Tenor" }));

    expect(onSelect).toHaveBeenCalledWith({ id: "tenor", label: "Tenor" });
  });

  it("keeps a disabled combobox closed", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<AutocompleteHarness disabled onSelect={onSelect} />);

    const input = screen.getByRole("combobox", { name: "Voice part" });
    expect(input).toBeDisabled();
    await user.click(input);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
