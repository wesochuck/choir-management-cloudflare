import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationMusicLibrarySettings, OrganizationMusicPiece } from "@choir/contracts";
import { MusicLibrarySettingsPage } from "./MusicLibrarySettingsPage";

vi.mock("../auth/api", () => ({
  AuthApiError: class AuthApiError extends Error {},
  batchAddOrganizationMusicGenres: vi.fn(),
  deleteOrganizationMusicGenre: vi.fn(),
  getOrganizationMusicLibrarySettings: vi.fn(),
  listOrganizationMusic: vi.fn(),
  renameOrganizationMusicGenre: vi.fn(),
  updateOrganizationMusicLibrarySettings: vi.fn(),
}));

import {
  batchAddOrganizationMusicGenres,
  deleteOrganizationMusicGenre,
  getOrganizationMusicLibrarySettings,
  listOrganizationMusic,
  renameOrganizationMusicGenre,
} from "../auth/api";

const MOCK_SETTINGS: OrganizationMusicLibrarySettings = {
  defaultPageSize: 100,
  genres: ["Classical", "Folk"],
  practicePlayerLinkLifetimeDays: 180,
  publisherSearchTemplate: "https://example.com/search?q={catalogId}",
};

const MOCK_PIECES: readonly OrganizationMusicPiece[] = [
  {
    arranger: "Arranger A",
    catalogId: "CAT-1",
    composer: "Composer A",
    copies: 50,
    createdAt: "2026-01-01T00:00:00Z",
    durationSeconds: 180,
    genres: ["Classical"],
    id: "00000000-0000-4000-8000-000000000001",
    lastPerformedAt: null,
    notes: "",
    parentId: null,
    performanceCount: 2,
    purchaseDate: null,
    scoreFileIds: {},
    sectionBuckets: [],
    title: "Piece One",
    trackFileIds: {},
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    arranger: "",
    catalogId: "CAT-2",
    composer: "Composer B",
    copies: 40,
    createdAt: "2026-01-02T00:00:00Z",
    durationSeconds: 240,
    genres: ["Classical", "Folk"],
    id: "00000000-0000-4000-8000-000000000002",
    lastPerformedAt: null,
    notes: "",
    parentId: null,
    performanceCount: 1,
    purchaseDate: null,
    scoreFileIds: {},
    sectionBuckets: [],
    title: "Piece Two",
    trackFileIds: {},
    updatedAt: "2026-01-02T00:00:00Z",
  },
];

