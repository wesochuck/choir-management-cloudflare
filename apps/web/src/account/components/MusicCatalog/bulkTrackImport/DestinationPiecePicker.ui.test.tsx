import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DestinationPiecePicker, type DestinationPieceOption } from "./DestinationPiecePicker";

const options: readonly DestinationPieceOption[] = [
  {
    id: "one",
    label: "Blue Skies (Irving Berlin)",
    searchText: "blue skies irving berlin",
    trackCount: 1,
  },
  {
    id: "two",
    label: "Ave Maria (Gounod) · arr. Jane Smith",
    searchText: "ave maria gounod jane smith",
    trackCount: 0,
  },
  { id: "three", label: "Ave Verum (Elgar)", searchText: "ave verum elgar", trackCount: 0 },
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

describe("searchable practice track destinations", () => {
  it("keeps the full list available with set-list pieces first and no duplicate options", () => {
    render(<Harness />);
    expect(screen.getAllByRole("option")).toHaveLength(4);
    expect(screen.getByRole("group", { name: "Performance Set List" })).toHaveTextContent(
      "Ave Maria",
    );
    expect(screen.getByRole("combobox", { name: "Destination music piece" })).toHaveValue("one");
  });

  it.each(["AVE MARIA", "gounod", "Jane Smith", "maria smith"])(
    "finds a destination by %s without changing the current selection",
    async (query) => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(<Harness onSelect={onSelect} />);
      await user.type(screen.getByRole("searchbox", { name: "Search library" }), query);
      expect(screen.getByRole("status")).toHaveTextContent("1 matching piece");
      expect(screen.queryByRole("option", { name: "Ave Verum (Elgar)" })).not.toBeInTheDocument();
      const select = screen.getByRole("combobox", { name: "Destination music piece" });
      expect(select).toHaveValue("one");
      expect(onSelect).not.toHaveBeenCalled();
      await user.selectOptions(select, "two");
      expect(onSelect).toHaveBeenCalledWith("two");
      expect(select).toHaveValue("two");
    },
  );

  it("explains empty results, retains the selected piece, and restores browsing when cleared", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const search = screen.getByRole("searchbox");
    await user.type(search, "no such piece");
    expect(screen.getByRole("status")).toHaveTextContent("No matching pieces");
    expect(screen.getByRole("group", { name: "Current selection" })).toHaveTextContent(
      "Blue Skies",
    );
    expect(screen.getByRole("combobox")).toHaveValue("one");
    await user.clear(search);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(4);
  });

  it("keeps search independent for each recording group", async () => {
    const user = userEvent.setup();
    render(
      <>
        <div data-testid="first">
          <Harness />
        </div>
        <div data-testid="second">
          <DestinationPiecePicker
            disabled={false}
            id="second-destination"
            onSelect={vi.fn()}
            options={options}
            performancePieceIds={performancePieceIds}
            selectedPieceId={null}
          />
        </div>
      </>,
    );
    await user.type(within(screen.getByTestId("first")).getByRole("searchbox"), "elgar");
    expect(within(screen.getByTestId("second")).getAllByRole("option")).toHaveLength(4);
    expect(
      within(screen.getByTestId("first")).queryByRole("option", { name: /Ave Maria/ }),
    ).not.toBeInTheDocument();
  });

  it("disables search and selection during AI matching", () => {
    render(<Harness disabled />);
    expect(screen.getByRole("searchbox")).toBeDisabled();
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});
