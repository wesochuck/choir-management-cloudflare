import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";

// Interaction coverage for the shared Tabs primitive (plan §4.13): arrow-key
// navigation with wrapping, Home/End, disabled-tab skipping, click selection,
// and tab/panel linkage. The SSR markup tests remain untouched.

function TabsHarness({ onValueChange }: { readonly onValueChange: (value: string) => void }) {
  const [value, setValue] = useState("tab-1");
  return (
    <Tabs
      onValueChange={(next) => {
        setValue(next);
        onValueChange(next);
      }}
      value={value}
    >
      <TabsList aria-label="Test sections">
        <TabsTrigger value="tab-1">Tab 1</TabsTrigger>
        <TabsTrigger value="tab-2">Tab 2</TabsTrigger>
        <TabsTrigger value="tab-3" disabled>
          Tab 3
        </TabsTrigger>
      </TabsList>
      <TabsContent value="tab-1">Content 1</TabsContent>
      <TabsContent value="tab-2">Content 2</TabsContent>
      <TabsContent value="tab-3">Content 3</TabsContent>
    </Tabs>
  );
}

describe("Tabs interaction", () => {
  it("moves focus and selection with ArrowRight", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<TabsHarness onValueChange={onValueChange} />);

    screen.getByRole("tab", { name: "Tab 1" }).focus();
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: "Tab 2" })).toHaveFocus();
    expect(onValueChange).toHaveBeenCalledWith("tab-2");
    expect(screen.getByRole("tab", { name: "Tab 2" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Tab 1" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByText("Content 2")).toBeVisible();
  });

  it("wraps ArrowLeft past the first tab while skipping the disabled tab", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<TabsHarness onValueChange={onValueChange} />);

    screen.getByRole("tab", { name: "Tab 1" }).focus();
    await user.keyboard("{ArrowLeft}");

    expect(screen.getByRole("tab", { name: "Tab 2" })).toHaveFocus();
    expect(onValueChange).toHaveBeenCalledWith("tab-2");
    expect(screen.queryByText("Content 3")).not.toBeInTheDocument();
  });

  it("supports Home and End keys", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<TabsHarness onValueChange={onValueChange} />);

    screen.getByRole("tab", { name: "Tab 1" }).focus();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Tab 2" })).toHaveFocus();
    expect(onValueChange).toHaveBeenCalledWith("tab-2");

    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Tab 1" })).toHaveFocus();
    expect(onValueChange).toHaveBeenCalledWith("tab-1");
  });

  it("selects tabs on click but ignores the disabled tab", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<TabsHarness onValueChange={onValueChange} />);

    await user.click(screen.getByRole("tab", { name: "Tab 2" }));
    expect(onValueChange).toHaveBeenCalledWith("tab-2");
    expect(screen.getByText("Content 2")).toBeVisible();

    onValueChange.mockClear();
    await user.click(screen.getByRole("tab", { name: "Tab 3" }));
    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "Tab 2" })).toHaveAttribute("aria-selected", "true");
  });

  it("links triggers and panels with accessible attributes", () => {
    const onValueChange = vi.fn();
    render(<TabsHarness onValueChange={onValueChange} />);

    const tab = screen.getByRole("tab", { name: "Tab 1" });
    const panel = screen.getByRole("tabpanel");
    const controls = tab.getAttribute("aria-controls");
    expect(controls).not.toBeNull();
    expect(panel.getAttribute("id")).toBe(controls);
    expect(panel.getAttribute("aria-labelledby")).toBe(tab.getAttribute("id"));
  });
});
