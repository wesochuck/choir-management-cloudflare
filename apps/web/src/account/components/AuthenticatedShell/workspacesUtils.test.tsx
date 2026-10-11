import { describe, expect, it, vi } from "vitest";
import {
  eventsPagePropsFromSearch,
  renderOrganizationPage,
  sanitizeEventsReturnTo,
  ticketingTabFromSearch,
} from "./workspacesUtils";
import { staticNavigationItems } from "../CommandPalette/navigationIndex";

describe("renderOrganizationPage routing and aliases", () => {
  const notFoundMarker = "NOT_FOUND";
  const notFoundPage = () => notFoundMarker;
  const navigate = vi.fn();

  it("resolves /admin/library and /admin/music to valid pages", () => {
    const libraryResult = renderOrganizationPage(
      { pathname: "/admin/library", search: "" },
      true,
      true,
      navigate,
      notFoundPage,
    );
    expect(libraryResult).not.toBe(notFoundMarker);

    const musicResult = renderOrganizationPage(
      { pathname: "/admin/music", search: "?pieceId=piece-123" },
      true,
      true,
      navigate,
      notFoundPage,
    );
    expect(musicResult).not.toBe(notFoundMarker);

    const creditFilterResult = renderOrganizationPage(
      { pathname: "/admin/library", search: "?credit=John%20Rutter&creditRole=composer" },
      true,
      true,
      navigate,
      notFoundPage,
    );
    expect(creditFilterResult).not.toBe(notFoundMarker);
  });

  it("resolves /admin/music settings variants to valid pages", () => {
    const settingsSubroute = renderOrganizationPage(
      { pathname: "/admin/music/settings", search: "" },
      true,
      true,
      navigate,
      notFoundPage,
    );
    expect(settingsSubroute).not.toBe(notFoundMarker);

    const settingsTab = renderOrganizationPage(
      { pathname: "/admin/music", search: "?tab=settings" },
      true,
      true,
      navigate,
      notFoundPage,
    );
    expect(settingsTab).not.toBe(notFoundMarker);
  });

  it("resolves music folder reports and poll aliases", () => {
    const folderReport = renderOrganizationPage(
      { pathname: "/admin/music/folders", search: "" },
      true,
      true,
      navigate,
      notFoundPage,
    );
    expect(folderReport).not.toBe(notFoundMarker);

    const commPolls = renderOrganizationPage(
      { pathname: "/admin/communications/polls", search: "?pollId=poll-1" },
      true,
      true,
      navigate,
      notFoundPage,
    );
    expect(commPolls).not.toBe(notFoundMarker);
  });

  it("returns notFoundPage for unrecognized routes", () => {
    const unknownResult = renderOrganizationPage(
      { pathname: "/admin/unknown-page", search: "" },
      true,
      true,
      navigate,
      notFoundPage,
    );
    expect(unknownResult).toBe(notFoundMarker);
  });

  it("ensures all static navigation items point to non-404 routes", () => {
    for (const item of staticNavigationItems) {
      if (!item.href) continue;
      const [pathWithHash, search] = item.href.split("?");
      const pathname = pathWithHash?.split("#")[0];
      if (!pathname?.startsWith("/admin")) continue;

      const result = renderOrganizationPage(
        { pathname, search: search ? `?${search}` : "" },
        true,
        true,
        navigate,
        notFoundPage,
      );
      if (pathname === "/admin") {
        expect(result).toBeNull();
      } else {
        expect(result).not.toBe(notFoundMarker);
      }
    }
  });

  it("parses events deep-link query parameters including eventId, section, and sanitized returnTo", () => {
    const props = eventsPagePropsFromSearch(
      "?eventId=event-456&section=tickets&type=Performance&returnTo=%2Fadmin%2Ftickets%3FeventId%3Devent-456",
    );
    expect(props).toEqual({
      initialAction: null,
      initialEventId: "event-456",
      initialSection: "tickets",
      initialType: "Performance",
      returnTo: "/admin/tickets?eventId=event-456",
    });
  });

  it("sanitizes returnTo to recognized internal routes and rejects open redirects", () => {
    expect(sanitizeEventsReturnTo("/admin/tickets")).toBe("/admin/tickets");
    expect(sanitizeEventsReturnTo("/admin/ticketing?eventId=123")).toBe(
      "/admin/ticketing?eventId=123",
    );
    expect(sanitizeEventsReturnTo("/admin/setlists")).toBe("/admin/setlists");
    expect(sanitizeEventsReturnTo("/admin/seating")).toBe("/admin/seating");

    // Rejects external/open-redirect attempts
    expect(sanitizeEventsReturnTo("https://evil.com")).toBeNull();
    expect(sanitizeEventsReturnTo("//evil.com")).toBeNull();
    expect(sanitizeEventsReturnTo("/\\evil.com")).toBeNull();
    expect(sanitizeEventsReturnTo("/admin/other")).toBeNull();
    expect(sanitizeEventsReturnTo("")).toBeNull();
    expect(sanitizeEventsReturnTo(null)).toBeNull();
  });

  it("normalizes invalid or unknown sections and event types", () => {
    const props = eventsPagePropsFromSearch("?eventId=%20%20&section=unknown&type=Audition");
    expect(props.initialEventId).toBeNull();
    expect(props.initialSection).toBeNull();
    expect(props.initialType).toBeNull();
  });

  it("parses allowlisted ticketing tabs and rejects unknown values", () => {
    expect(ticketingTabFromSearch("?eventId=abc&tab=discounts")).toBe("discounts");
    expect(ticketingTabFromSearch("?tab=orders")).toBe("orders");
    expect(ticketingTabFromSearch("?tab=willcall")).toBe("willcall");
    expect(ticketingTabFromSearch("?tab=auditions")).toBeNull();
    expect(ticketingTabFromSearch("")).toBeNull();
  });
});
