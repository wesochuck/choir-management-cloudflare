import { describe, expect, it, vi } from "vitest";
import { renderOrganizationPage } from "./workspacesUtils";
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
});
