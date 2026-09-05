import type { Season } from "@choir/contracts";
import { DataTable } from "@choir/ui";

import { money, seasonDateLabel, type SeasonState } from "./types";

export function SeasonsTab({
  busy,
  onActivate,
  onAddSeason,
  onDelete,
  onEdit,
  seasonState,
  timezone,
}: {
  readonly busy: boolean;
  readonly onActivate: (season: Season) => void;
  readonly onAddSeason?: () => void;
  readonly onDelete: (season: Season) => void;
  readonly onEdit: (season: Season) => void;
  readonly seasonState: SeasonState;
  readonly timezone: string;
}) {
  if (seasonState.status === "loading") return <p>Loading seasons…</p>;
  if (seasonState.status === "error")
    return <p className="notice notice--error">Seasons could not be loaded.</p>;
  if (seasonState.seasons.length === 0) {
    return (
      <div className="empty-state">
        <p>No seasons created yet.</p>
        {onAddSeason ? (
          <button className="button button--primary" onClick={onAddSeason} type="button">
            Create your first season
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <DataTable
      columns={[
        {
          header: "Name",
          id: "name",
          render: (season) => <strong>{season.name}</strong>,
          sortValue: (season) => season.name,
        },
        {
          header: "Starts",
          id: "startsAt",
          render: (season) => seasonDateLabel(season.startsAt, timezone),
          sortValue: (season) => season.startsAt,
        },
        {
          header: "Ends",
          id: "endsAt",
          render: (season) => seasonDateLabel(season.endsAt, timezone),
          sortValue: (season) => season.endsAt,
        },
        {
          header: "Dues amount",
          id: "duesAmount",
          render: (season) => money(season.duesAmountCents),
          sortValue: (season) => season.duesAmountCents,
        },
        {
          header: "Status",
          id: "status",
          render: (season) =>
            season.isActive ? <span className="badge">Active</span> : "Inactive",
          sortValue: (season) => season.isActive,
        },
        {
          header: "Actions",
          id: "actions",
          mobileLabel: "Manage",
          render: (season) => (
            <div className="table-actions">
              {!season.isActive ? (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    onActivate(season);
                  }}
                  type="button"
                >
                  Make active
                </button>
              ) : null}
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  onEdit(season);
                }}
                type="button"
              >
                Edit
              </button>
              <button
                className="text-button text-button--danger"
                disabled={busy}
                onClick={() => {
                  onDelete(season);
                }}
                type="button"
              >
                Delete
              </button>
            </div>
          ),
        },
      ]}
      emptyMessage="No seasons yet. Add one to get started."
      initialSort={{ columnId: "startsAt", direction: "desc" }}
      keySelector={(season) => season.id}
      onRowClick={onEdit}
      rowLabel={(season) => `Edit season ${season.name}`}
      rows={seasonState.seasons}
    />
  );
}