describe("MusicLibrarySettingsPage genre management with DataTable & batch add", () => {
  const navigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOrganizationMusicLibrarySettings).mockResolvedValue(MOCK_SETTINGS);
    vi.mocked(listOrganizationMusic).mockResolvedValue(MOCK_PIECES);
  });

  it("renders genres in DataTable with correct counts and sorting", async () => {
    render(<MusicLibrarySettingsPage enabled={true} navigate={navigate} />);

    await waitFor(() => {
      expect(screen.getByText("Genres in your catalog")).toBeInTheDocument();
    });

    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Genre" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Pieces" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();

    // Classical has 2 pieces, Folk has 1 piece
    expect(within(table).getByText("Classical")).toBeInTheDocument();
    expect(within(table).getByText("Folk")).toBeInTheDocument();
    expect(within(table).getByText("2")).toBeInTheDocument();
    expect(within(table).getByText("1")).toBeInTheDocument();
  });

  it("stages a new genre and shows Pending status with batch save button", async () => {
    const user = userEvent.setup();
    render(<MusicLibrarySettingsPage enabled={true} navigate={navigate} />);

    await waitFor(() => {
      expect(screen.getByLabelText("Add genre labels")).toBeInTheDocument();
    });

    const input = screen.getByLabelText("Add genre labels");
    await user.type(input, "Jazz");
    await user.click(screen.getByRole("button", { name: "Add to list" }));

    // Input is cleared and "Jazz" is staged with "Pending" pill
    const table = screen.getByRole("table");
    expect(input).toHaveValue("");
    expect(within(table).getByText("Jazz")).toBeInTheDocument();
    expect(within(table).getByText("Pending")).toBeInTheDocument();

    // Staged banner appears
    const stagedBanner = screen.getByRole("region", { name: "Staged genres" });
    expect(stagedBanner).toHaveTextContent("1 new genre staged to be saved.");
    expect(screen.getByRole("button", { name: "Save 1 new genre" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear staged" })).toBeInTheDocument();
  });

  it("stages multiple comma-separated genres in one entry", async () => {
    const user = userEvent.setup();
    render(<MusicLibrarySettingsPage enabled={true} navigate={navigate} />);

    await waitFor(() => {
      expect(screen.getByLabelText("Add genre labels")).toBeInTheDocument();
    });

    const input = screen.getByLabelText("Add genre labels");
    await user.type(input, "Gospel, Spiritual");
    await user.click(screen.getByRole("button", { name: "Add to list" }));

    const table = screen.getByRole("table");
    expect(within(table).getByText("Gospel")).toBeInTheDocument();
    expect(within(table).getByText("Spiritual")).toBeInTheDocument();
    const stagedBanner = screen.getByRole("region", { name: "Staged genres" });
    expect(stagedBanner).toHaveTextContent("2 new genres staged to be saved.");
    expect(screen.getByRole("button", { name: "Save 2 new genres" })).toBeInTheDocument();
  });

  it("rejects duplicates against saved genres and within input", async () => {
    const user = userEvent.setup();
    render(<MusicLibrarySettingsPage enabled={true} navigate={navigate} />);

    await waitFor(() => {
      expect(screen.getByLabelText("Add genre labels")).toBeInTheDocument();
    });

    const input = screen.getByLabelText("Add genre labels");
    await user.type(input, "classical");
    await user.click(screen.getByRole("button", { name: "Add to list" }));

    expect(screen.getByRole("alert")).toHaveTextContent('Genre label "classical" already exists.');

    // Duplicated within input
    await user.clear(input);
    await user.type(input, "Rock, rock");
    await user.click(screen.getByRole("button", { name: "Add to list" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      'Genre label "rock" is duplicated in your input.',
    );
  });

  it("removes a pending genre or clears all staged genres", async () => {
    const user = userEvent.setup();
    render(<MusicLibrarySettingsPage enabled={true} navigate={navigate} />);

    await waitFor(() => {
      expect(screen.getByLabelText("Add genre labels")).toBeInTheDocument();
    });

    const input = screen.getByLabelText("Add genre labels");
    await user.type(input, "Opera, Pop");
    await user.click(screen.getByRole("button", { name: "Add to list" }));

    const table = screen.getByRole("table");
    expect(within(table).getByText("Opera")).toBeInTheDocument();
    expect(within(table).getByText("Pop")).toBeInTheDocument();

    // Remove single pending genre
    await user.click(within(table).getByRole("button", { name: "Remove pending genre Opera" }));
    expect(within(table).queryByText("Opera")).not.toBeInTheDocument();
    expect(within(table).getByText("Pop")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Staged genres" })).toHaveTextContent(
      "1 new genre staged to be saved.",
    );

    // Clear remaining staged
    await user.click(screen.getByRole("button", { name: "Clear staged" }));
    expect(within(table).queryByText("Pop")).not.toBeInTheDocument();
    expect(screen.queryByText("Clear staged")).not.toBeInTheDocument();
  });

  it("saves pending genres using batchAddOrganizationMusicGenres", async () => {
    const user = userEvent.setup();
    vi.mocked(batchAddOrganizationMusicGenres).mockResolvedValue({
      pieces: [],
      settings: {
        ...MOCK_SETTINGS,
        genres: ["Classical", "Folk", "Gospel", "Jazz"],
      },
    });

    render(<MusicLibrarySettingsPage enabled={true} navigate={navigate} />);

    await waitFor(() => {
      expect(screen.getByLabelText("Add genre labels")).toBeInTheDocument();
    });

    const input = screen.getByLabelText("Add genre labels");
    await user.type(input, "Gospel, Jazz");
    await user.click(screen.getByRole("button", { name: "Add to list" }));

    await user.click(screen.getByRole("button", { name: "Save 2 new genres" }));

    await waitFor(() => {
      expect(batchAddOrganizationMusicGenres).toHaveBeenCalledWith({
        labels: ["Gospel", "Jazz"],
      });
      expect(screen.getByText("2 new genres added.")).toBeInTheDocument();
    });

    // Staged banner is dismissed
    expect(screen.queryByText("Clear staged")).not.toBeInTheDocument();
  });

  it("renames a saved genre inline", async () => {
    const user = userEvent.setup();
    vi.mocked(renameOrganizationMusicGenre).mockResolvedValue({
      pieces: [],
      settings: {
        ...MOCK_SETTINGS,
        genres: ["Classical", "Traditional Folk"],
      },
    });

    render(<MusicLibrarySettingsPage enabled={true} navigate={navigate} />);

    await waitFor(() => {
      const table = screen.getByRole("table");
      expect(within(table).getByRole("button", { name: "Rename Folk genre" })).toBeInTheDocument();
    });

    const table = screen.getByRole("table");
    await user.click(within(table).getByRole("button", { name: "Rename Folk genre" }));

    const renameInput = within(table).getByLabelText("Rename Folk genre");
    expect(renameInput).toHaveValue("Folk");

    await user.clear(renameInput);
    await user.type(renameInput, "Traditional Folk");
    await user.click(within(table).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(renameOrganizationMusicGenre).toHaveBeenCalledWith({
        currentLabel: "Folk",
        newLabel: "Traditional Folk",
      });
      expect(screen.getByText("Genre renamed.")).toBeInTheDocument();
    });
  });

  it("deletes a saved genre with confirmation", async () => {
    const user = userEvent.setup();
    vi.mocked(deleteOrganizationMusicGenre).mockResolvedValue({
      pieces: [],
      settings: {
        ...MOCK_SETTINGS,
        genres: ["Classical"],
      },
    });

    render(<MusicLibrarySettingsPage enabled={true} navigate={navigate} />);

    await waitFor(() => {
      const table = screen.getByRole("table");
      expect(within(table).getByRole("button", { name: "Delete Folk genre" })).toBeInTheDocument();
    });

    const table = screen.getByRole("table");
    await user.click(within(table).getByRole("button", { name: "Delete Folk genre" }));

    // Confirmation dialog appears
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Remove Folk?" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Remove genre" }));

    await waitFor(() => {
      expect(deleteOrganizationMusicGenre).toHaveBeenCalledWith({ label: "Folk" });
      expect(screen.getByText("Genre removed.")).toBeInTheDocument();
    });
  });
});
