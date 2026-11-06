import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { moduleIdSchema } from "@choir/contracts";
import { MobileMemberNavigation } from "./MobileMemberNavigation";
import { memberGroups, visibleMemberNavigationGroups } from "./utils";

beforeEach(() => {
  vi.spyOn(window, "matchMedia").mockImplementation((media) => ({
    matches: true,
    media,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: () => false,
  }));
});
const navigate = () => vi.fn<(href: string) => Promise<boolean>>().mockResolvedValue(true);
const sheet = () => screen.getByRole("dialog");
const controls = () => screen.getByRole("navigation", { name: "Mobile Member navigation" });
function filtered(enabled: readonly string[], status: "ready" | "loading" | "error" = "ready") {
  return visibleMemberNavigationGroups(
    status,
    moduleIdSchema.options.map((id) => ({ id, enabled: enabled.includes(id) })),
  );
}

describe("mobile Member navigation", () => {
  it("projects the canonical Member groups without changing desktop order or exposing admin links", () => {
    render(<MobileMemberNavigation groups={memberGroups} path="/schedule" navigate={navigate()} />);
    expect(
      within(controls())
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/dashboard", "/schedule", "/practice"]);
    expect(screen.getByRole("link", { name: "Practice" }).querySelector("svg")).toHaveAttribute(
      "data-feature-icon",
      "headphones",
    );
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(
      within(sheet())
        .getAllByRole("link")
        .slice(0, 4)
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/profile", "/directory", "/dues", "/member/resources"]);
    expect(document.querySelector('a[href^="/admin"]')).toBeNull();
    expect(memberGroups[1]?.items[0]?.href).toBe("/schedule");
  });

  it("links Practice directly to the player when only practice_player is enabled", () => {
    render(
      <MobileMemberNavigation
        groups={filtered(["practice_player"])}
        path="/dashboard"
        navigate={navigate()}
      />,
    );
    expect(screen.queryByRole("link", { name: "Schedule" })).toBeNull();
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
    expect(screen.getByRole("link", { name: "Practice" })).toHaveAttribute("href", "/practice");
  });

  it("moves Resources under More when only resources is enabled", () => {
    render(
      <MobileMemberNavigation
        groups={filtered(["resources"])}
        path="/dashboard"
        navigate={navigate()}
      />,
    );
    expect(screen.queryByRole("link", { name: "Practice" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(within(sheet()).getByRole("link", { name: "Resources" })).toBeVisible();
    expect(within(sheet()).getAllByRole("link")).toHaveLength(2); // destination and Home footer
  });

  it.each(["loading", "error"] as const)("fails closed for %s modules", (status) => {
    render(
      <MobileMemberNavigation
        groups={filtered(moduleIdSchema.options, status)}
        path="/dashboard"
        navigate={navigate()}
      />,
    );
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("reactively closes an unavailable group and does not reopen it when access returns", () => {
    const props = { path: "/dashboard", navigate: navigate() };
    const { rerender } = render(<MobileMemberNavigation {...props} groups={memberGroups} />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    rerender(<MobileMemberNavigation {...props} groups={filtered(["practice_player"])} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<MobileMemberNavigation {...props} groups={memberGroups} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([
    "/dashboard",
    "/schedule",
    "/calendar",
    "/practice",
    "/member/resources",
    "/profile",
    "/directory",
    "/dues",
  ])("distinguishes route state from the open menu on %s", (path) => {
    render(<MobileMemberNavigation groups={memberGroups} path={path} navigate={navigate()} />);
    const current =
      path === "/dashboard"
        ? "Home"
        : ["/schedule", "/calendar"].includes(path)
          ? "Schedule"
          : path === "/practice"
            ? "Practice"
            : "More";
    const direct = current !== "More";
    const control = screen.getByRole(direct ? "link" : "button", { name: current });
    expect(control).toHaveAttribute(
      direct ? "aria-current" : "data-active",
      direct ? "page" : "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(document.querySelector("button[aria-current]")).toBeNull();
    if (current === "Schedule")
      expect(within(sheet()).getByRole("link", { name: "Schedule" })).toHaveAttribute(
        "aria-current",
        "page",
      );
  });

  it("toggles one sheet and dismisses without navigation", async () => {
    const go = navigate();
    render(<MobileMemberNavigation groups={memberGroups} path="/schedule" navigate={go} />);
    const opener = screen.getByRole("button", { name: "More" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(within(sheet()).getByRole("button", { name: "More" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(opener).toHaveFocus();
    fireEvent.click(opener);
    fireEvent.click(within(sheet()).getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(go).not.toHaveBeenCalled();
  });

  it.each(["Home", "Schedule", "My Profile"])(
    "keeps the menu after rejected %s navigation and closes after acceptance",
    async (label) => {
      const go = navigate().mockResolvedValueOnce(false);
      render(<MobileMemberNavigation groups={memberGroups} path="/profile" navigate={go} />);
      fireEvent.click(screen.getByRole("button", { name: "More" }));
      fireEvent.click(within(sheet()).getByRole("link", { name: label }));
      await waitFor(() => {
        expect(go).toHaveBeenCalledTimes(1);
      });
      expect(sheet()).toBeVisible();
      fireEvent.click(within(sheet()).getByRole("link", { name: label }));
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
    },
  );

  it("retains modified-link behavior and resets after accepted route changes", () => {
    const go = navigate();
    const { rerender } = render(
      <MobileMemberNavigation groups={memberGroups} path="/schedule" navigate={go} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(within(sheet()).getByRole("link", { name: "Resources" }), { ctrlKey: true });
    expect(go).not.toHaveBeenCalled();
    expect(sheet()).toBeVisible();
    rerender(
      <MobileMemberNavigation groups={memberGroups} path="/member/resources" navigate={go} />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
