import type {
  MusicFolderReportDetailRow,
  MusicFolderReportPerformanceOption,
  MusicFolderReportSummary,
} from "@choir/contracts";
import { lastNameSortKey } from "@choir/domain";
import { useEffect, useState } from "react";

import { DataTable, type DataTablePresentation } from "@choir/ui";

import { OrganizationMfaPrompt } from "../../OrganizationMfaPrompt";
import { useMusicFolderReportController } from "./controller";
import {
  filterMusicFolderSummaries,
  folderRowKey,
  formatMusicFolderDate,
  musicFolderStatusClass,
  musicFolderStatusLabel,
  parseMusicFolderSummaryFilter,
} from "./model";

function profileStatusLabel(status: MusicFolderReportSummary["globalStatus"]): string {
  return status === "Idle" ? "On Break" : status;
}

function performanceState(option: MusicFolderReportPerformanceOption): string {
  if (option.isCanceled && option.isArchived) return "Canceled · Archived";
  if (option.isCanceled) return "Canceled";
  if (option.isArchived) return "Archived";
  return "";
}

function PerformancePicker({
  options,
  selectedEventIds,
  onClear,
  onSelectAll,
  onToggle,
}: {
  readonly onClear: () => void;
  readonly onSelectAll: () => void;
  readonly onToggle: (eventId: string) => void;
  readonly options: readonly MusicFolderReportPerformanceOption[];
  readonly selectedEventIds: readonly string[];
}) {
  const [search, setSearch] = useState("");
  const selected = new Set(selectedEventIds);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredOptions = options.filter((option) =>
    `${option.title} ${option.startsAt} ${performanceState(option)}`
      .toLocaleLowerCase()
      .includes(normalizedSearch),
  );
  const summary =
    selectedEventIds.length === 0
      ? "Choose Performances"
      : `${String(selectedEventIds.length)} Performance${selectedEventIds.length === 1 ? "" : "s"} selected`;
  return (
    <details className="music-folder-report__picker">
      <summary>
        <span>{summary}</span>
        <span aria-hidden="true" className="music-folder-report__picker-chevron">
          ⌃
        </span>
      </summary>
      <div className="music-folder-report__picker-panel">
        <label className="field">
          <span>Search Performances</span>
          <input
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            placeholder="Title or date"
            value={search}
          />
        </label>
        <div className="music-folder-report__picker-actions">
          <button
            className="button button--small button--secondary"
            disabled={selectedEventIds.length === options.length}
            onClick={onSelectAll}
            type="button"
          >
            Select all
          </button>
          <button
            className="button button--small button--secondary"
            disabled={selectedEventIds.length === 0}
            onClick={onClear}
            type="button"
          >
            Clear all
          </button>
        </div>
        {options.length === 0 ? (
          <p className="empty-state">No Performances are available.</p>
        ) : filteredOptions.length === 0 ? (
          <p className="empty-state">No Performances match this search.</p>
        ) : (
          <div className="music-folder-report__performance-list">
            {filteredOptions.map((option) => {
              const state = performanceState(option);
              return (
                <label className="music-folder-report__performance-option" key={option.id}>
                  <input
                    checked={selected.has(option.id)}
                    onChange={() => {
                      onToggle(option.id);
                    }}
                    type="checkbox"
                  />
                  <span>
                    <strong>{option.title}</strong>
                    <span className="music-folder-report__performance-meta">
                      {formatMusicFolderDate(option.startsAt, true)}
                      {state ? ` · ${state}` : ""}
                      {option.assignedFolderCount === 0
                        ? " · No assigned folder"
                        : ` · ${String(option.assignedFolderCount)} assigned`}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </details>
  );
}

function SummaryTable({
  controller,
  summaries,
}: {
  readonly controller: ReturnType<typeof useMusicFolderReportController>;
  readonly summaries: readonly MusicFolderReportSummary[];
}) {
  return (
    <DataTable
      columns={[
        {
          header: "Profile",
          id: "profile",
          render: (row) => (
            <>
              <strong>{row.displayName}</strong>
              <small className="music-folder-report__secondary-line">
                {profileStatusLabel(row.globalStatus)}
              </small>
            </>
          ),
          sortValue: (row) => lastNameSortKey(row.displayName),
        },
        {
          header: "Assigned",
          id: "assigned",
          render: (row) => row.assigned,
          sortValue: (row) => row.assigned,
        },
        {
          header: "Returned",
          id: "returned",
          render: (row) => row.returned,
          sortValue: (row) => row.returned,
        },
        {
          header: "Outstanding",
          id: "outstanding",
          render: (row) => row.outstanding,
          sortValue: (row) => row.outstanding,
        },
        {
          header: "Not Assigned",
          id: "notAssigned",
          render: (row) => row.notAssigned,
          sortValue: (row) => row.notAssigned,
        },
        {
          header: "Return Rate",
          id: "returnRate",
          render: (row) => `${(row.returnRate * 100).toFixed(1)}%`,
          sortValue: (row) => row.returnRate,
        },
        {
          header: "Details",
          id: "actions",
          render: (row, context) => {
            const expanded = controller.expandedProfileId === row.profileId;
            return (
              <button
                aria-controls={musicFolderDetailPanelId(row.profileId, context.presentation)}
                aria-expanded={expanded}
                aria-label={`${expanded ? "Collapse" : "Expand"} ${row.displayName}`}
                className="music-folder-report__expand-button"
                onClick={() => {
                  controller.setExpandedProfileId(expanded ? null : row.profileId);
                }}
                type="button"
              >
                <span aria-hidden="true" className="music-folder-report__expand-chevron">
                  ⌃
                </span>
              </button>
            );
          },
        },
      ]}
      emptyMessage="No Profiles match the current filters."
      expandedRowId={controller.expandedProfileId}
      initialSort={{ columnId: "profile", direction: "asc" }}
      keySelector={(row) => row.profileId}
      renderExpandedRow={(row, presentation) => (
        <div id={musicFolderDetailPanelId(row.profileId, presentation)}>
          <ExpandedDetail controller={controller} presentation={presentation} />
        </div>
      )}
      rows={summaries}
    />
  );
}

function musicFolderDetailPanelId(profileId: string, presentation: DataTablePresentation): string {
  return `music-folder-report-detail-${profileId}-${presentation}`;
}

function DetailPanel({
  controller,
  presentation,
}: {
  readonly controller: ReturnType<typeof useMusicFolderReportController>;
  readonly presentation: DataTablePresentation;
}) {
  const detail = controller.detail;
  if (!detail) return null;
  const currentDraft = (row: MusicFolderReportDetailRow): string =>
    controller.drafts[folderRowKey(row.profileId, row.eventId)] ?? row.folderNumber;
  const requestClear = (row: MusicFolderReportDetailRow, value: string): void => {
    const current = currentDraft(row);
    if (current.trim().length > 0 && value.trim().length === 0) {
      void controller
        .confirm({
          confirmLabel: "Clear Folder Number",
          description:
            "This changes the row to Not Assigned and removes it from the return-rate denominator.",
          destructive: true,
          title: "Clear this Folder Number?",
        })
        .then((shouldClear) => {
          if (shouldClear) controller.setDraft(row, "");
        });
      return;
    }
    controller.setDraft(row, value);
  };
  return (
    <section
      aria-labelledby={`music-folder-report-detail-heading-${presentation}`}
      className="music-folder-report__detail music-folder-report__detail--expanded"
    >
      <div className="reports-toolbar">
        <div>
          <h3 id={`music-folder-report-detail-heading-${presentation}`}>{detail.displayName}</h3>
          <p>{profileStatusLabel(detail.globalStatus)} · selected Performance history</p>
        </div>
        {controller.hasUnsavedDrafts ? (
          <div className="music-folder-report__edit-actions">
            <button
              className="button button--secondary"
              disabled={controller.detailState !== "ready"}
              onClick={() => {
                void controller.saveChanges();
              }}
              type="button"
            >
              Save changes
            </button>
            <button
              className="button button--secondary"
              onClick={controller.discardChanges}
              type="button"
            >
              Discard changes
            </button>
          </div>
        ) : null}
      </div>
      {controller.actionError ? (
        <p className="notice notice--error" role="alert">
          {controller.actionError}
        </p>
      ) : null}
      <DataTable
        columns={[
          {
            header: "Performance",
            id: "performance",
            render: (row) => (
              <>
                <strong>{row.eventTitle}</strong>
                <small className="music-folder-report__secondary-line">
                  {formatMusicFolderDate(row.startsAt, true)}
                  {row.isCanceled ? " · Canceled" : ""}
                  {row.isArchived ? " · Archived" : ""}
                </small>
              </>
            ),
            sortValue: (row) => row.startsAt,
          },
          {
            header: "Folder Number",
            id: "folderNumber",
            render: (row) =>
              row.status === "not_applicable" ? (
                "—"
              ) : (
                <label className="music-folder-report__number-field">
                  <span className="sr-only">Folder Number for {row.eventTitle}</span>
                  <input
                    aria-invalid={Boolean(
                      controller.rowErrors[folderRowKey(row.profileId, row.eventId)],
                    )}
                    disabled={
                      controller.pendingReturnKey === folderRowKey(row.profileId, row.eventId)
                    }
                    onChange={(event) => {
                      requestClear(row, event.target.value);
                    }}
                    value={currentDraft(row)}
                  />
                  {controller.rowErrors[folderRowKey(row.profileId, row.eventId)] ? (
                    <small className="music-folder-report__row-error" role="alert">
                      {controller.rowErrors[folderRowKey(row.profileId, row.eventId)]}
                    </small>
                  ) : null}
                </label>
              ),
            sortValue: (row) => row.folderNumber,
          },
          {
            header: "Status",
            id: "status",
            render: (row) => (
              <span className={`music-folder-report__status ${musicFolderStatusClass(row.status)}`}>
                {musicFolderStatusLabel(row.status)}
              </span>
            ),
            sortValue: (row) => row.status,
          },
          {
            header: "Returned At",
            id: "returnedAt",
            render: (row) => formatMusicFolderDate(row.returnedAt, true),
            sortValue: (row) => row.returnedAt,
          },
          {
            header: "Actions",
            id: "actions",
            render: (row) => {
              const key = folderRowKey(row.profileId, row.eventId);
              const draft = Object.prototype.hasOwnProperty.call(controller.drafts, key);
              if (row.status === "not_applicable" || row.status === "not_assigned") return "—";
              return (
                <button
                  className="button button--small button--secondary"
                  disabled={draft || controller.pendingReturnKey === key}
                  onClick={() => {
                    void controller.markReturned(row);
                  }}
                  title={draft ? "Save or discard the Folder Number draft first." : undefined}
                  type="button"
                >
                  {controller.pendingReturnKey === key
                    ? "Saving…"
                    : row.folderReturned
                      ? "Mark outstanding"
                      : "Mark returned"}
                </button>
              );
            },
          },
        ]}
        emptyMessage="No selected Performances are available for this Profile."
        initialSort={{ columnId: "performance", direction: "desc" }}
        keySelector={(row) => row.eventId}
        rows={detail.rows}
      />
    </section>
  );
}

function ExpandedDetail({
  controller,
  presentation,
}: {
  readonly controller: ReturnType<typeof useMusicFolderReportController>;
  readonly presentation: DataTablePresentation;
}) {
  if (controller.detailState === "loading" || !controller.detail) {
    return (
      <p className="empty-state" role="status">
        Loading selected Performance details…
      </p>
    );
  }
  if (controller.detailState === "error") {
    return (
      <p className="notice notice--error" role="alert">
        The Profile details could not be loaded. Try again.
      </p>
    );
  }
  return <DetailPanel controller={controller} presentation={presentation} />;
}

export function MusicFolderReport({
  enabled,
  onUnsavedChange,
}: {
  readonly enabled: boolean;
  readonly onUnsavedChange?: (value: boolean) => void;
}) {
  const controller = useMusicFolderReportController(enabled);
  const report = controller.report;
  useEffect(() => {
    onUnsavedChange?.(controller.hasUnsavedDrafts);
  }, [controller.hasUnsavedDrafts, onUnsavedChange]);
  const summaries = report
    ? filterMusicFolderSummaries(report.summaries, controller.query, controller.statusFilter)
    : [];

  if (!enabled) {
    return <OrganizationMfaPrompt message="Verify Organization MFA to view reports." />;
  }
  if (controller.queryState === "loading" && !report) {
    return <p className="empty-state">Loading Music Folder Report…</p>;
  }
  if (controller.queryState === "error" || !report) {
    return <p className="notice notice--error">The Music Folder Report could not be loaded.</p>;
  }
  return (
    <div className="music-folder-report">
      <div className="reports-toolbar music-folder-report__toolbar">
        <div>
          <h2>Music Folder Report</h2>
          <p>Select one or more Performances to review Folder Number history and returns.</p>
        </div>
        <button
          className="button button--secondary"
          disabled={controller.selectedEventIds.length === 0}
          onClick={() => {
            void controller.downloadCsv();
          }}
          type="button"
        >
          Export CSV
        </button>
      </div>
      <PerformancePicker
        onClear={controller.clearSelection}
        onSelectAll={controller.selectAll}
        onToggle={controller.togglePerformance}
        options={report.performanceOptions}
        selectedEventIds={controller.selectedEventIds}
      />
      {controller.queryState === "loading" ? (
        <p className="empty-state" role="status">
          Updating the selected Performances…
        </p>
      ) : null}
      {controller.actionError && !controller.detail ? (
        <p className="notice notice--error" role="alert">
          {controller.actionError}
        </p>
      ) : null}
      {controller.selectedEventIds.length === 0 ? (
        <p className="empty-state">
          Choose one or more Performances to see who has returned their folders and who is
          outstanding.
        </p>
      ) : (
        <>
          <div className="reports-kpi-grid music-folder-report__kpis" aria-label="Folder summary">
            <div className="reports-kpi">
              <strong>{report.totals.assigned}</strong>
              <span>Assigned</span>
            </div>
            <div className="reports-kpi">
              <strong>{report.totals.returned}</strong>
              <span>Returned</span>
            </div>
            <div className="reports-kpi">
              <strong>{report.totals.outstanding}</strong>
              <span>Outstanding</span>
            </div>
            <div className="reports-kpi">
              <strong>{report.totals.notAssigned}</strong>
              <span>Not Assigned</span>
            </div>
            <div className="reports-kpi">
              <strong>{(report.totals.returnRate * 100).toFixed(1)}%</strong>
              <span>Return Rate</span>
            </div>
          </div>
          {report.summaries.length === 0 ? (
            <p className="empty-state">
              No Profiles in the selected Performances have an assigned Folder Number.
            </p>
          ) : (
            <>
              <div className="music-folder-report__filters">
                <label className="field">
                  <span>Search Profiles</span>
                  <input
                    onChange={(event) => {
                      controller.setQuery(event.target.value);
                    }}
                    placeholder="Profile name"
                    value={controller.query}
                  />
                </label>
                <label className="field">
                  <span>Filter status</span>
                  <select
                    onChange={(event) => {
                      controller.setStatusFilter(parseMusicFolderSummaryFilter(event.target.value));
                    }}
                    value={controller.statusFilter}
                  >
                    <option value="all">All</option>
                    <option value="outstanding">Outstanding</option>
                    <option value="returned">Returned</option>
                    <option value="not-assigned">Not Assigned</option>
                  </select>
                </label>
              </div>
              <SummaryTable controller={controller} summaries={summaries} />
            </>
          )}
        </>
      )}
      {controller.confirmationDialog}
    </div>
  );
}
