import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import type { NavigationGroup } from "../components/AuthenticatedShell/types";
import { MobileOrganizationAdminNavigation } from "./MobileOrganizationAdminNavigation";

const mockGroups: readonly NavigationGroup[] = [
  {
    id: "home",
    label: "Dashboard",
    items: [{ href: "/admin", label: "Admin overview", iconId: "home" }],
  },
  {
    id: "people",
    label: "People & membership",
    tone: "blue",
    iconId: "roster",
    items: [
      { href: "/admin/roster", label: "Roster", iconId: "roster" },
      { href: "/admin/contacts", label: "Contacts", iconId: "contacts" },
    ],
  },
  {
    id: "events",
    label: "Events & attendance",
    tone: "amber",
    iconId: "events",
    items: [
      { href: "/admin/events", label: "Events", iconId: "events" },
      { href: "/admin/attendance", label: "Attendance", iconId: "attendance" },
    ],
  },
  {
    id: "music",
    label: "Music & content",
    tone: "green",
    iconId: "music",
    items: [{ href: "/admin/library", label: "Music library", iconId: "music" }],
  },
  {
    id: "finance",
    label: "Finance",
    tone: "slate",
    iconId: "ticketing",
    items: [{ href: "/admin/tickets", label: "Ticketing", iconId: "ticketing" }],
  },
];

