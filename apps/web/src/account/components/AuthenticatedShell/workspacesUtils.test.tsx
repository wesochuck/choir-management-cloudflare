import { describe, expect, it, vi } from "vitest";
import {
  eventsPagePropsFromSearch,
  renderMemberPage,
  renderOrganizationPage,
  safeAdminReturnPath,
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

  it("resolves /admin/donations and /admin/patrons to valid pages (#180)", () => {
    const donationsResult = renderOrganizationPage(
      { pathname: "/admin/donations", search: "" },
      true,
      true,
      navigate,
      notFoundPage,
    );
    expect(donationsResult).not.toBe(notFoundMarker);

    const patronsResult = renderOrganizationPage(
      { pathname: "/admin/patrons", search: "?tab=levels" },
      true,
      true,
      navigate,
      notFoundPage,
    );
    expect(patronsResult).not.toBe(notFoundMarker);
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

  it("allows opening an event directly to its Promotion section", () => {
    const props = eventsPagePropsFromSearch("?eventId=event-456&section=promotion");
    expect(props).toMatchObject({
      initialEventId: "event-456",
      initialSection: "promotion",
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

  it("resolves safe admin return paths and rejects non-admin routes and open redirects", () => {
    // Default admin return path when arriving from admin sidebar
    expect(safeAdminReturnPath("?from=admin")).toBe("/admin/roster");

    // Specific admin return destinations
    expect(safeAdminReturnPath("?from=admin&returnTo=%2Fadmin%2Fevents")).toBe("/admin/events");
    expect(safeAdminReturnPath("?returnTo=/admin/settings")).toBe("/admin/settings");
    expect(safeAdminReturnPath("?returnTo=/admin/roster?filter=soprano#top")).toBe(
      "/admin/roster?filter=soprano#top",
    );

    // Rejects external/open-redirect attempts and non-admin routes
    expect(safeAdminReturnPath("?returnTo=https://evil.com")).toBeNull();
    expect(safeAdminReturnPath("?returnTo=//evil.com")).toBeNull();
    expect(safeAdminReturnPath("?returnTo=/\\evil.com")).toBeNull();
    expect(safeAdminReturnPath("?returnTo=%2F%5Cevil.com")).toBeNull();
    expect(safeAdminReturnPath("?returnTo=/member/schedule")).toBeNull();
    expect(safeAdminReturnPath("?returnTo=/dashboard")).toBeNull();
    expect(safeAdminReturnPath("?from=admin&returnTo=https://evil.com")).toBeNull();
    expect(safeAdminReturnPath("")).toBeNull();
    expect(safeAdminReturnPath("?search=test")).toBeNull();
  });

  it("passes adminReturnTo to MemberProfileDirectory when rendering /directory", () => {
    const navigate = vi.fn();
    const hasDirectoryProps = (
      value: unknown,
    ): value is {
      readonly props: { readonly adminReturnTo?: string | null; readonly view?: string };
    } => typeof value === "object" && value !== null && "props" in value;

    const elementWithAdminReturn = renderMemberPage(
      "/directory",
      true,
      navigate,
      "ready",
      false,
      "/admin/roster",
    );
    expect(hasDirectoryProps(elementWithAdminReturn)).toBe(true);
    if (hasDirectoryProps(elementWithAdminReturn)) {
      expect(elementWithAdminReturn.props.adminReturnTo).toBe("/admin/roster");
      expect(elementWithAdminReturn.props.view).toBe("directory");
    }

    const elementWithoutAdminReturn = renderMemberPage(
      "/directory",
      true,
      navigate,
      "ready",
      false,
    );
    expect(hasDirectoryProps(elementWithoutAdminReturn)).toBe(true);
    if (hasDirectoryProps(elementWithoutAdminReturn)) {
      expect(elementWithoutAdminReturn.props.adminReturnTo).toBeUndefined();
      expect(elementWithoutAdminReturn.props.view).toBe("directory");
    }
  });
});
