import { useEffect, useMemo, useState } from "react";
import type {
  AuditionStatus,
  OrganizationEvent,
  OrganizationAudition,
  OrganizationAuditionCreateRequest,
  OrganizationAuditionSettings,
  OrganizationVenue,
} from "@choir/contracts";
import { auditionStatusSchema } from "@choir/contracts";
import {
  convertOrganizationAudition,
  createOrganizationAudition,
  deleteOrganizationAudition,
  generateAuditionTokens,
  getOrganizationCalendarSettings,
  getOrganizationAuditionSettings,
  listOrganizationEvents,
  listOrganizationAuditions,
  listOrganizationMemberships,
  listOrganizationProfiles,
  listOrganizationVenues,
  updateOrganizationAudition,
  updateOrganizationAuditionSettings,
} from "../../../auth/api";
import { QRCodeShareCard } from "../../QRCodeShareCard";
import { useOrganizationTerminology } from "../../organizationTerminologyContext";

import { auditionFollowUpUrl, STATUS_OPTIONS, fallbackSettings } from "./utils";

import { ManagerStatusPanel } from "./shared";

import type { Props, ManagerState, AuditionTab, AdministratorRecipient } from "./types";

import { SettingsForm } from "./settings";

import { AuditionTable, AuditionDialogs } from "./tableAndDialogs";