describe("MobileOrganizationAdminNavigation", () => {
  it("renders the 4 bottom controls with proper accessibility attributes", () => {
    const navigate = vi.fn().mockResolvedValue(true);
    const onSearch = vi.fn();

    render(
      <MobileOrganizationAdminNavigation
        groups={mockGroups}
        navigate={navigate}
        onSearch={onSearch}
        path="/admin"
      />,
    );

    const homeBtn = screen.getByRole("button", { name: "Home" });
    const peopleBtn = screen.getByRole("button", { name: "People" });
    const eventsBtn = screen.getByRole("button", { name: "Events" });
    const moreBtn = screen.getByRole("button", { name: "More" });

    expect(homeBtn).toBeInTheDocument();
    expect(peopleBtn).toBeInTheDocument();
    expect(eventsBtn).toBeInTheDocument();
    expect(moreBtn).toBeInTheDocument();

    // Home is active, but not aria-current="page" on group buttons
    expect(homeBtn).toHaveAttribute("data-active", "true");
    expect(homeBtn).not.toHaveAttribute("aria-current");

    expect(peopleBtn).toHaveAttribute("aria-haspopup", "dialog");
    expect(peopleBtn).toHaveAttribute("aria-expanded", "false");
    expect(peopleBtn).not.toHaveAttribute("aria-current");

    expect(eventsBtn).toHaveAttribute("aria-haspopup", "dialog");
    expect(eventsBtn).toHaveAttribute("aria-expanded", "false");

    expect(moreBtn).toHaveAttribute("aria-haspopup", "dialog");
    expect(moreBtn).toHaveAttribute("aria-expanded", "false");
  });

  it("marks active section according to current route", () => {
    const navigate = vi.fn().mockResolvedValue(true);
    const onSearch = vi.fn();

    const { rerender } = render(
      <MobileOrganizationAdminNavigation
        groups={mockGroups}
        navigate={navigate}
        onSearch={onSearch}
        path="/admin/roster"
      />,
    );

    expect(screen.getByRole("button", { name: "People" })).toHaveAttribute("data-active", "true");
    expect(screen.getByRole("button", { name: "Home" })).not.toHaveAttribute("data-active");

    rerender(
      <MobileOrganizationAdminNavigation
        groups={mockGroups}
        navigate={navigate}
        onSearch={onSearch}
        path="/admin/events"
      />,
    );

    expect(screen.getByRole("button", { name: "Events" })).toHaveAttribute("data-active", "true");
    expect(screen.getByRole("button", { name: "People" })).not.toHaveAttribute("data-active");

    rerender(
      <MobileOrganizationAdminNavigation
        groups={mockGroups}
        navigate={navigate}
        onSearch={onSearch}
        path="/admin/library"
      />,
    );

    expect(screen.getByRole("button", { name: "More" })).toHaveAttribute("data-active", "true");
  });

  it("tapping Home calls navigate('/admin') and closes sheet if open", () => {
    const navigate = vi.fn().mockResolvedValue(true);
    const onSearch = vi.fn();

    render(
      <MobileOrganizationAdminNavigation
        groups={mockGroups}
        navigate={navigate}
        onSearch={onSearch}
        path="/admin/roster"
      />,
    );

    const homeBtn = screen.getByRole("button", { name: "Home" });
    fireEvent.click(homeBtn);

    expect(navigate).toHaveBeenCalledWith("/admin");
  });

  it("opens People sheet, lists destinations, and marks current page link", () => {
    const navigate = vi.fn().mockResolvedValue(true);
    const onSearch = vi.fn();

    render(
      <MobileOrganizationAdminNavigation
        groups={mockGroups}
        navigate={navigate}
        onSearch={onSearch}
        path="/admin/roster"
      />,
    );

    const peopleBtn = screen.getByRole("button", { name: "People" });
    fireEvent.click(peopleBtn);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "People & membership" })).toBeInTheDocument();

    const rosterLink = screen.getByRole("link", { name: /Roster/ });
    const contactsLink = screen.getByRole("link", { name: /Contacts/ });

    expect(rosterLink).toBeInTheDocument();
    expect(rosterLink).toHaveAttribute("aria-current", "page");
    expect(contactsLink).toBeInTheDocument();
    expect(contactsLink).not.toHaveAttribute("aria-current");

    // Tapping open People button again dismisses the sheet
    const inSheetPeopleBtn = dialog.querySelector(
      '.mobile-bottom-nav--in-sheet button[aria-label="People"]',
    );
    expect(inSheetPeopleBtn).not.toBeNull();
    if (!inSheetPeopleBtn) throw new Error("inSheetPeopleBtn not found");
    fireEvent.click(inSheetPeopleBtn);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("guarded navigation keeps sheet open when navigation is rejected", async () => {
    const navigate = vi.fn().mockResolvedValue(false); // blocked by unsaved changes
    const onSearch = vi.fn();

    render(
      <MobileOrganizationAdminNavigation
        groups={mockGroups}
        navigate={navigate}
        onSearch={onSearch}
        path="/admin/roster"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "People" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /Contacts/ }));
    expect(navigate).toHaveBeenCalledWith("/admin/contacts");

    await waitFor(() => {
      // Still open because navigate returned false
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  it("switches from People to Events without closing modal interaction boundary", () => {
    const navigate = vi.fn().mockResolvedValue(true);
    const onSearch = vi.fn();

    render(
      <MobileOrganizationAdminNavigation
        groups={mockGroups}
        navigate={navigate}
        onSearch={onSearch}
        path="/admin"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "People" }));
    expect(screen.getByRole("heading", { name: "People & membership" })).toBeInTheDocument();

    // Click Events on the bottom bar inside the sheet
    const dialog = screen.getByRole("dialog");
    const eventsTrigger = dialog.querySelector('button[aria-label="Events"]');
    expect(eventsTrigger).not.toBeNull();
    if (!eventsTrigger) throw new Error("eventsTrigger not found");
    fireEvent.click(eventsTrigger);

    expect(screen.getByRole("heading", { name: "Events & attendance" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Events/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Attendance/ })).toBeInTheDocument();
  });

  it("handles More sheet with categories, drilling into category and Back navigation", () => {
    const navigate = vi.fn().mockResolvedValue(true);
    const onSearch = vi.fn();

    render(
      <MobileOrganizationAdminNavigation
        groups={mockGroups}
        navigate={navigate}
        onSearch={onSearch}
        path="/admin"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("heading", { name: "More" })).toBeInTheDocument();

    // Categories are displayed
    const musicBtn = screen.getByRole("button", { name: /Music & content/ });
    const financeBtn = screen.getByRole("button", { name: /Finance/ });
    const searchBtn = screen.getByRole("button", { name: /Quick search/ });

    expect(musicBtn).toBeInTheDocument();
    expect(financeBtn).toBeInTheDocument();
    expect(searchBtn).toBeInTheDocument();

    // Tap Music & content category
    fireEvent.click(musicBtn);
    expect(screen.getByRole("heading", { name: "Music & content" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Music library/ })).toBeInTheDocument();

    // Back button is visible
    const backBtn = screen.getByRole("button", { name: "Back to More" });
    expect(backBtn).toBeInTheDocument();

    // Tap Back
    fireEvent.click(backBtn);
    expect(screen.getByRole("heading", { name: "More" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Finance/ })).toBeInTheDocument();

    // Tap Quick search
    fireEvent.click(screen.getByRole("button", { name: /Quick search/ }));
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
