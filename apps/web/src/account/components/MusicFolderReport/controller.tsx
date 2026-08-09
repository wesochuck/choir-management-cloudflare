import {
  getMusicFolderProfileDetail,
  exportMusicFolderReport,
  queryMusicFolderReport,
  updateMusicFolderNumbers,
  updateMusicFolderReturnStatus,
} from "../../../auth/api";
import type {
  MusicFolderReportDetailRow,
  MusicFolderReportProfileDetailResponse,
  MusicFolderReportQueryResponse,
} from "@choir/contracts";
import { useConfirmation, type ConfirmationOptions } from "@choir/ui";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  changedFolderEdits,
  folderRowKey,
  hasUnsavedFolderDrafts,
  type MusicFolderSummaryFilter,
} from "./model";

export type MusicFolderReportLoadState = "loading" | "ready" | "error";

export interface MusicFolderReportController {
  readonly actionError: string | null;
  readonly confirm: (options: ConfirmationOptions) => Promise<boolean>;
  readonly confirmationDialog: ReactNode;
  readonly detail: MusicFolderReportProfileDetailResponse | null;
  readonly detailState: MusicFolderReportLoadState;
  readonly drafts: Readonly<Record<string, string>>;
  readonly expandedProfileId: string | null;
  readonly hasUnsavedDrafts: boolean;
  readonly pendingReturnKey: string | null;
  readonly query: string;
  readonly queryState: MusicFolderReportLoadState;
  readonly report: MusicFolderReportQueryResponse | null;
  readonly rowErrors: Readonly<Record<string, string>>;
  readonly selectedEventIds: readonly string[];
  readonly statusFilter: MusicFolderSummaryFilter;
  readonly changeSelection: (eventIds: readonly string[]) => void;
  readonly clearSelection: () => void;
  readonly discardChanges: () => void;
  readonly downloadCsv: () => Promise<void>;
  readonly markReturned: (row: MusicFolderReportDetailRow) => Promise<void>;
  readonly saveChanges: () => Promise<void>;
  readonly selectAll: () => void;
  readonly setDraft: (row: MusicFolderReportDetailRow, value: string) => void;
  readonly setExpandedProfileId: (profileId: string | null) => void;
  readonly setQuery: (value: string) => void;
  readonly setStatusFilter: (value: MusicFolderSummaryFilter) => void;
  readonly togglePerformance: (eventId: string) => void;
}

