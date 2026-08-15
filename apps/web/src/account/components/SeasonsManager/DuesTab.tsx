import type { DuesRecord, OrganizationProfile } from "@choir/contracts";
import { DataTable } from "@choir/ui";
import { useState } from "react";

import { money, type DuesState, type SeasonState } from "./types";

export function DuesTab({
  busy,
  duesState,
  onOpenProfile,
  onSeasonFilterChange,
  profilesById,
  refund,
  refundId,
  seasonFilterId,
  seasonState,
  setRefundId,
}: {
  readonly busy: boolean;
  readonly duesState: DuesState;
  readonly onOpenProfile: (profileId: string) => void;
  readonly onSeasonFilterChange: (seasonId: string | null) => void;
  readonly profilesById: ReadonlyMap<string, OrganizationProfile>;
  readonly refund: (id: string) => Promise<void>;
  readonly refundId: string | null;
  readonly seasonFilterId: string | null;
  readonly seasonState: SeasonState;
  readonly setRefundId: (id: string | null) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  if (duesState.status === "loading") return <p>Loading dues records…</p>;
  if (duesState.status === "error")
    return <p className="notice notice--error">Dues records could not be loaded.</p>;
  const seasons = seasonState.status === "ready" ? seasonState.seasons : [];
  const seasonsById = new Map(seasons.map((season) => [season.id, season] as const));
  const profileName = (record: DuesRecord): string =>
    profilesById.get(record.profileId)?.displayName ?? "Profile unavailable";
  const seasonName = (record: DuesRecord): string =>
    seasonsById.get(record.seasonId)?.name ?? "Season unavailable";
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredDues = duesState.dues.filter((record) => {
    if (seasonFilterId && record.seasonId !== seasonFilterId) return false;
    if (!normalizedSearchQuery) return true;
    return [profileName(record), seasonName(record), record.status].some((value) =>
      value.toLocaleLowerCase().includes(normalizedSearchQuery),
    );
  });
  const hasSearchQuery = normalizedSearchQuery.length > 0;
  const openProfile = (record: DuesRecord) => {
    if (profilesById.has(record.profileId)) onOpenProfile(record.profileId);
  };
  return (
    <>
      <div className="dues-records-header">
        <p className="seasons-manager-description">
          Review dues payment status for members, filter by season, or search by name.
        </p>
        <div className="dues-records-toolbar">
          <label className="field">
            Search records
            <input
              onChange={(event) => {
                setSearchQuery(event.target.value);
              }}
              placeholder="Search names, seasons, or status…"
              type="search"
              value={searchQuery}
            />
          </label>
          <label className="field">
            Season
            <select
              disabled={seasonState.status !== "ready" || seasons.length === 0}
              value={seasonFilterId ?? ""}
              onChange={(event) => {
                onSeasonFilterChange(event.target.value || "");
              }}
            >
              {seasons.length > 0 ? null : <option value="">All seasons</option>}
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name}
                  {season.isActive ? " (Active)" : ""}
                </option>
              ))}
              {seasons.length > 0 ? <option value="">All seasons</option> : null}
            </select>
          </label>
        </div>
      </div>
      {duesState.dues.length === 0 ? <p>No dues records yet.</p> : null}
      {duesState.dues.length > 0 && filteredDues.length === 0 ? (
        <p>
          {hasSearchQuery
            ? seasonFilterId
              ? "No dues records match the selected season and search."
              : "No dues records match your search."
            : "No dues records for the selected season."}
        </p>
      ) : null}
      {filteredDues.length > 0 ? (
        <DataTable
          columns={[
            {
              header: "Profile",
              id: "profile",
              render: (record) => profileName(record),
              sortValue: (record) => profileName(record),
            },
            {
              header: "Season",
              id: "season",
              render: (record) => seasonName(record),
              sortValue: (record) => seasonName(record),
            },
            {
              header: "Amount",
              id: "amount",
              render: (record) => money(record.amountCents),
              sortValue: (record) => record.amountCents,
            },
            {
              header: "Processing fee",
              id: "fee",
              render: (record) => (record.feeCents > 0 ? money(record.feeCents) : "Covered"),
              sortValue: (record) => record.feeCents,
            },
            {
              header: "Status",
              id: "status",
              render: (record) => record.status,
              sortValue: (record) => record.status,
            },
            {
              header: "Paid at",
              id: "paidAt",
              render: (record) =>
                record.paidAt ? new Date(record.paidAt).toLocaleDateString() : "—",
              sortValue: (record) => record.paidAt,
            },
            {
              header: "Action",
              id: "action",
              render: (record) =>
                refundId === record.id ? (
                  <div className="danger-confirmation">
                    <p>Refund this dues record?</p>
                    <div className="form-actions">
                      <button
                        className="button button--secondary"
                        disabled={busy}
                        onClick={() => {
                          setRefundId(null);
                        }}
                        type="button"
                      >
                        Cancel
                      </button>
                      <button
                        className="button button--danger"
                        disabled={busy}
                        onClick={() => void refund(record.id)}
                        type="button"
                      >
                        {busy ? "Refunding…" : "Confirm refund"}
                      </button>
                    </div>
                  </div>
                ) : record.status === "paid" ? (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      setRefundId(record.id);
                    }}
                    type="button"
                  >
                    Refund
                  </button>
                ) : null,
            },
          ]}
          emptyMessage="No dues records yet."
          initialSort={{ columnId: "paidAt", direction: "desc" }}
          keySelector={(record) => record.id}
          onRowClick={openProfile}
          rowLabel={(record) => `Open dues for ${profileName(record)}`}
          rows={filteredDues}
        />
      ) : null}
    </>
  );
}
