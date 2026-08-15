import type { Season } from "@choir/contracts";
import { useEffect, useMemo, useState } from "react";

import {
  activateOrganizationSeason,
  createOrganizationSeason,
  deleteOrganizationSeason,
  getOrganizationCalendarSettings,
  listOrganizationDues,
  listOrganizationProfiles,
  listOrganizationSeasons,
  refundOrganizationDues,
  updateOrganizationSeason,
} from "../auth/api";
import { DeleteSeasonDialog } from "./components/SeasonsManager/DeleteSeasonDialog";
import { DuesTab } from "./components/SeasonsManager/DuesTab";
import { SeasonDialog } from "./components/SeasonsManager/SeasonDialog";
import { SeasonsTab } from "./components/SeasonsManager/SeasonsTab";
import {
  apiError,
  defaultDuesSeasonId,
  emptySeasonForm,
  seasonFormFor,
  seasonPayload,
  type DuesState,
  type ProfilesState,
  type SeasonForm,
  type SeasonState,
} from "./components/SeasonsManager/types";

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
  const [seasonForm, setSeasonForm] = useState<SeasonForm>(() => emptySeasonForm("UTC"));
  const [refundId, setRefundId] = useState<string | null>(null);
  const [seasonBusy, setSeasonBusy] = useState(false);
  const [refundBusy, setRefundBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<"settings" | "dues">("dues");
  const [selectedDuesSeasonId, setSelectedDuesSeasonId] = useState<string | null>(null);
  const [timezone, setTimezone] = useState("UTC");

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    getOrganizationCalendarSettings(controller.signal)
      .then(({ timezone: nextTimezone }) => {
        setTimezone(nextTimezone);
      })
      .catch(() => {
        // Keep UTC as a safe fallback while the rest of the manager loads.
      });
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
    setSeasonForm(seasonFormFor(season, timezone));
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
      const payload = seasonPayload(seasonForm, timezone);
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
            <p className="seasons-manager-description seasons-manager-description--settings">
              Create seasons, set dues amounts, and choose which season is active.
            </p>
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
              timezone={timezone}
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

      <SeasonDialog
        editingSeason={editingSeason}
        error={error}
        onClose={() => {
          if (!seasonBusy) {
            setError(null);
            setSeasonDialogOpen(false);
          }
        }}
        open={seasonDialogOpen}
        saveSeason={saveSeason}
        seasonBusy={seasonBusy}
        seasonForm={seasonForm}
        setSeasonForm={setSeasonForm}
      />

      <DeleteSeasonDialog
        confirmSeason={confirmSeason}
        error={error}
        onClose={() => {
          if (!seasonBusy) {
            setError(null);
            setConfirmSeason(null);
          }
        }}
        open={confirmSeason !== null}
        removeSeason={removeSeason}
        seasonBusy={seasonBusy}
      />
    </>
  );
}
