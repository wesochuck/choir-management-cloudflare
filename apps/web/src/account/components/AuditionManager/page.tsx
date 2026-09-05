import { useEffect, useMemo, useState } from "react";
import type {
  AuditionStatus,
  OrganizationEvent,
  OrganizationAudition,
  OrganizationAuditionCreateRequest,
  OrganizationAuditionSettings,
  OrganizationRosterConfiguration,
  OrganizationVenue,
} from "@choir/contracts";
import { auditionStatusSchema } from "@choir/contracts";
import { Tabs, TabsContent, TabsList, TabsTrigger, useConfirmation } from "@choir/ui";
import {
  convertOrganizationAudition,
  createOrganizationAudition,
  deleteOrganizationAudition,
  getOrganizationCalendarSettings,
  getOrganizationAuditionSettings,
  getOrganizationRosterConfiguration,
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

import { localScheduleInputValue, slotUtcValue, STATUS_OPTIONS, fallbackSettings } from "./utils";

import { ManagerStatusPanel } from "./shared";

import type { Props, ManagerState, AuditionTab, AdministratorRecipient } from "./types";

import { SettingsForm } from "./settings";

import { AuditionTable, AuditionDialogs } from "./tableAndDialogs";

export function AuditionManager({ enabled }: Props) {
  const { partLabel, performerLabelPlural } = useOrganizationTerminology();
  const [state, setState] = useState<ManagerState>({ status: "loading" });
  const [settings, setSettings] = useState<OrganizationAuditionSettings>(fallbackSettings);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [performances, setPerformances] = useState<readonly OrganizationEvent[]>([]);
  const [venues, setVenues] = useState<readonly OrganizationVenue[]>([]);
  const [rosterConfiguration, setRosterConfiguration] =
    useState<OrganizationRosterConfiguration | null>(null);
  const [timezone, setTimezone] = useState("UTC");
  const [activeTab, setActiveTab] = useState<AuditionTab>("inquiries");
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<OrganizationAudition | null>(null);
  const [schedule, setSchedule] = useState<OrganizationAudition | null>(null);
  const [scheduleTime, setScheduleTime] = useState("");
  const [customScheduleTime, setCustomScheduleTime] = useState("");
  const [confirm, setConfirm] = useState<{
    readonly action: "convert" | "delete";
    readonly audition: OrganizationAudition;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [administratorRecipients, setAdministratorRecipients] = useState<
    readonly AdministratorRecipient[]
  >([]);
  const [statusFilter, setStatusFilter] = useState<AuditionStatus | "all">("all");
  const [search, setSearch] = useState("");
  const { confirm: requestConfirmation, confirmationDialog } = useConfirmation();

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
    getOrganizationRosterConfiguration(controller.signal)
      .then(setRosterConfiguration)
      .catch(() => {
        setRosterConfiguration(null);
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

  async function requestSettingsTab(nextTab: AuditionTab): Promise<void> {
    if (activeTab === nextTab) return;
    if (nextTab === "settings" || !settingsDirty) {
      setActiveTab(nextTab);
      return;
    }
    const shouldDiscard = await requestConfirmation({
      confirmLabel: "Discard changes",
      description:
        "Your audition settings have unsaved changes. Save them from the floating save bar before leaving, or discard them to continue.",
      destructive: true,
      title: "Leave audition settings?",
    });
    if (!shouldDiscard) return;
    setSettingsDirty(false);
    setActiveTab(nextTab);
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
    const scheduledTimeSlot = slotUtcValue(
      scheduleTime.slice(0, 10),
      scheduleTime.slice(11, 16),
      timezone,
    );
    if (!scheduledTimeSlot) {
      setActionError("The audition time is not valid in the Organization timezone.");
      return;
    }
    try {
      const updated = await updateOrganizationAudition(schedule.id, {
        scheduledTimeSlot,
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

  if (!enabled || state.status !== "ready") {
    return <ManagerStatusPanel enabled={enabled} status={state.status} />;
  }

  return (
    <section className="panel" aria-label="Audition management">
      <div className="page-toolbar">
        <div className="table-actions">
          <button
            className="button button--primary"
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
      <Tabs
        onValueChange={(val) => {
          void requestSettingsTab(val);
        }}
        value={activeTab}
      >
        <div className="audition-tabs">
          <TabsList aria-label="Audition sections">
            <TabsTrigger
              aria-controls="audition-inquiries-panel"
              id="audition-inquiries-tab"
              value="inquiries"
            >
              Inquiries
            </TabsTrigger>
            <TabsTrigger
              aria-controls="audition-settings-panel"
              id="audition-settings-tab"
              value="settings"
            >
              Settings
            </TabsTrigger>
          </TabsList>
        </div>
        {confirmationDialog}
        <TabsContent
          aria-labelledby="audition-settings-tab"
          className="audition-tab-panel"
          id="audition-settings-panel"
          value="settings"
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
                void requestSettingsTab("inquiries");
              }}
              onDirtyChange={setSettingsDirty}
              onSave={saveSettings}
              onVenueCreated={(venue) => {
                setVenues((current) =>
                  [...current.filter(({ id }) => id !== venue.id), venue].toSorted((left, right) =>
                    left.name.localeCompare(right.name),
                  ),
                );
              }}
              performances={performances}
              timezone={timezone}
              venues={venues}
            />
          ) : (
            <p className="notice" role="status">
              Loading audition settings…
            </p>
          )}
        </TabsContent>
        <TabsContent
          aria-labelledby="audition-inquiries-tab"
          id="audition-inquiries-panel"
          value="inquiries"
        >
          <QRCodeShareCard
            asFieldset
            description={
              settings.enabled && settings.defaultPerformanceId && settings.slots.length > 0
                ? `Share this link or download the QR code so prospective ${performerLabelPlural.toLowerCase()} can submit an audition request.`
                : "This is the public audition signup link. Configure a performance and time slots, then enable requests before sharing it."
            }
            path="/auditions"
            title="Public audition signup page"
          />
          <fieldset className="audition-inquiries__filters">
            <legend className="audition-inquiries__legend">Filter inquiries</legend>
            <div className="form-grid form-grid--compact">
              <label className="field">
                Search
                <input
                  placeholder={`Name, email, ${partLabel.toLowerCase()}`}
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
          </fieldset>
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
                  ? localScheduleInputValue(audition.scheduledTimeSlot, timezone)
                  : "";
                setScheduleTime(initialScheduleTime);
                setCustomScheduleTime(initialScheduleTime);
              }}
            />
          )}
        </TabsContent>
      </Tabs>

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
        rosterConfiguration={rosterConfiguration}
        saveEdit={saveEdit}
        schedule={schedule}
        scheduleAudition={scheduleAudition}
        scheduleOpen={schedule !== null}
        scheduleTime={scheduleTime}
        customScheduleTime={customScheduleTime}
        timezone={timezone}
      />
    </section>
  );
}
