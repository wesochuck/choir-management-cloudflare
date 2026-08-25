import { type OrganizationMusicPiece } from "@choir/contracts";
import { useState } from "react";
import { DataTable } from "@choir/ui";
import { Status } from "./shared";
import { downloadCsv, formatDate } from "./reportHelpers";
export function RepertoireReport({
  pieces,
}: {
  readonly pieces: readonly OrganizationMusicPiece[];
}) {
  const [query, setQuery] = useState("");
  const filtered = pieces.filter((piece) =>
    `${piece.title} ${piece.composer} ${piece.arranger}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <>
      <div className="reports-toolbar">
        <label className="field reports-search">
          <span>Search repertoire</span>
          <input
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Title, composer, or arranger"
            value={query}
          />
        </label>
        <button
          className="button button--secondary"
          disabled={!filtered.length}
          onClick={() => {
            downloadCsv("repertoire-report.csv", [
              ["Title", "Composer", "Arranger", "Performances", "Last performed"],
              ...filtered.map((piece) => [
                piece.title,
                piece.composer || "",
                piece.arranger || "",
                piece.performanceCount,
                formatDate(piece.lastPerformedAt),
              ]),
            ]);
          }}
          type="button"
        >
          Export CSV
        </button>
      </div>
      {filtered.length === 0 ? (
        <Status
          state="ready"
          empty={pieces.length ? "No pieces match this search." : "No music pieces are available."}
        />
      ) : (
        <DataTable
          columns={[
            {
              header: "Title",
              id: "title",
              render: (piece) => <strong>{piece.title}</strong>,
              sortValue: (piece) => piece.title,
            },
            {
              header: "Composer / arranger",
              id: "composer",
              render: (piece) =>
                [piece.composer, piece.arranger].filter(Boolean).join(" / ") || "—",
              sortValue: (piece) => `${piece.composer} ${piece.arranger}`,
            },
            {
              header: "Performances",
              id: "performances",
              render: (piece) => piece.performanceCount,
              sortValue: (piece) => piece.performanceCount,
            },
            {
              header: "Last performed",
              id: "lastPerformed",
              render: (piece) => formatDate(piece.lastPerformedAt),
              sortValue: (piece) => piece.lastPerformedAt,
            },
            {
              header: "Duration",
              id: "duration",
              render: (piece) =>
                piece.durationSeconds === null
                  ? "—"
                  : `${String(Math.floor(piece.durationSeconds / 60))}:${String(piece.durationSeconds % 60).padStart(2, "0")}`,
              sortValue: (piece) => piece.durationSeconds,
            },
          ]}
          initialSort={{ columnId: "title", direction: "asc" }}
          keySelector={(piece) => piece.id}
          rows={filtered}
        />
      )}
    </>
  );
}
