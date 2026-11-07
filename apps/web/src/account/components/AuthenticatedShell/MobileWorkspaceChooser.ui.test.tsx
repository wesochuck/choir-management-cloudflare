import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MobileWorkspaceChooser, MobileWorkspaceMore } from "./MobileWorkspaceChooser";
import { MobileMemberNavigation } from "./MobileMemberNavigation";

describe("mobile workspace chooser", () => {
  it("shows only supplied workspaces with full names and the active selection", () => {
    const change = vi.fn();
    render(
      <MobileWorkspaceChooser
        options={["member", "organization", "account"]}
        selected="organization"
        onSwitch={change}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toHaveAccessibleName(/Organization Admin/);
    expect(buttons[0]).toHaveAttribute("aria-current", "true");
    expect(screen.queryByRole("button", { name: /Platform Admin/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Organization Admin/ }));
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Member workspace/ }));
    expect(change).toHaveBeenCalledWith("member");
  });

  it("keeps switching reachable in Member More even without module links", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
      media: "(max-width: 48rem)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: () => false,
    });
    render(
      <MobileMemberNavigation
        groups={[]}
        path="/dashboard"
        navigate={vi.fn()}
        workspaceSwitcher={
          <MobileWorkspaceChooser
            options={["member", "account"]}
            selected="member"
            onSwitch={vi.fn()}
          />
        }
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(
      within(screen.getByRole("dialog", { name: "More" })).getByRole("button", { name: /Account/ }),
    ).toBeVisible();
  });

  it("provides an Account/Platform More entry and closes when the context changes", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
      media: "(max-width: 48rem)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: () => false,
    });
    const { rerender } = render(
      <MobileWorkspaceMore
        key="account"
        options={["member", "account"]}
        selected="account"
        onSwitch={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("dialog", { name: "More" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Organization Admin/ })).toBeNull();
    rerender(
      <MobileWorkspaceMore
        key="platform"
        options={["member", "platform", "account"]}
        selected="platform"
        onSwitch={vi.fn()}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
