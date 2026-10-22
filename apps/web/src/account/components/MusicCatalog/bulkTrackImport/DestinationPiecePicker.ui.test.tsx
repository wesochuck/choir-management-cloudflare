import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DestinationPiecePicker, type DestinationPieceOption } from "./DestinationPiecePicker";

const options: readonly DestinationPieceOption[] = [
  {
    arranger: "",
    composer: "Irving Berlin",
    id: "one",
    occupiedParts: ["soprano"],
    searchText: "blue skies irving berlin",
    title: "Blue Skies",
    trackCount: 1,
  },
  {
    arranger: "Jane Smith",
    composer: "Gounod",
    id: "two",
    occupiedParts: [],
    searchText: "ave maria gounod jane smith",
    title: "Ave Maria",
    trackCount: 0,
  },
  {
    arranger: "",
    composer: "Elgar",
    id: "three",
    occupiedParts: [],
    searchText: "ave verum elgar",
    title: "Ave Verum",
    trackCount: 0,
  },
];
const performancePieceIds = new Set(["two"]);

function Harness({
  onSelect = vi.fn(),
  disabled = false,
}: {
  readonly onSelect?: (id: string | null) => void;
  readonly disabled?: boolean;
}) {
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>("one");
  return (
    <DestinationPiecePicker
      disabled={disabled}
      id="destination"
      onSelect={(id) => {
        onSelect(id);
        setSelectedPieceId(id);
      }}
      options={options}
      performancePieceIds={performancePieceIds}
      selectedPieceId={selectedPieceId}
    />
  );
}

describe("Music Library destination search", () => {
  it("shows a prominent explicit search action and opens the separate library search", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByRole("heading", { name: "Blue Skies" })).toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "Search library to change piece" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("searchbox", { name: "Search titles, composers, or arrangers" }),
    ).toHaveFocus();
    expect(screen.getByRole("region", { name: "Performance Set List" })).toHaveTextContent(
      "Ave Maria",
    );
    expect(screen.getByRole("region", { name: "Entire Music Library" })).toHaveTextContent(
      "Blue Skies",
    );
  });

  it.each(["AVE MARIA", "gounod", "Jane Smith", "maria smith"])(
    "searches titles, composers and arrangers with %s without changing the selection",
    async (query) => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(<Harness onSelect={onSelect} />);
      await user.click(screen.getByRole("button", { name: "Search library to change piece" }));
      const search = screen.getByRole("searchbox", {
        name: "Search titles, composers, or arrangers",
      });
      await user.type(search, query);
      expect(screen.getByRole("region", { name: "Music Library search" })).toHaveTextContent(
        "Ave Maria",
      );
      expect(screen.queryByRole("button", { name: /Ave Verum/ })).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Blue Skies" })).toBeInTheDocument();
      expect(onSelect).not.toHaveBeenCalled();
      const results = within(screen.getByRole("region", { name: "Music Library search" }));
      await user.click(results.getByRole("button", { name: /Ave Maria/ }));
      expect(onSelect).toHaveBeenCalledWith("two");
      expect(screen.getByRole("heading", { name: "Ave Maria" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Search library to change piece" })).toHaveFocus();
    },
  );

  it("keeps the current selection on empty results and lets staff cancel with keyboard", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Search library to change piece" });
    await user.click(trigger);
    const search = screen.getByRole("searchbox", {
      name: "Search titles, composers, or arrangers",
    });
    await user.type(search, "no such piece");
    expect(
      screen.getByText("No matching pieces. Try a different title, composer, or arranger."),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Blue Skies" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("disables the search action during Clef Flash matching", () => {
    render(<Harness disabled />);
    expect(screen.getByRole("button", { name: "Search library to change piece" })).toBeDisabled();
  });
});

it("explains no reliable AI match while preserving the prominent library search", () => {
  render(
    <DestinationPiecePicker
      disabled={false}
      id="no-match"
      onSelect={vi.fn()}
      options={options}
      performancePieceIds={performancePieceIds}
      selectedPieceId={null}
      aiMatchOutcome="no_match"
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("AI couldn’t find a reliable match");
  expect(screen.getByRole("status")).toHaveTextContent(
    "Search the Music Library to choose a destination",
  );
  expect(screen.getByRole("button", { name: "Search library to change piece" })).toBeEnabled();
  expect(screen.queryByRole("list", { name: "Possible AI destinations" })).not.toBeInTheDocument();
});

it("separates arrangement credits and an explicit keyboard-accessible selection action", async () => {
  const onSelect = vi.fn();
  const user = userEvent.setup();
  render(
    <DestinationPiecePicker
      disabled={false}
      id="alternatives"
      onSelect={onSelect}
      options={options}
      performancePieceIds={performancePieceIds}
      selectedPieceId={null}
      aiMatchOutcome="alternatives"
      suggestedAlternatives={[
        {
          pieceId: "two",
          title: "Ave Maria",
          composer: "Gounod",
          arranger: "Jane Smith",
          probability: 0.48,
        },
      ]}
    />,
  );
  const result = screen.getByRole("status");
  expect(result).toHaveTextContent("Possible destinations");
  expect(result).toHaveTextContent("Gounod · arr. Jane Smith");
  expect(result).not.toHaveTextContent("48%");
  const select = screen.getByRole("button", {
    name: "Select destination: Ave Maria, arranged by Jane Smith",
  });
  select.focus();
  await user.keyboard("{Enter}");
  expect(onSelect).toHaveBeenCalledWith("two");
});
