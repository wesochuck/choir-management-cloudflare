import type { OrganizationMusicPiece, OrganizationRosterConfiguration } from "@choir/contracts";
import { DataTable, type DataTableColumn } from "@choir/ui";
import { useMemo } from "react";
import {
  statusClass,
  voicePartLabel,
  type ReviewQueueRow,
  type ReviewState,
} from "./reviewSelectors";
import { getReviewStatusLabel } from "./reviewState";
import type { GroupReviewItem } from "./types";

function OverviewSongCell({ row }: { readonly row: ReviewQueueRow }) {
  const { group, ordinal } = row;
  return (
    <div className="track-import-overview-song">
      <strong>{group.inferredTitle}</strong>
      <span>
        Song {String(ordinal)} · {String(group.files.length)}{" "}
        {group.files.length === 1 ? "file" : "files"}
      </span>
      <small>{group.files.map((file) => file.fileName).join(" · ")}</small>
    </div>
  );
}

function OverviewDestinationCell({
  piece,
}: {
  readonly piece: OrganizationMusicPiece | undefined;
}) {
  if (!piece) return <span>No destination selected</span>;
  return (
    <span>
      {piece.title}
      <small className="track-import-overview-subtext">
        {[piece.composer, piece.arranger ? `arr. ${piece.arranger}` : ""]
          .filter(Boolean)
          .join(" · ")}
      </small>
    </span>
  );
}

function OverviewVoicePartsCell({
  group,
  roster,
}: {
  readonly group: GroupReviewItem;
  readonly roster: OrganizationRosterConfiguration | null;
}) {
  if (group.groupSkipped) return <span>Entire group skipped</span>;
  return (
    <span>
      {group.files
        .map((file) =>
          file.excluded
            ? `${voicePartLabel(file.partKey, roster)} (excluded)`
            : voicePartLabel(file.partKey, roster),
        )
        .join(", ")}
    </span>
  );
}

function OverviewStatusCell({
  hasDestination,
  group,
  state,
}: {
  readonly hasDestination: boolean;
  readonly group: GroupReviewItem;
  readonly state: ReviewState;
}) {
  return (
    <span>
      <span className={statusClass(state.groupStatus)}>
        {getReviewStatusLabel(state, hasDestination)}
      </span>
      {state.blockingConflictCount > 0 ? (
        <small className="track-import-overview-subtext">
          {String(state.blockingConflictCount)} conflict
          {state.blockingConflictCount === 1 ? "" : "s"}
        </small>
      ) : null}
      {state.excludedFileCount > 0 && state.groupStatus !== "skipped" ? (
        <small className="track-import-overview-subtext">
          {String(state.excludedFileCount)} excluded file{state.excludedFileCount === 1 ? "" : "s"}
        </small>
      ) : null}
      <span className="sr-only">{group.inferredTitle}</span>
    </span>
  );
}

function buildOverviewColumns(
  pieceMap: ReadonlyMap<string, OrganizationMusicPiece>,
  roster: OrganizationRosterConfiguration | null,
  onReview: (groupId: string) => void,
): readonly DataTableColumn<ReviewQueueRow>[] {
  return [
    {
      header: "Song group",
      id: "song",
      mobileLabel: "Song group",
      render: (row) => <OverviewSongCell row={row} />,
      sortValue: ({ group }) => group.inferredTitle,
    },
    {
      align: "center",
      header: "Files",
      id: "files",
      mobileLabel: "Files",
      render: ({ group }) => String(group.files.length),
      sortValue: ({ group }) => group.files.length,
    },
    {
      header: "Destination",
      id: "destination",
      mobileLabel: "Destination",
      render: ({ group }) => (
        <OverviewDestinationCell piece={pieceMap.get(group.selectedPieceId ?? "")} />
      ),
      sortValue: ({ group }) => pieceMap.get(group.selectedPieceId ?? "")?.title,
    },
    {
      header: "Voice parts",
      id: "parts",
      mobileLabel: "Voice parts",
      render: ({ group }) => <OverviewVoicePartsCell group={group} roster={roster} />,
      sortValue: ({ voicePartSortKey }) => voicePartSortKey,
    },
    {
      header: "Review status",
      id: "status",
      mobileLabel: "Review status",
      render: ({ group, state }) => (
        <OverviewStatusCell
          group={group}
          state={state}
          hasDestination={pieceMap.has(group.selectedPieceId ?? "")}
        />
      ),
      sortValue: ({ state }) =>
        ({ conflict: 0, needs_review: 1, reviewed: 2, skipped: 3 })[state.groupStatus],
    },
    {
      header: "Review",
      id: "actions",
      mobileLabel: "Review",
      render: ({ group }) => (
        <button
          className="button button--secondary"
          type="button"
          onClick={() => {
            onReview(group.groupId);
          }}
        >
          Review
        </button>
      ),
    },
  ];
}

export function BatchOverview({
  onReviewGroup,
  pieceMap,
  roster,
  rows,
}: {
  readonly onReviewGroup: (groupId: string) => void;
  readonly pieceMap: ReadonlyMap<string, OrganizationMusicPiece>;
  readonly roster: OrganizationRosterConfiguration | null;
  readonly rows: readonly ReviewQueueRow[];
}) {
  const columns = useMemo(
    () => buildOverviewColumns(pieceMap, roster, onReviewGroup),
    [onReviewGroup, pieceMap, roster],
  );
  return (
    <section aria-label="Batch overview" className="track-import-review-overview">
      <h2>Every song group in this import</h2>
      <p>
        Review destinations, file counts, voice parts, and outstanding conflicts across the batch.
      </p>
      <DataTable
        columns={columns}
        emptyMessage="No song groups are available."
        keySelector={(row) => row.group.groupId}
        rows={rows}
      />
    </section>
  );
}
