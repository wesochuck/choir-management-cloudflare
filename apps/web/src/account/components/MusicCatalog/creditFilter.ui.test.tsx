import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import type { OrganizationRosterConfiguration } from "@choir/contracts";
import { MusicCatalogView } from "./view";
import type { MusicCatalogModel } from "./hooks";

const MOCK_ROSTER: OrganizationRosterConfiguration = {
  attendanceReportWarningThreshold: 1,
  onBreakTimeoutDays: 365,
  onBreakTimeoutEnabled: true,
  performerLabel: "Performer",
  rsvpExpiryEnabled: true,
  rsvpFollowUpEnabled: true,
  rsvpFollowUpLeadHours: 48,
  sections: [{ code: "S", color: "#000000", name: "Soprano", trackOnly: false }],
  statusAutomationEnabled: true,
  statusAutomationMissThreshold: 3,
  statusAutomationRecoveryEnabled: true,
  voiceParts: [{ fullName: "Soprano 1", label: "S1", sectionCode: "S" }],
};

function mockCatalogModel(overrides: Partial<MusicCatalogModel> = {}): MusicCatalogModel {
  return {
    addSelectedPiecesToSetList: vi.fn(),
    applyBulkChanges: vi.fn(),
    applyBulkDelete: vi.fn(),
    availableGenres: [],
    beginNew: vi.fn(),
    bulkDialogOpen: false,
    bulkError: null,
    busy: false,
    childCount: 0,
    clearCreditFilter: vi.fn(),
    closeBulkDialog: vi.fn(),
    closeDialog: vi.fn(),
    closeImportDialog: vi.fn(),
    copiesInput: "",
    creditFilter: null,
    defaultPageSize: 100,
    deleteConfirm: false,
    deselectManyPieces: vi.fn(),
    dialogOpen: false,
    downloadImportErrors: vi.fn(),
    durationAutoFillLabel: null,
    durationDetectionNotice: null,
    durationInput: "",
    durationMismatch: null,
    editingId: null,
    editorTab: "details",
    error: null,
    events: [],
    genreCounts: new Map(),
    genreFilterMode: "and",
    genreFilterSearch: "",
    genresInput: "",
    handleMusicColumnMap: vi.fn(),
    handleMusicImportFile: vi.fn(),
    handlePendingTuttiFileChange: vi.fn(),
    handlePerformanceChanged: vi.fn(),
    handleTrackDurationDetected: vi.fn(),
    importCsv: vi.fn(),
    importDialogOpen: false,
    importFile: null,
    lastImportErrors: [],
    message: null,
    musicImportConfirmed: false,
    musicImportHeaders: [],
    musicImportInspecting: false,
    musicImportInspection: null,
    musicImportMappings: [],
    pendingTuttiFile: null,
    personNameOptions: [],
    piece: {
      arranger: "",
      catalogId: "",
      composer: "",
      copies: null,
      durationSeconds: null,
      genres: [],
      notes: "",
      parentId: null,
      purchaseDate: null,
      sectionBuckets: [],
      title: "",
      trackFileIds: {},
    },
    pieces: [],
    publisherSearchTemplate: "",
    renameCredit: vi.fn(),
    remove: vi.fn(),
    roster: MOCK_ROSTER,
    save: vi.fn(),
    search: "",
    selectManyPieces: vi.fn(),
    selectPiece: vi.fn(),
    selectedGenres: [],
    selectedPiece: null,
    selectedPieceIds: [],
    selectedPieces: [],
    setBulkDialogOpen: vi.fn(),
    setBulkError: vi.fn(),
    setCopiesInput: vi.fn(),
    setCreditFilter: vi.fn(),
    setDeleteConfirm: vi.fn(),
    setDurationValue: vi.fn(),
    setEditorPiece: vi.fn(),
    setEditorTab: vi.fn(),
    setError: vi.fn(),
    setGenreFilterMode: vi.fn(),
    setGenreFilterSearch: vi.fn(),
    setGenresInput: vi.fn(),
    setImportDialogOpen: vi.fn(),
    setListDialogOpen: false,
    setListError: null,
    setMessage: vi.fn(),
    setMusicImportConfirmed: vi.fn(),
    setPiece: vi.fn(),
    setPieces: vi.fn(),
    setSearch: vi.fn(),
    setSetListDialogOpen: vi.fn(),
    setSetListError: vi.fn(),
    setShowUncategorized: vi.fn(),
    setUnlinkChildren: vi.fn(),
    showUncategorized: false,
    timezone: "UTC",
    toggleGenre: vi.fn(),
    togglePieceSelection: vi.fn(),
    toggleUncategorized: vi.fn(),
    topLevelPieces: [],
    uncategorizedCount: 0,
    unlinkChildren: false,
    venues: [],
    ...overrides,
  };
}

describe("MusicCatalogView active credit filter notice and Clear action", () => {
  const navigate = vi.fn();

  it("displays composer credit filter notice and calls clearCreditFilter on click", async () => {
    const user = userEvent.setup();
    const clearCreditFilter = vi.fn();
    const model = mockCatalogModel({
      clearCreditFilter,
      creditFilter: { name: "John Rutter", role: "composer" },
    });

    render(<MusicCatalogView model={model} navigate={navigate} view="catalog" />);

    expect(screen.getByRole("status")).toHaveTextContent("Filtered by composer: John Rutter");

    const clearButton = screen.getByRole("button", {
      name: "Clear filter for John Rutter",
    });
    expect(clearButton).toBeInTheDocument();

    await user.click(clearButton);
    expect(clearCreditFilter).toHaveBeenCalledTimes(1);
  });

  it("displays arranger credit filter notice", () => {
    const model = mockCatalogModel({
      creditFilter: { name: "Mark Hayes", role: "arranger" },
    });

    render(<MusicCatalogView model={model} navigate={navigate} view="catalog" />);

    expect(screen.getByRole("status")).toHaveTextContent("Filtered by arranger: Mark Hayes");
  });

  it("displays composer or arranger notice when role is any", () => {
    const model = mockCatalogModel({
      creditFilter: { name: "Alice Parker", role: "any" },
    });

    render(<MusicCatalogView model={model} navigate={navigate} view="catalog" />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Filtered by composer or arranger: Alice Parker",
    );
  });
});
