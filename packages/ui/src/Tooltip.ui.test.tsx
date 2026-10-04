import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { PortalContainerHost, PortalContainerProvider } from "./PortalContainer";
import { Tooltip } from "./Tooltip";

describe("Tooltip", () => {
  it("renders children directly when content is undefined", () => {
    render(
      <Tooltip content={undefined}>
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    expect(screen.getByRole("button", { name: "Trigger" })).toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows tooltip on focus and closes on Escape", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Help text">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const button = screen.getByRole("button", { name: "Trigger" });
    await user.tab();
    expect(button).toHaveFocus();
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Help text");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("does not show tooltip when disabled and resets open state when disabled transitions", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <Tooltip content="Help text" disabled={false}>
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    await user.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Help text");

    // Disabled becomes true (e.g. dragging starts)
    rerender(
      <Tooltip content="Help text" disabled={true}>
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    // Disabled returns to false (drag ended)
    rerender(
      <Tooltip content="Help text" disabled={false}>
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    // Should NOT automatically pop open again
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("renders inside PortalContainer when scoped", async () => {
    const user = userEvent.setup();
    render(
      <PortalContainerProvider>
        <div id="host-wrapper">
          <PortalContainerHost id="tooltip-host" />
        </div>
        <Tooltip content="Scoped content">
          <button type="button">Trigger</button>
        </Tooltip>
      </PortalContainerProvider>,
    );
    await user.tab();
    const tooltip = await screen.findByRole("tooltip");
    const host = document.getElementById("tooltip-host");
    expect(host).not.toBeNull();
    expect(host?.contains(tooltip)).toBe(true);
  });
});