export function AuditionManager({ enabled }: Props) {
  const { performerLabelPlural } = useOrganizationTerminology();
  const [state, setState] = useState<ManagerState>({ status: "loading" });
  const [settings, setSettings] = useState<OrganizationAuditionSettings>(fallbackSettings);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [performances, setPerformances] = useState<readonly OrganizationEvent[]>([]);
  const [venues, setVenues] = useState<readonly OrganizationVenue[]>([]);
  const [timezone, setTimezone] = useState("UTC");
  const [activeTab, setActiveTab] = useState<AuditionTab>("inquiries");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<OrganizationAudition | null>(null);
  const [schedule, setSchedule] = useState<OrganizationAudition | null>(null);
  const [scheduleTime, setScheduleTime] = useState("");
  const [customScheduleTime, setCustomScheduleTime] = useState("");
  const [confirm, setConfirm] = useState<{
    readonly action: "convert" | "delete";
    readonly audition: OrganizationAudition;
  } | null>(null);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [administratorRecipients, setAdministratorRecipients] = useState<
    readonly AdministratorRecipient[]
  >([]);
  const [statusFilter, setStatusFilter] = useState<AuditionStatus | "all">("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    listOrganizationAuditions(controller.signal)
      .then((auditions) => {
        setState({ auditions, status: "ready" });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" });
      });
    getOrganizationAuditionSettings(controller.signal)
      .then((nextSettings) => {
        setSettings(nextSettings);
        setSettingsLoaded(true);
      })
      .catch(() => {
        setSettings(fallbackSettings);
        setSettingsLoaded(true);
      });
    getOrganizationCalendarSettings(controller.signal)
      .then(({ timezone: nextTimezone }) => {
        setTimezone(nextTimezone);
      })
      .catch(() => {
        setTimezone("UTC");
      });
    listOrganizationEvents(controller.signal)
      .then(setPerformances)
      .catch(() => {
        setPerformances([]);
      });
    listOrganizationVenues(controller.signal)
      .then(setVenues)
      .catch(() => {
        setVenues([]);
      });
    Promise.all([
      listOrganizationProfiles(controller.signal),
      listOrganizationMemberships(controller.signal),
    ])
      .then(([profiles, membershipResult]) => {
        const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
        setAdministratorRecipients(
          membershipResult.memberships
            .filter(
              (membership) =>
                (membership.role === "owner" || membership.role === "administrator") &&
                membership.profileId !== null,
            )
            .map((membership) => {
              const profile = profilesById.get(membership.profileId ?? "");
              return profile ? { email: membership.email, profile, role: membership.role } : null;
            })
            .filter((recipient): recipient is AdministratorRecipient => recipient !== null),
        );
      })
      .catch(() => {
        setAdministratorRecipients([]);
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  const filteredAuditions = useMemo(() => {
    if (state.status !== "ready") return [];
    const query = search.trim().toLocaleLowerCase();
    return state.auditions.filter((audition) => {
      const matchesStatus = statusFilter === "all" || audition.status === statusFilter;
      const matchesSearch =
        !query ||
        `${audition.name} ${audition.email} ${audition.voicePart ?? ""}`
          .toLocaleLowerCase()
          .includes(query);
      return matchesStatus && matchesSearch;
    });
  }, [search, state, statusFilter]);

  function replaceAudition(updated: OrganizationAudition) {
    setState((current) =>
      current.status === "ready"
        ? {
            ...current,
            auditions: current.auditions.map((candidate) =>
              candidate.id === updated.id ? updated : candidate,
            ),
          }
        : current,
    );
  }

  async function saveEdit(update: {
    readonly adminNotes: string;
    readonly availabilityNotes: string;
    readonly email: string;
    readonly experience: string;
    readonly name: string;
    readonly phone: string;
    readonly status: AuditionStatus;
    readonly voicePart: string;
  }) {
    if (!editing) return;
    const updated = await updateOrganizationAudition(editing.id, update);
    replaceAudition(updated);
    setEditing(null);
    setNotice("Audition updated.");
  }

  async function saveSettings(next: OrganizationAuditionSettings) {
    setSettings(await updateOrganizationAuditionSettings(next));
    setNotice("Audition settings saved.");
  }

  async function createAudition(next: OrganizationAuditionCreateRequest) {
    const created = await createOrganizationAudition(next);
    setState((current) =>
      current.status === "ready"
        ? { ...current, auditions: [created, ...current.auditions] }
        : current,
    );
    setCreateOpen(false);
    setNotice("Audition created.");
  }

  async function executeConfirm() {
    if (!confirm) return;
    setActionError(null);
    try {
      if (confirm.action === "delete") {
        await deleteOrganizationAudition(confirm.audition.id);
        setState((current) =>
          current.status === "ready"
            ? {
                ...current,
                auditions: current.auditions.filter(({ id }) => id !== confirm.audition.id),
              }
            : current,
        );
        setNotice("Audition deleted.");
      } else {
        await convertOrganizationAudition(confirm.audition.id);
        replaceAudition({
          ...confirm.audition,
          status: "completed",
          updatedAt: new Date().toISOString(),
        });
        setNotice("Audition converted to an Organization Profile.");
      }
      setConfirm(null);
    } catch {
      setActionError("That audition action could not be completed. Try again.");
    }
  }

  async function scheduleAudition() {
    if (!schedule || !scheduleTime) return;
    setActionError(null);
    try {
      const updated = await updateOrganizationAudition(schedule.id, {
        scheduledTimeSlot: new Date(scheduleTime).toISOString(),
        status: "scheduled",
      });
      replaceAudition(updated);
      setSchedule(null);
      setScheduleTime("");
      setCustomScheduleTime("");
      setNotice("Audition scheduled.");
    } catch {
      setActionError("The audition could not be scheduled. Choose a valid time and try again.");
    }
  }

  async function generateTokens() {
    if (selectedIds.length === 0) return;
    setActionError(null);
    try {
      const generated = await generateAuditionTokens(selectedIds);
      setTokens((current) => ({ ...current, ...generated }));
      setNotice(`${String(selectedIds.length)} token(s) generated.`);
    } catch {
      setActionError("Tokens could not be generated. Confirm the selected auditions still exist.");
    }
  }

  if (!enabled || state.status !== "ready") {
    return <ManagerStatusPanel enabled={enabled} status={state.status} />;
  }

  return (
    <section className="panel" aria-label="Audition management">
      <div className="page-toolbar">
        <p className="section-description">
          Review inquiries, schedule time slots, and convert candidates into Organization Profiles.
        </p>
        <div className="table-actions">
          <button
            className="button"
            onClick={() => {
              setCreateOpen(true);
            }}
            type="button"
          >
            New audition
          </button>
        </div>
      </div>
      {notice ? (
        <p className="notice notice--success" role="status">
          {notice}
        </p>
      ) : null}
      {actionError ? (
        <p className="notice notice--error" role="alert">
          {actionError}
        </p>
      ) : null}
      <div className="audition-tabs" role="tablist" aria-label="Audition sections">
        <button
          aria-controls="audition-inquiries-panel"
          aria-selected={activeTab === "inquiries"}
          className={activeTab === "inquiries" ? "is-active" : undefined}
          id="audition-inquiries-tab"
          onClick={() => {
            setActiveTab("inquiries");
          }}
          role="tab"
          type="button"
        >
          Inquiries
        </button>
        <button
          aria-controls="audition-settings-panel"
          aria-selected={activeTab === "settings"}
          className={activeTab === "settings" ? "is-active" : undefined}
          id="audition-settings-tab"
          onClick={() => {
            setActiveTab("settings");
          }}
          role="tab"
          type="button"
        >
          Settings
        </button>
      </div>
      {activeTab === "settings" ? (
        <div
          aria-labelledby="audition-settings-tab"
          className="audition-tab-panel"
          id="audition-settings-panel"
          role="tabpanel"
        >
          <h2>Audition settings</h2>
          <p className="section-description">
            Configure the public audition form, available time slots, and administrator
            notifications.
          </p>
          {settingsLoaded ? (
            <SettingsForm
              administratorRecipients={administratorRecipients}
              initial={settings}
              onCancel={() => {
                setActiveTab("inquiries");
              }}
              onSave={saveSettings}
              performances={performances}
              timezone={timezone}
              venues={venues}
            />
          ) : (
            <p className="notice" role="status">
              Loading audition settings…
            </p>
          )}
        </div>
      ) : (
        <div aria-labelledby="audition-inquiries-tab" id="audition-inquiries-panel" role="tabpanel">
          <QRCodeShareCard
            description={
              settings.enabled && settings.defaultPerformanceId && settings.slots.length > 0
                ? `Share this link or download the QR code so prospective ${performerLabelPlural.toLowerCase()} can submit an audition request.`
                : "This is the public audition signup link. Configure a performance and time slots, then enable requests before sharing it."
            }
            path="/auditions"
            title="Public audition signup page"
          />
          <div className="form-grid form-grid--compact">
            <label className="field">
              Search
              <input
                placeholder="Name, email, voice part"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                }}
              />
            </label>
            <label className="field">
              Narrow results
              <select
                aria-label="Audition filter"
                value={statusFilter}
                onChange={(event) => {
                  const value = event.target.value;
                  setStatusFilter(value === "all" ? "all" : auditionStatusSchema.parse(value));
                }}
              >
                <option value="all">All statuses</option>
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="field-help audition-token-help">
            Need to follow up with selected applicants? Generate secure, expiring links that let
            them review or update their audition information. These links are different from the
            public signup page above.
          </p>
          <div className="form-actions form-actions--start audition-selection-actions">
            <button
              className="button button--secondary"
              disabled={selectedIds.length === 0}
              onClick={() => void generateTokens()}
              type="button"
            >
              Generate {String(selectedIds.length)} follow-up link(s)
            </button>
            <button
              className="text-button"
              onClick={() => {
                setSelectedIds([]);
              }}
              type="button"
            >
              Clear selection
            </button>
          </div>
          {filteredAuditions.length === 0 ? (
            <div className="notice">
              {state.auditions.length === 0
                ? "No audition inquiries yet. Configure settings or create an audition to begin."
                : "No auditions match the current filters."}
            </div>
          ) : (
            <AuditionTable
              auditions={filteredAuditions}
              onConvert={(audition) => {
                setConfirm({ action: "convert", audition });
              }}
              onDelete={(audition) => {
                setConfirm({ action: "delete", audition });
              }}
              onEdit={setEditing}
              onSchedule={(audition) => {
                setSchedule(audition);
                const initialScheduleTime = audition.scheduledTimeSlot
                  ? new Date(audition.scheduledTimeSlot).toISOString().slice(0, 16)
                  : "";
                setScheduleTime(initialScheduleTime);
                setCustomScheduleTime(initialScheduleTime);
              }}
              onToggle={(id) => {
                setSelectedIds((current) =>
                  current.includes(id)
                    ? current.filter((candidate) => candidate !== id)
                    : [...current, id],
                );
              }}
              onToggleAll={() => {
                const visibleIds = filteredAuditions.map(({ id }) => id);
                const visibleIdSet = new Set(visibleIds);
                const selectedIdSet = new Set(selectedIds);
                const allVisibleSelected = visibleIds.every((id) => selectedIdSet.has(id));
                setSelectedIds((current) =>
                  allVisibleSelected
                    ? current.filter((id) => !visibleIdSet.has(id))
                    : [...new Set([...current, ...visibleIds])],
                );
              }}
              selectedIds={selectedIds}
            />
          )}
          {Object.keys(tokens).length > 0 ? (
            <details className="mt-4">
              <summary>Generated follow-up links</summary>
              <p className="field-help">
                These secure links expire after 90 days. Copy the full link when sending it to an
                applicant.
              </p>
              <ul className="account-list">
                {Object.entries(tokens).map(([id, token]) => {
                  const link = auditionFollowUpUrl(token);
                  return (
                    <li className="flex items-center gap-2" key={id}>
                      <strong>
                        {`${state.auditions.find((audition) => audition.id === id)?.name ?? id}:`}
                      </strong>
                      <a
                        className="text-xs break-all flex-1"
                        href={link}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {link}
                      </a>
                      <button
                        className="button button--secondary button--sm"
                        onClick={() => void navigator.clipboard.writeText(link)}
                        type="button"
                      >
                        Copy link
                      </button>
                    </li>
                  );
                })}
              </ul>
            </details>
          ) : null}
        </div>
      )}

      <AuditionDialogs
        confirm={confirm}
        createAudition={createAudition}
        createOpen={createOpen}
        editing={editing}
        executeConfirm={executeConfirm}
        onCancelConfirm={() => {
          setConfirm(null);
        }}
        onCancelCreate={() => {
          setCreateOpen(false);
        }}
        onCancelEdit={() => {
          setEditing(null);
        }}
        onCancelSchedule={() => {
          setSchedule(null);
          setScheduleTime("");
          setCustomScheduleTime("");
        }}
        onCustomScheduleTimeChange={(value) => {
          setCustomScheduleTime(value);
          setScheduleTime(value);
        }}
        onScheduleTimeChange={(value) => {
          setCustomScheduleTime("");
          setScheduleTime(value);
        }}
        saveEdit={saveEdit}
        schedule={schedule}
        scheduleAudition={scheduleAudition}
        scheduleOpen={schedule !== null}
        scheduleTime={scheduleTime}
        customScheduleTime={customScheduleTime}
      />
    </section>
  );
}
