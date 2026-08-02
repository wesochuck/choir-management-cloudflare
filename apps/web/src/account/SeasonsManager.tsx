import type {
  DuesRecord,
  OrganizationProfile,
  Season,
  SeasonCreateRequest,
} from "@choir/contracts";
import { DataTable, Dialog } from "@choir/ui";
import { useEffect, useMemo, useState } from "react";

import {
  activateOrganizationSeason,
  AuthApiError,
  createOrganizationSeason,
  deleteOrganizationSeason,
  listOrganizationDues,
  listOrganizationProfiles,
  listOrganizationSeasons,
  refundOrganizationDues,
  updateOrganizationSeason,
} from "../auth/api";

type SeasonState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly seasons: readonly Season[]; readonly status: "ready" };

type DuesState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly dues: readonly DuesRecord[]; readonly status: "ready" };

type ProfilesState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly profiles: readonly OrganizationProfile[]; readonly status: "ready" };

interface SeasonForm {
  readonly duesAmount: string;
  readonly endsAt: string;
  readonly name: string;
  readonly startsAt: string;
}

function dateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${String(year)}-${month}-${day}`;
}

function emptySeasonForm(): SeasonForm {
  const startsAt = new Date();
  const endsAt = new Date(startsAt);
  endsAt.setFullYear(endsAt.getFullYear() + 1);
  return {
    duesAmount: "0.00",
    endsAt: dateInputValue(endsAt),
    name: "",
    startsAt: dateInputValue(startsAt),
  };
}

function money(cents: number): string {
  return new Intl.NumberFormat(undefined, { currency: "USD", style: "currency" }).format(
    cents / 100,
  );
}

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

function seasonPayload(form: SeasonForm): SeasonCreateRequest {
  const amount = Number(form.duesAmount);
  return {
    duesAmountCents: Math.round(amount * 100),
    endsAt: new Date(`${form.endsAt}T23:59:59.000Z`).toISOString(),
    name: form.name.trim(),
    startsAt: new Date(`${form.startsAt}T00:00:00.000Z`).toISOString(),
  };
}

function seasonFormFor(season: Season | null): SeasonForm {
  return season
    ? {
        duesAmount: (season.duesAmountCents / 100).toFixed(2),
        endsAt: dateOnly(season.endsAt),
        name: season.name,
        startsAt: dateOnly(season.startsAt),
      }
    : emptySeasonForm();
}

function apiError(error: unknown, fallback: string): string {
  return error instanceof AuthApiError ? error.message : fallback;
}

function defaultDuesSeasonId(seasons: readonly Season[]): string | null {
  const active = seasons.find((season) => season.isActive);
  if (active) return active.id;
  return (
    seasons.reduce<Season | null>(
      (latest, season) =>
        !latest || season.startsAt.localeCompare(latest.startsAt) > 0 ? season : latest,
      null,
    )?.id ?? null
  );
}

// eslint-disable-next-line complexity -- this coordinator owns the two related season and dues workflows.
export function SeasonsManager({
  enabled,
  onOpenProfile,
}: {
  readonly enabled: boolean;
  readonly onOpenProfile: (profileId: string) => void;
}) {
  const [seasonState, setSeasonState] = useState<SeasonState>({ status: "loading" });
  const [duesState, setDuesState] = useState<DuesState>({ status: "loading" });
  const [profilesState, setProfilesState] = useState<ProfilesState>({ status: "loading" });
  const [confirmSeason, setConfirmSeason] = useState<Season | null>(null);
  const [editingSeason, setEditingSeason] = useState<Season | null>(null);
  const [seasonDialogOpen, setSeasonDialogOpen] = useState(false);
  const [seasonForm, setSeasonForm] = useState<SeasonForm>(emptySeasonForm);
  const [refundId, setRefundId] = useState<string | null>(null);
  const [seasonBusy, setSeasonBusy] = useState(false);
  const [refundBusy, setRefundBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<"settings" | "dues">("dues");
  const [selectedDuesSeasonId, setSelectedDuesSeasonId] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    listOrganizationSeasons(controller.signal)
      .then((seasons) => {
        setSeasonState({ seasons, status: "ready" });
      })
      .catch((loadError: unknown) => {
        if (!(loadError instanceof DOMException && loadError.name === "AbortError")) {
          setSeasonState({ status: "error" });
        }
      });
    listOrganizationDues(controller.signal)
      .then((dues) => {
        setDuesState({ dues, status: "ready" });
      })
      .catch((loadError: unknown) => {
        if (!(loadError instanceof DOMException && loadError.name === "AbortError")) {
          setDuesState({ status: "error" });
        }
      });
    listOrganizationProfiles(controller.signal)
      .then((profiles) => {
        setProfilesState({ profiles, status: "ready" });
      })
      .catch((loadError: unknown) => {
        if (!(loadError instanceof DOMException && loadError.name === "AbortError")) {
          setProfilesState({ status: "error" });
        }
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  const profilesById = useMemo(
    () =>
      new Map(
        profilesState.status === "ready"
          ? profilesState.profiles.map((profile) => [profile.id, profile] as const)
          : [],
      ),
    [profilesState],
  );

  function openSeasonDialog(season: Season | null = null) {
    setError(null);
    setMessage(null);
    setEditingSeason(season);
    setSeasonForm(seasonFormFor(season));
    setSeasonDialogOpen(true);
  }

  async function saveSeason() {
    const amount = Number(seasonForm.duesAmount);
    if (!seasonForm.name.trim()) {
      setError("Enter a season name.");
      return;
    }
    if (!seasonForm.startsAt || !seasonForm.endsAt || seasonForm.endsAt < seasonForm.startsAt) {
      setError("The end date must be on or after the start date.");
      return;
    }
    if (!seasonForm.duesAmount.trim() || !Number.isFinite(amount) || amount < 0) {
      setError("Enter a valid dues amount.");
      return;
    }
    setSeasonBusy(true);
    setError(null);
    try {
      const payload = seasonPayload(seasonForm);
      const saved = editingSeason
        ? await updateOrganizationSeason(editingSeason.id, payload)
        : await createOrganizationSeason(payload);
      setSeasonState((current) => {
        if (current.status !== "ready") return current;
        const seasons = editingSeason
          ? current.seasons.map((season) => (season.id === saved.id ? saved : season))
          : [saved, ...current.seasons];
        return { seasons, status: "ready" };
      });
      setSeasonDialogOpen(false);
      setMessage(editingSeason ? "Season updated." : "Season created.");
    } catch (saveError: unknown) {
      setError(apiError(saveError, "The season could not be saved."));
    } finally {
      setSeasonBusy(false);
    }
  }

  async function activateSeason(season: Season) {
    setSeasonBusy(true);
    setError(null);
    try {
      const activated = await activateOrganizationSeason(season.id);
      setSeasonState((current) =>
        current.status === "ready"
          ? {
              seasons: current.seasons.map((candidate) =>
                candidate.id === activated.id ? activated : { ...candidate, isActive: false },
              ),
              status: "ready",
            }
          : current,
      );
      setSelectedDuesSeasonId(activated.id);
      setMessage(`${season.name} is now active.`);
    } catch (activateError: unknown) {
      setError(apiError(activateError, "The season could not be activated."));
    } finally {
      setSeasonBusy(false);
    }
  }

  async function removeSeason() {
    if (!confirmSeason) return;
    setSeasonBusy(true);
    setError(null);
    try {
      await deleteOrganizationSeason(confirmSeason.id);
      setSeasonState((current) =>
        current.status === "ready"
          ? {
              seasons: current.seasons.filter((season) => season.id !== confirmSeason.id),
              status: "ready",
            }
          : current,
      );
      setSelectedDuesSeasonId((selectedId) =>
        selectedId === confirmSeason.id ? null : selectedId,
      );
      setConfirmSeason(null);
      setMessage("Season deleted.");
    } catch (deleteError: unknown) {
      setError(apiError(deleteError, "The season could not be deleted."));
    } finally {
      setSeasonBusy(false);
    }
  }

  async function refund(duesId: string) {
    setRefundBusy(true);
    setError(null);
    try {
      const refunded = await refundOrganizationDues(duesId);
      setDuesState((current) =>
        current.status === "ready"
          ? {
              dues: current.dues.map((dues) => (dues.id === refunded.id ? refunded : dues)),
              status: "ready",
            }
          : current,
      );
      setRefundId(null);
      setMessage("Dues refunded.");
    } catch (refundError: unknown) {
      setError(apiError(refundError, "The dues could not be refunded."));
    } finally {
      setRefundBusy(false);
    }
  }

  if (!enabled) return null;
  const duesSeasonId =
    selectedDuesSeasonId ??
    (seasonState.status === "ready" ? defaultDuesSeasonId(seasonState.seasons) : null);
  return (
    <>
      <section className="panel" aria-label="Season and dues management">
        {error && !seasonDialogOpen && !confirmSeason ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="notice notice--success" role="status">
            {message}
          </p>
        ) : null}
        <div className="seasons-manager-controls">
          <nav
            aria-label="Seasons and dues views"
            className="ticketing-tabs seasons-manager-tabs"
            role="tablist"
          >
            <button
              aria-controls="dues-records-panel"
              aria-selected={tab === "dues"}
              className={tab === "dues" ? "is-active" : undefined}
              id="dues-records-tab"
              onClick={() => {
                setTab("dues");
              }}
              role="tab"
              type="button"
            >
              Dues records
            </button>
            <button
              aria-controls="season-settings-panel"
              aria-selected={tab === "settings"}
              className={tab === "settings" ? "is-active" : undefined}
              id="season-settings-tab"
              onClick={() => {
                setTab("settings");
              }}
              role="tab"
              type="button"
            >
              Settings
            </button>
          </nav>
          {tab === "settings" ? (
            <button
              className="button button--primary"
              onClick={() => {
                openSeasonDialog();
              }}
              type="button"
            >
              Add season
            </button>
          ) : null}
        </div>
        {tab === "settings" ? (
          <div aria-labelledby="season-settings-tab" id="season-settings-panel" role="tabpanel">
            <SeasonsTab
              onActivate={(season) => void activateSeason(season)}
              onDelete={(season) => {
                setError(null);
                setMessage(null);
                setConfirmSeason(season);
              }}
              onEdit={openSeasonDialog}
              seasonState={seasonState}
              busy={seasonBusy}
            />
          </div>
        ) : (
          <div aria-labelledby="dues-records-tab" id="dues-records-panel" role="tabpanel">
            <DuesTab
              busy={refundBusy}
              duesState={duesState}
              onOpenProfile={onOpenProfile}
              onSeasonFilterChange={setSelectedDuesSeasonId}
              profilesById={profilesById}
              refund={refund}
              refundId={refundId}
              seasonFilterId={duesSeasonId}
              seasonState={seasonState}
              setRefundId={setRefundId}
            />
          </div>
        )}
      </section>

      <Dialog
        description="Set the dates and dues amount for this choir season. Overlapping seasons are not allowed."
        onClose={() => {
          if (!seasonBusy) {
            setError(null);
            setSeasonDialogOpen(false);
          }
        }}
        open={seasonDialogOpen}
        title={editingSeason ? "Edit season" : "Create season"}
      >
        <form
          className="form-stack"
          autoComplete="off"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void saveSeason();
          }}
        >
          {error ? (
            <p className="notice notice--error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="field">
            <label htmlFor="season-name">Name</label>
            <input
              autoFocus
              id="season-name"
              maxLength={200}
              onChange={(event) => {
                setSeasonForm((current) => ({ ...current, name: event.target.value }));
              }}
              required
              value={seasonForm.name}
            />
          </div>
          <div className="field">
            <label htmlFor="season-dues-amount">Dues amount</label>
            <input
              id="season-dues-amount"
              min="0"
              onChange={(event) => {
                setSeasonForm((current) => ({ ...current, duesAmount: event.target.value }));
              }}
              required
              step="0.01"
              type="number"
              value={seasonForm.duesAmount}
            />
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="season-starts-at">Start date</label>
              <input
                id="season-starts-at"
                onChange={(event) => {
                  setSeasonForm((current) => ({ ...current, startsAt: event.target.value }));
                }}
                required
                type="date"
                value={seasonForm.startsAt}
              />
            </div>
            <div className="field">
              <label htmlFor="season-ends-at">End date</label>
              <input
                id="season-ends-at"
                onChange={(event) => {
                  setSeasonForm((current) => ({ ...current, endsAt: event.target.value }));
                }}
                required
                type="date"
                value={seasonForm.endsAt}
              />
            </div>
          </div>
          <div className="dialog__actions">
            <button
              className="button button--secondary"
              disabled={seasonBusy}
              onClick={() => {
                setError(null);
                setSeasonDialogOpen(false);
              }}
              type="button"
            >
              Cancel
            </button>
            <button className="button button--primary" disabled={seasonBusy} type="submit">
              {seasonBusy ? "Saving…" : editingSeason ? "Save changes" : "Create season"}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog
        description="A season with dues records cannot be deleted."
        onClose={() => {
          if (!seasonBusy) {
            setError(null);
            setConfirmSeason(null);
          }
        }}
        open={confirmSeason !== null}
        title="Delete season?"
      >
        {error ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : null}
        <p>
          {confirmSeason
            ? `Delete ${confirmSeason.name}? This action cannot be undone.`
            : "Delete this season?"}
        </p>
        <div className="dialog__actions">
          <button
            className="button button--secondary"
            disabled={seasonBusy}
            onClick={() => {
              setError(null);
              setConfirmSeason(null);
            }}
            type="button"
          >
            Cancel
          </button>
          <button
            className="button button--danger"
            disabled={seasonBusy}
            onClick={() => void removeSeason()}
            type="button"
          >
            {seasonBusy ? "Deleting…" : "Delete season"}
          </button>
        </div>
      </Dialog>
    </>
  );
}

function SeasonsTab({
  busy,
  onActivate,
  onDelete,
  onEdit,
  seasonState,
}: {
  readonly busy: boolean;
  readonly onActivate: (season: Season) => void;
  readonly onDelete: (season: Season) => void;
  readonly onEdit: (season: Season) => void;
  readonly seasonState: SeasonState;
}) {
  if (seasonState.status === "loading") return <p>Loading seasons…</p>;
  if (seasonState.status === "error")
    return <p className="notice notice--error">Seasons could not be loaded.</p>;
  if (seasonState.seasons.length === 0) return <p>No seasons yet. Add one to get started.</p>;
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
          render: (season) => new Date(season.startsAt).toLocaleDateString(),
          sortValue: (season) => season.startsAt,
        },
        {
          header: "Ends",
          id: "endsAt",
          render: (season) => new Date(season.endsAt).toLocaleDateString(),
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

function DuesTab({
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
  if (duesState.status === "loading") return <p>Loading dues records…</p>;
  if (duesState.status === "error")
    return <p className="notice notice--error">Dues records could not be loaded.</p>;
  const seasons = seasonState.status === "ready" ? seasonState.seasons : [];
  const seasonsById = new Map(seasons.map((season) => [season.id, season] as const));
  const filteredDues = seasonFilterId
    ? duesState.dues.filter((record) => record.seasonId === seasonFilterId)
    : duesState.dues;
  const profileName = (record: DuesRecord): string =>
    profilesById.get(record.profileId)?.displayName ?? "Profile unavailable";
  const seasonName = (record: DuesRecord): string =>
    seasonsById.get(record.seasonId)?.name ?? "Season unavailable";
  const openProfile = (record: DuesRecord) => {
    if (profilesById.has(record.profileId)) onOpenProfile(record.profileId);
  };
  return (
    <>
      <div className="dues-records-toolbar">
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
      {duesState.dues.length === 0 ? <p>No dues records yet.</p> : null}
      {duesState.dues.length > 0 && filteredDues.length === 0 ? (
        <p>No dues records for the selected season.</p>
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
