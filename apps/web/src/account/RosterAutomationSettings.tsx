import type {
  OrganizationProfile,
  OrganizationRosterAutomationPreviewResponse,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { useEffect, useMemo, useState } from "react";

import {
  getOrganizationRosterConfiguration,
  listOrganizationProfiles,
  previewOrganizationRosterAutomation,
  updateOrganizationRosterConfiguration,
} from "../auth/api";
import { useFloatingSaveAction } from "./useFloatingSaveAction";

interface Props {
  readonly enabled: boolean;
}

function statusLabel(status: OrganizationProfile["globalStatus"]): string {
  return status === "Idle" ? "On Break" : status;
}

function formatDate(value: string | null): string {
  if (!value) return "No automatic transition scheduled";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(dateOnly ? `${value}T00:00:00.000Z` : value);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    ...(dateOnly ? { timeZone: "UTC" } : {}),
  }).format(date);
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function previewSummary(preview: OrganizationRosterAutomationPreviewResponse | null): string {
  if (!preview) return "Previewing the current roster…";
  if (preview.affectedProfileCount === 0)
    return "No existing Profiles would change under these settings.";
  return `${String(preview.affectedProfileCount)} Profile${preview.affectedProfileCount === 1 ? "" : "s"} affected · ${String(preview.statusChangeCount)} status change${preview.statusChangeCount === 1 ? "" : "s"} · ${String(preview.rsvpExpiryCount)} RSVP expiry${preview.rsvpExpiryCount === 1 ? "" : "ies"}`;
}

