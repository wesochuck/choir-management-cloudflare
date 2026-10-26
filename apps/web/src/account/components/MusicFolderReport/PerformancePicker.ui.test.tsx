import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { expect, it, vi } from "vitest";

import { PerformancePicker } from "./view";

it("dismisses outside clicks while preserving inside interactions and selections", () => {
  const onClear = vi.fn();
  render(
    <>
      <button type="button">Outside</button>
      <PerformancePicker
        onClear={onClear}
        onSelectAll={vi.fn()}
        onToggle={vi.fn()}
        options={[]}
        selectedEventIds={["selected-performance"]}
      />
    </>,
  );
  const summary = screen.getByText("1 Performance selected").closest("summary");
  if (!summary) throw new Error("Performance picker summary is missing");
  const picker = summary.closest("details");
  expect(picker).toBeInTheDocument();
  fireEvent.click(summary);
  expect(picker).toHaveAttribute("open");
  fireEvent.click(screen.getByLabelText("Search Performances"));
  fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
  expect(onClear).toHaveBeenCalledOnce();
  expect(picker).toHaveAttribute("open");
  fireEvent.click(screen.getByRole("button", { name: "Outside" }));
  expect(picker).not.toHaveAttribute("open");
  fireEvent.click(summary);
  expect(screen.getByText("1 Performance selected")).toBeInTheDocument();
  fireEvent.keyDown(screen.getByLabelText("Search Performances"), { key: "Escape" });
  expect(picker).not.toHaveAttribute("open");
  expect(summary).toHaveFocus();
});