export function useMusicFolderReportController(enabled: boolean): MusicFolderReportController {
  const [queryState, setQueryState] = useState<MusicFolderReportLoadState>(
    enabled ? "loading" : "ready",
  );
  const [report, setReport] = useState<MusicFolderReportQueryResponse | null>(null);
  const [selectedEventIds, setSelectedEventIds] = useState<readonly string[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<MusicFolderSummaryFilter>("all");
  const [expandedProfileId, setExpandedProfileId] = useState<string | null>(null);
  const [detailState, setDetailState] = useState<MusicFolderReportLoadState>("ready");
  const [detail, setDetail] = useState<MusicFolderReportProfileDetailResponse | null>(null);
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [rowErrors, setRowErrors] = useState<Readonly<Record<string, string>>>({});
  const [pendingReturnKey, setPendingReturnKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { confirm, confirmationDialog } = useConfirmation();

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQueryState("loading");
    queryMusicFolderReport(selectedEventIds, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setReport(next);
        setQueryState("ready");
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setQueryState("error");
        }
      });
    return () => {
      controller.abort();
    };
  }, [enabled, selectedEventIds]);

  const selectedEventKey = selectedEventIds.join(",");
  useEffect(() => {
    if (!enabled || !expandedProfileId || selectedEventIds.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetail(null);
      setDetailState("ready");
      return;
    }
    const controller = new AbortController();
    setDetailState("loading");
    getMusicFolderProfileDetail(expandedProfileId, selectedEventIds, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setDetail(next);
        setDrafts({});
        setRowErrors({});
        setDetailState("ready");
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setDetailState("error");
        }
      });
    return () => {
      controller.abort();
    };
  }, [enabled, expandedProfileId, selectedEventKey, selectedEventIds]);

  useEffect(() => {
    function warnBeforeUnload(event: BeforeUnloadEvent): void {
      if (!hasUnsavedFolderDrafts(detail?.rows ?? [], drafts)) return;
      event.preventDefault();
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- Safari still requires returnValue for the native prompt.
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
    };
  }, [detail?.rows, drafts]);

  const hasUnsaved = useMemo(
    () => hasUnsavedFolderDrafts(detail?.rows ?? [], drafts),
    [detail?.rows, drafts],
  );

  const applySelection = useCallback((eventIds: readonly string[]): void => {
    setSelectedEventIds([...eventIds]);
    setExpandedProfileId(null);
    setDetail(null);
    setDrafts({});
    setRowErrors({});
    setActionError(null);
  }, []);

  const changeSelection = useCallback(
    (eventIds: readonly string[]) => {
      if (hasUnsaved) {
        void confirm({
          confirmLabel: "Change selection",
          description: "Your unsaved Folder Number changes will be discarded.",
          destructive: true,
          title: "Discard Folder Number changes?",
        }).then((shouldChange) => {
          if (shouldChange) applySelection(eventIds);
        });
        return;
      }
      applySelection(eventIds);
    },
    [applySelection, confirm, hasUnsaved],
  );

  const togglePerformance = useCallback(
    (eventId: string) => {
      const next = new Set(selectedEventIds);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      changeSelection([...next]);
    },
    [changeSelection, selectedEventIds],
  );

  const selectAll = useCallback(() => {
    changeSelection(report?.performanceOptions.map((option) => option.id) ?? []);
  }, [changeSelection, report?.performanceOptions]);

  const clearSelection = useCallback(() => {
    changeSelection([]);
  }, [changeSelection]);

  const setDraft = useCallback((row: MusicFolderReportDetailRow, value: string) => {
    const key = folderRowKey(row.profileId, row.eventId);
    setDrafts((current) => ({ ...current, [key]: value }));
    setRowErrors((current) => {
      if (!(key in current)) return current;
      const next: Record<string, string> = {};
      for (const [entryKey, entryValue] of Object.entries(current)) {
        if (entryKey !== key) next[entryKey] = entryValue;
      }
      return next;
    });
    setActionError(null);
  }, []);

  const replaceDetailRow = useCallback((row: MusicFolderReportDetailRow) => {
    setDetail((current) =>
      current
        ? {
            ...current,
            rows: current.rows.map((item) => (item.eventId === row.eventId ? row : item)),
          }
        : current,
    );
  }, []);

  const refreshReport = useCallback(async () => {
    const next = await queryMusicFolderReport(selectedEventIds);
    setReport(next);
  }, [selectedEventIds]);

  const saveChanges = useCallback(async () => {
    const rows = detail?.rows ?? [];
    const updates = changedFolderEdits(rows, drafts);
    if (updates.length === 0) return;
    setActionError(null);
    try {
      const response = await updateMusicFolderNumbers(updates);
      const nextErrors: Record<string, string> = {};
      for (const result of response.results) {
        const key = folderRowKey(result.profileId, result.eventId);
        if (result.row) replaceDetailRow(result.row);
        if (result.result === "applied") {
          setDrafts((current) => {
            const next: Record<string, string> = {};
            for (const [entryKey, entryValue] of Object.entries(current)) {
              if (entryKey !== key) next[entryKey] = entryValue;
            }
            return next;
          });
        } else {
          nextErrors[key] = result.message;
        }
      }
      setRowErrors(nextErrors);
      await refreshReport();
    } catch (error: unknown) {
      setActionError(
        error instanceof Error ? error.message : "Folder Number changes could not be saved.",
      );
    }
  }, [detail?.rows, drafts, refreshReport, replaceDetailRow]);

  const discardChanges = useCallback(() => {
    setDrafts({});
    setRowErrors({});
    setActionError(null);
  }, []);

  const markReturned = useCallback(
    async (row: MusicFolderReportDetailRow) => {
      if (row.status === "not_applicable" || row.status === "not_assigned") return;
      const key = folderRowKey(row.profileId, row.eventId);
      if (rowHasDraft(row, drafts)) return;
      setPendingReturnKey(key);
      setActionError(null);
      try {
        const response = await updateMusicFolderReturnStatus(
          row.profileId,
          row.eventId,
          !row.folderReturned,
          row.updatedAt,
        );
        replaceDetailRow(response.row);
        await refreshReport();
      } catch (error: unknown) {
        setActionError(
          error instanceof Error
            ? error.message
            : "The folder return status could not be updated. Refresh and try again.",
        );
      } finally {
        setPendingReturnKey(null);
      }
    },
    [drafts, refreshReport, replaceDetailRow],
  );

  const downloadCsv = useCallback(async () => {
    if (selectedEventIds.length === 0) return;
    setActionError(null);
    try {
      const blob = await exportMusicFolderReport(selectedEventIds);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = "music_folder_report.csv";
      link.href = url;
      link.click();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 0);
    } catch (error: unknown) {
      setActionError(
        error instanceof Error ? error.message : "The CSV export could not be created.",
      );
    }
  }, [selectedEventIds]);

  return {
    actionError,
    confirm,
    confirmationDialog,
    changeSelection,
    clearSelection,
    detail,
    detailState,
    discardChanges,
    drafts,
    downloadCsv,
    expandedProfileId,
    hasUnsavedDrafts: hasUnsaved,
    markReturned,
    pendingReturnKey,
    query,
    queryState,
    report,
    rowErrors,
    saveChanges,
    selectAll,
    selectedEventIds,
    setDraft,
    setExpandedProfileId,
    setQuery,
    setStatusFilter,
    statusFilter,
    togglePerformance,
  };
}

function rowHasDraft(
  row: MusicFolderReportDetailRow,
  drafts: Readonly<Record<string, string>>,
): boolean {
  return Object.prototype.hasOwnProperty.call(drafts, folderRowKey(row.profileId, row.eventId));
}