export function RosterAutomationSettings({ enabled }: Props) {
  const [configuration, setConfiguration] = useState<OrganizationRosterConfiguration | null>(null);
  const [savedConfiguration, setSavedConfiguration] =
    useState<OrganizationRosterConfiguration | null>(null);
  const [profiles, setProfiles] = useState<readonly OrganizationProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [preview, setPreview] = useState<OrganizationRosterAutomationPreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void Promise.all([
      getOrganizationRosterConfiguration(controller.signal),
      listOrganizationProfiles(controller.signal),
    ])
      .then(([nextConfiguration, nextProfiles]) => {
        setConfiguration(nextConfiguration);
        setSavedConfiguration(nextConfiguration);
        setProfiles(nextProfiles);
        setSelectedProfileId(
          nextProfiles.find((profile) => profile.voicePart.trim() !== "")?.id ?? null,
        );
        setLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError("Roster automation settings could not be loaded.");
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  useEffect(() => {
    if (!configuration || !enabled) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void previewOrganizationRosterAutomation(configuration, selectedProfileId)
        .then((nextPreview) => {
          if (!cancelled) setPreview(nextPreview);
        })
        .catch(() => {
          if (!cancelled) setPreview(null);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [configuration, enabled, selectedProfileId]);

  const selectedProfile = useMemo(() => preview?.selectedProfile ?? null, [preview]);
  const dirty = JSON.stringify(configuration) !== JSON.stringify(savedConfiguration);

  async function save(): Promise<void> {
    if (!configuration) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const latest = await getOrganizationRosterConfiguration();
      const nextConfiguration = await updateOrganizationRosterConfiguration({
        ...latest,
        onBreakTimeoutDays: configuration.onBreakTimeoutDays,
        onBreakTimeoutEnabled: configuration.onBreakTimeoutEnabled,
        rsvpExpiryEnabled: configuration.rsvpExpiryEnabled,
        rsvpExpiryLeadDays: configuration.rsvpExpiryLeadDays,
        rsvpFollowUpEnabled: configuration.rsvpFollowUpEnabled,
        rsvpFollowUpLeadHours: configuration.rsvpFollowUpLeadHours,
        statusAutomationEnabled: configuration.statusAutomationEnabled,
        statusAutomationMissThreshold: configuration.statusAutomationMissThreshold,
        statusAutomationRecoveryEnabled: configuration.statusAutomationRecoveryEnabled,
        attendanceReportWarningThreshold: configuration.attendanceReportWarningThreshold,
      });
      setConfiguration(nextConfiguration);
      setSavedConfiguration(nextConfiguration);
      setSaved(true);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : "Roster automation settings could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  useFloatingSaveAction({
    busy,
    dirty,
    id: "organization-roster-automation",
    onDiscard: () => {
      setConfiguration(savedConfiguration);
      setSaved(false);
    },
    onSave: save,
  });

  if (!enabled) return null;

  return (
    <section className="surface-card roster-automation" aria-labelledby="roster-automation-title">
      <div className="section-heading section-heading--compact">
        <p className="eyebrow">Roster settings</p>
        <h2 id="roster-automation-title">Roster status automation</h2>
        <p className="section-description">
          These rules keep Profile Status and event RSVPs current. They run automatically in the
          Organization timezone, and every actual change is recorded in history.
        </p>
      </div>
      {loading ? <p role="status">Loading roster automation settings…</p> : null}
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="notice notice--success" role="status">
          Roster automation settings saved and existing records recalculated.
        </p>
      ) : null}
      {configuration ? (
        <>
          <div className="roster-automation__flow" aria-label="Roster automation flow">
            <span>Performance ends</span>
            <span aria-hidden="true">→</span>
            <span>RSVP deadline closes</span>
            <span aria-hidden="true">→</span>
            <span>Status history updates</span>
            <span aria-hidden="true">→</span>
            <span>Roster stays understandable</span>
          </div>
          <div className="roster-automation__cards">
            <article className="roster-automation__card">
              <div className="section-heading section-heading--compact">
                <p className="eyebrow">Profile Status</p>
                <h3>Profile Status Automation</h3>
                <p className="section-description">
                  A Performer becomes Inactive after consecutive missed, ended Performances. A
                  future Performance RSVP of Yes restores an automatically managed Profile to
                  Active.
                </p>
              </div>
              <label className="checkbox-row">
                <input
                  checked={configuration.statusAutomationEnabled}
                  onChange={(event) => {
                    setConfiguration({
                      ...configuration,
                      statusAutomationEnabled: event.target.checked,
                    });
                  }}
                  type="checkbox"
                />
                Automatically manage Profile Status
              </label>
              <div className="settings-grid">
                <label className="field" htmlFor="status-automation-threshold">
                  Consecutive missed Performances
                  <input
                    id="status-automation-threshold"
                    min="1"
                    max="10"
                    onChange={(event) => {
                      setConfiguration({
                        ...configuration,
                        statusAutomationMissThreshold: Math.max(
                          1,
                          Math.min(10, Number(event.target.value) || 1),
                        ),
                      });
                    }}
                    type="number"
                    value={configuration.statusAutomationMissThreshold}
                  />
                </label>
              </div>
              <label className="checkbox-row">
                <input
                  checked={configuration.statusAutomationRecoveryEnabled}
                  onChange={(event) => {
                    setConfiguration({
                      ...configuration,
                      statusAutomationRecoveryEnabled: event.target.checked,
                    });
                  }}
                  type="checkbox"
                />
                Restore to Active when a future Performance RSVP is Yes
              </label>
            </article>

            <article className="roster-automation__card">
              <div className="section-heading section-heading--compact">
                <p className="eyebrow">On Break</p>
                <h3>On Break Timeout</h3>
                <p className="section-description">
                  On Break is a visible Profile Status. This independent timer eventually moves an
                  automatically managed Performer to Inactive.
                </p>
              </div>
              <label className="checkbox-row">
                <input
                  checked={configuration.onBreakTimeoutEnabled}
                  onChange={(event) => {
                    setConfiguration({
                      ...configuration,
                      onBreakTimeoutEnabled: event.target.checked,
                    });
                  }}
                  type="checkbox"
                />
                Automatically age out On Break Profiles
              </label>
              <label className="field" htmlFor="on-break-timeout-days">
                Days on Break before Inactive
                <input
                  id="on-break-timeout-days"
                  min="1"
                  max="3650"
                  onChange={(event) => {
                    setConfiguration({
                      ...configuration,
                      onBreakTimeoutDays: Math.max(
                        1,
                        Math.min(3650, Number(event.target.value) || 1),
                      ),
                    });
                  }}
                  type="number"
                  value={configuration.onBreakTimeoutDays}
                />
              </label>
            </article>

            <article className="roster-automation__card">
              <div className="section-heading section-heading--compact">
                <p className="eyebrow">Event RSVPs</p>
                <h3>RSVP Expiry</h3>
                <p className="section-description">
                  Pending Performance RSVPs become No after the displayed local deadline. The
                  deadline stays open through 11:59 p.m. on that date.
                </p>
              </div>
              <label className="checkbox-row">
                <input
                  checked={configuration.rsvpExpiryEnabled}
                  onChange={(event) => {
                    setConfiguration({ ...configuration, rsvpExpiryEnabled: event.target.checked });
                  }}
                  type="checkbox"
                />
                Close Pending Performance RSVPs automatically
              </label>
              <label className="field" htmlFor="rsvp-expiry-lead-days">
                Days before the Performance date
                <input
                  id="rsvp-expiry-lead-days"
                  min="1"
                  max="365"
                  onChange={(event) => {
                    setConfiguration({
                      ...configuration,
                      rsvpExpiryLeadDays: Math.max(
                        1,
                        Math.min(365, Number(event.target.value) || 1),
                      ),
                    });
                  }}
                  type="number"
                  value={configuration.rsvpExpiryLeadDays}
                />
              </label>
              <p className="field-help">Current default: 7 days before the Performance date.</p>
            </article>

            <article className="roster-automation__card">
              <div className="section-heading section-heading--compact">
                <p className="eyebrow">Scheduled communications</p>
                <h3>Pending RSVP follow-up</h3>
                <p className="section-description">
                  Send one email to active Performers who have not responded before the RSVP
                  deadline. Linked Rehearsals use their parent Performance.
                </p>
              </div>
              <label className="checkbox-row">
                <input
                  checked={configuration.rsvpFollowUpEnabled}
                  onChange={(event) => {
                    setConfiguration({
                      ...configuration,
                      rsvpFollowUpEnabled: event.target.checked,
                    });
                  }}
                  type="checkbox"
                />
                Send the pending RSVP follow-up email
              </label>
              <label className="field" htmlFor="rsvp-follow-up-lead-hours">
                Hours before the RSVP deadline
                <input
                  id="rsvp-follow-up-lead-hours"
                  min="1"
                  max="720"
                  onChange={(event) => {
                    setConfiguration({
                      ...configuration,
                      rsvpFollowUpLeadHours: Math.max(
                        1,
                        Math.min(720, Number(event.target.value) || 1),
                      ),
                    });
                  }}
                  type="number"
                  value={configuration.rsvpFollowUpLeadHours}
                />
              </label>
              <label className="field" htmlFor="attendance-report-warning-threshold">
                Rehearsal misses before an attendance warning
                <input
                  id="attendance-report-warning-threshold"
                  min="1"
                  max="10"
                  onChange={(event) => {
                    setConfiguration({
                      ...configuration,
                      attendanceReportWarningThreshold: Math.max(
                        1,
                        Math.min(10, Number(event.target.value) || 1),
                      ),
                    });
                  }}
                  type="number"
                  value={configuration.attendanceReportWarningThreshold}
                />
              </label>
              <p className="field-help">
                Attendance reports are sent 12 hours after Performances and Rehearsals. The default
                warning threshold is one missed linked Rehearsal.
              </p>
            </article>
          </div>

          <div className="roster-automation__preview">
            <div className="section-heading section-heading--compact">
              <p className="eyebrow">Live preview</p>
              <h3>See what the rules mean for a real Profile</h3>
              <p className="section-description">{previewSummary(preview)}</p>
            </div>
            <label className="field" htmlFor="roster-automation-profile">
              Preview Profile
              <select
                id="roster-automation-profile"
                onChange={(event) => {
                  setSelectedProfileId(event.target.value || null);
                }}
                value={selectedProfileId ?? ""}
              >
                <option value="">Choose a Profile</option>
                {profiles
                  .filter((profile) => profile.voicePart.trim() !== "")
                  .map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.displayName}
                    </option>
                  ))}
              </select>
            </label>
            {selectedProfile ? (
              <div className="roster-automation__profile-preview">
                <div>
                  <strong>{selectedProfile.displayName}</strong>
                  <p className="field-help">
                    {statusLabel(selectedProfile.currentStatus)} →{" "}
                    {statusLabel(selectedProfile.nextStatus)} · {selectedProfile.nextStatusReason}
                  </p>
                </div>
                <p className="field-help">
                  {selectedProfile.currentStatus === "Idle"
                    ? `On Break transition: ${formatDate(selectedProfile.onBreakInactiveDate)}`
                    : "No On Break transition scheduled."}
                </p>
                {selectedProfile.recentPerformances.length > 0 ? (
                  <div className="roster-automation__recent">
                    {selectedProfile.recentPerformances.slice(0, 3).map((performance) => (
                      <span key={performance.id} className="status-pill">
                        {formatDateTime(performance.startsAt)} · {performance.rsvp} /{" "}
                        {performance.attendance}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="field-help">No Performance roster history yet.</p>
                )}
              </div>
            ) : null}
          </div>
          <p className="notice notice--info">
            Administrators can opt an individual Profile out with{" "}
            <strong>Manage status manually</strong> on the Profile. Selecting a status by itself
            does not turn automation off.
          </p>
        </>
      ) : null}
    </section>
  );
}
