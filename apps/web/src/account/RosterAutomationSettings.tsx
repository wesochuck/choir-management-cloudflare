import { NumberInput } from "@choir/ui";
import type { OrganizationProfile } from "@choir/contracts";
import { useMemo, useState } from "react";

import { useRosterConfigurationDraft } from "./rosterConfigurationDraftContext";
import {
  previewSummary,
  useRosterAutomationPreview,
  type RosterPreviewState,
} from "./rosterAutomationPreview";

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

interface LivePreviewProps {
  readonly effectiveProfileId: string | null;
  readonly onProfileSelect: (id: string | null) => void;
  readonly onRetry: () => void;
  readonly previewState: RosterPreviewState;
  readonly profiles: readonly OrganizationProfile[];
}

function RosterAutomationLivePreview({
  effectiveProfileId,
  onProfileSelect,
  onRetry,
  previewState,
  profiles,
}: LivePreviewProps) {
  const selectedProfile = useMemo(
    () => ("preview" in previewState ? (previewState.preview?.selectedProfile ?? null) : null),
    [previewState],
  );

  return (
    <fieldset className="roster-automation__preview">
      <legend className="roster-automation__legend">Live preview</legend>
      <div className="roster-automation__preview-header">
        <p className="section-description" role="status">
          {previewSummary(previewState)}
        </p>
        <label className="field" htmlFor="roster-automation-profile">
          <span>Preview Profile</span>
          <select
            id="roster-automation-profile"
            onChange={(event) => {
              onProfileSelect(event.target.value || null);
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
      </div>
      {previewState.status === "error" ? (
        <div className="notice notice--error roster-automation__preview-alert" role="alert">
          <span>{previewState.error}</span>
          <button
            className="button button--secondary button--small"
            onClick={onRetry}
            type="button"
          >
            Retry preview
          </button>
        </div>
      ) : null}
      {previewState.status === "loading" && previewState.isSlow ? (
        <div className="notice notice--warning roster-automation__preview-alert" role="status">
          <span>Preview is taking longer than expected.</span>
          <button
            className="button button--secondary button--small"
            onClick={onRetry}
            type="button"
          >
            Retry preview
          </button>
        </div>
      ) : null}
      {selectedProfile ? (
        <div className="roster-automation__profile-preview">
          <div className="roster-automation__profile-summary">
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
  );
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

  const error = contextError ?? draftReturn.error;
  const setConfiguration = draftReturn.setDraft;

  const candidateProfileId = useMemo(
    () =>
      profiles.find((profile) => profile.voicePart.trim() !== "")?.id ?? profiles[0]?.id ?? null,
    [profiles],
  );
  const effectiveProfileId = selectedProfileId ?? candidateProfileId;

  const { handleRetry, previewState } = useRosterAutomationPreview(
    configuration,
    effectiveProfileId,
    enabled,
  );

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
                  <span>Missed Performances before changing Active to Inactive</span>
                  <NumberInput
                    aria-describedby="status-automation-threshold-help"
                    id="status-automation-threshold"
                    max="10"
                    min="1"
                    onChange={(event) => {
                      setConfiguration({
                        ...configuration,
                        statusAutomationMissThreshold: Math.max(
                          1,
                          Math.min(10, Number(event.target.value) || 1),
                        ),
                      });
                    }}
                    value={configuration.statusAutomationMissThreshold}
                  />
                </label>
              </div>
              <p className="field-help" id="status-automation-threshold-help">
                When enabled, an automatically managed Active performer becomes Inactive after{" "}
                {configuration.statusAutomationMissThreshold} consecutive missed Performance
                {configuration.statusAutomationMissThreshold === 1 ? "" : "s"}. A miss means Absent
                attendance, or an RSVP of No unless attendance is Present. Only ended Performances
                count; canceled and archived Performances are excluded. Manually managed Profiles
                are exempt.
              </p>
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
                <span>Days on Break before Inactive</span>
                <NumberInput
                  id="on-break-timeout-days"
                  max="3650"
                  min="1"
                  onChange={(event) => {
                    setConfiguration({
                      ...configuration,
                      onBreakTimeoutDays: Math.max(
                        1,
                        Math.min(3650, Number(event.target.value) || 1),
                      ),
                    });
                  }}
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
              <legend className="roster-automation__legend">
                RSVP follow-up &amp; attendance reports
              </legend>
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
              <p className="field-help">
                <a
                  className="text-primary-strong underline underline-offset-2"
                  href="/admin/communications?tab=templates&templateId=5f0ca4a5-7e4c-4e1a-9a1c-000000000015"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Edit pending RSVP follow-up template
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </p>
              <label className="field" htmlFor="rsvp-follow-up-lead-hours">
                <span>Hours before the RSVP deadline</span>
                <NumberInput
                  id="rsvp-follow-up-lead-hours"
                  max="720"
                  min="1"
                  onChange={(event) => {
                    setConfiguration({
                      ...configuration,
                      rsvpFollowUpLeadHours: Math.max(
                        1,
                        Math.min(720, Number(event.target.value) || 1),
                      ),
                    });
                  }}
                  value={configuration.rsvpFollowUpLeadHours}
                />
              </label>
              <label className="field" htmlFor="attendance-report-warning-threshold">
                <span>Rehearsal misses before an attendance warning</span>
                <NumberInput
                  aria-describedby="attendance-report-warning-help"
                  id="attendance-report-warning-threshold"
                  max="10"
                  min="1"
                  onChange={(event) => {
                    setConfiguration({
                      ...configuration,
                      attendanceReportWarningThreshold: Math.max(
                        1,
                        Math.min(10, Number(event.target.value) || 1),
                      ),
                    });
                  }}
                  value={configuration.attendanceReportWarningThreshold}
                />
              </label>
              <p className="field-help" id="attendance-report-warning-help">
                Performers who miss at least {configuration.attendanceReportWarningThreshold} linked
                Rehearsal{configuration.attendanceReportWarningThreshold === 1 ? "" : "s"} are
                flagged in the Attendance Report. This warning does not change Profile Status.
              </p>
              <label className="choice-field">
                <input
                  checked={configuration.rehearsalAttendanceReportsEnabled}
                  onChange={(event) => {
                    setConfiguration({
                      ...configuration,
                      rehearsalAttendanceReportsEnabled: event.target.checked,
                    });
                  }}
                  type="checkbox"
                />
                <span className="choice-field__content">
                  Send attendance reports for Rehearsals
                </span>
              </label>
              <p className="field-help">
                When enabled, attendance reports are sent 12 hours after Rehearsals in addition to
                Performances.
              </p>
              <p className="field-help">
                <a
                  className="text-primary-strong underline underline-offset-2"
                  href="/admin/communications?tab=templates&templateId=5f0ca4a5-7e4c-4e1a-9a1c-000000000016"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Edit Attendance Report template
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </p>
            </fieldset>
          </div>
          <RosterAutomationLivePreview
            effectiveProfileId={effectiveProfileId}
            onProfileSelect={setSelectedProfileId}
            onRetry={handleRetry}
            previewState={previewState}
            profiles={profiles}
          />
        </>
      ) : null}
    </section>
  );
}
