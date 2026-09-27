import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import type { OrganizationMusicPiece } from "@choir/contracts";
import { MusicCredits } from "./credits";

function mockPiece(
  id: string,
  title: string,
  composer: string,
  arranger: string,
): OrganizationMusicPiece {
  return {
    arranger,
    catalogId: `CAT-${id}`,
    composer,
    copies: 20,
    createdAt: "2026-01-01T00:00:00Z",
    durationSeconds: 180,
    genres: ["Sacred"],
    id,
    lastPerformedAt: null,
    notes: "",
    parentId: null,
    performanceCount: 0,
    purchaseDate: null,
    sectionBuckets: [],
    title,
    trackFileIds: {},
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("MusicCredits actionable piece count links", () => {
  const pieces: readonly OrganizationMusicPiece[] = [
    mockPiece("p1", "Look at the World", "John Rutter", ""),
    mockPiece("p2", "The Lord Bless You", "John Rutter", "Mark Hayes"),
    mockPiece("p3", "Te Deum", "", "Mark Hayes"),
    mockPiece("p4", "Simple Gifts", "Traditional", "Alice Parker"),
  ];

  it("renders non-zero counts as accessible links and zero counts as plain text", () => {
    const onNavigate = vi.fn();
    const onRename = vi.fn();

    render(
      <MusicCredits busy={false} onNavigate={onNavigate} onRename={onRename} pieces={pieces} />,
    );

    const table = screen.getByRole("table");

    // John Rutter: Composer=2, Arranger=0, Total=2
    const rutterComposerLink = within(table).getByRole("link", {
      name: "View 2 pieces composed by John Rutter",
    });
    expect(rutterComposerLink).toBeInTheDocument();
    expect(rutterComposerLink).toHaveAttribute(
      "href",
      "/admin/library?credit=John%20Rutter&creditRole=composer",
    );

    const rutterTotalLink = within(table).getByRole("link", {
      name: "View 2 pieces credited to John Rutter",
    });
    expect(rutterTotalLink).toBeInTheDocument();
    expect(rutterTotalLink).toHaveAttribute(
      "href",
      "/admin/library?credit=John%20Rutter&creditRole=any",
    );

    // John Rutter Arranger count is 0: not a link
    expect(
      within(table).queryByRole("link", {
        name: /arranged by John Rutter/i,
      }),
    ).not.toBeInTheDocument();

    // Mark Hayes: Composer=0, Arranger=2, Total=2
    const hayesArrangerLink = within(table).getByRole("link", {
      name: "View 2 pieces arranged by Mark Hayes",
    });
    expect(hayesArrangerLink).toBeInTheDocument();
    expect(hayesArrangerLink).toHaveAttribute(
      "href",
      "/admin/library?credit=Mark%20Hayes&creditRole=arranger",
    );

    // Mark Hayes Composer count is 0: not a link
    expect(
      within(table).queryByRole("link", {
        name: /composed by Mark Hayes/i,
      }),
    ).not.toBeInTheDocument();
  });

  it("calls onNavigate with appropriate URL when a count link is clicked", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const onRename = vi.fn();

    render(
      <MusicCredits busy={false} onNavigate={onNavigate} onRename={onRename} pieces={pieces} />,
    );

    const table = screen.getByRole("table");
    const rutterComposerLink = within(table).getByRole("link", {
      name: "View 2 pieces composed by John Rutter",
    });

    await user.click(rutterComposerLink);
    expect(onNavigate).toHaveBeenCalledWith(
      "/admin/library?credit=John%20Rutter&creditRole=composer",
    );
  });

  it("opens rename dialog and retains rename functionality", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const onRename = vi.fn().mockResolvedValue(2);

    render(
      <MusicCredits busy={false} onNavigate={onNavigate} onRename={onRename} pieces={pieces} />,
    );

    const table = screen.getByRole("table");
    const renameButtons = within(table).getAllByRole("button", { name: "Rename" });
    const firstRenameButton = renameButtons[0];
    expect(firstRenameButton).toBeDefined();
    if (!firstRenameButton) throw new Error("Expected rename button");
    await user.click(firstRenameButton);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
