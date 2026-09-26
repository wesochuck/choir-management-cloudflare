import type {
  OrganizationProfile,
  OrganizationRosterAutomationPreviewResponse,
} from "@choir/contracts";
import { useEffect, useMemo, useState } from "react";

import { previewOrganizationRosterAutomation } from "../auth/api";
import { useRosterConfigurationDraft } from "./rosterConfigurationDraftContext";

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
  const {
    draft: configuration,
    draftReturn,
    error: contextError,
    loading,
    profiles,
  } = useRosterConfigurationDraft();

  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [preview, setPreview] = useState<OrganizationRosterAutomationPreviewResponse | null>(null);

  const error = contextError ?? draftReturn.error;
  const setConfiguration = draftReturn.setDraft;

  const candidateProfileId = useMemo(
    () =>
      profiles.find((profile) => profile.voicePart.trim() !== "")?.id ?? profiles[0]?.id ?? null,
    [profiles],
  );
  const effectiveProfileId = selectedProfileId ?? candidateProfileId;

  useEffect(() => {
    if (!configuration || !enabled) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void previewOrganizationRosterAutomation(configuration, effectiveProfileId)
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
  }, [configuration, effectiveProfileId, enabled]);

  const selectedProfile = useMemo(() => preview?.selectedProfile ?? null, [preview]);

  if (!enabled) return null;

  return (
    <section className="roster-automation" aria-label="Roster status automation">
      {loading ? <p role="status">Loading roster automation settings…</p> : null}
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {draftReturn.lastSavedAt && !draftReturn.dirty ? (
        <p className="notice notice--success" role="status">
          Roster automation settings saved.
        </p>
      ) : null}
      {configuration ? (
        <>
          <div className="roster-automation__cards">
            <fieldset className="roster-automation__card">
              <legend className="roster-automation__legend">Profile Status Automation</legend>
              <label className="choice-field">
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
                <span className="choice-field__content">Automatically manage Profile Status</span>
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
              <label className="choice-field">
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
                <span className="choice-field__content">
                  Restore to Active when a future Performance RSVP is Yes
                </span>
              </label>
            </fieldset>

            <fieldset className="roster-automation__card">
              <legend className="roster-automation__legend">On Break Timeout</legend>
              <label className="choice-field">
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
                <span className="choice-field__content">
                  Automatically age out On Break Profiles
                </span>
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
            </fieldset>

            <fieldset className="roster-automation__card">
              <legend className="roster-automation__legend">RSVP Expiry</legend>
              <label className="choice-field">
                <input
                  checked={configuration.rsvpExpiryEnabled}
                  onChange={(event) => {
                    setConfiguration({ ...configuration, rsvpExpiryEnabled: event.target.checked });
                  }}
                  type="checkbox"
                />
                <span className="choice-field__content">
                  Convert Pending responses to No at the deadline
                </span>
              </label>
            </fieldset>

            <fieldset className="roster-automation__card">
              <legend className="roster-automation__legend">Pending RSVP follow-up</legend>
              <label className="choice-field">
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
                <span className="choice-field__content">Send the pending RSVP follow-up email</span>
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
            </fieldset>
          </div>
          <fieldset className="roster-automation__preview">
            <legend className="roster-automation__legend">Live preview</legend>
            <p className="section-description">{previewSummary(preview)}</p>
            <label className="field" htmlFor="roster-automation-profile">
              Preview Profile
              <select
                id="roster-automation-profile"
                onChange={(event) => {
                  setSelectedProfileId(event.target.value || null);
                }}
                value={effectiveProfileId ?? ""}
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
          </fieldset>
        </>
      ) : null}
    </section>
  );
}
