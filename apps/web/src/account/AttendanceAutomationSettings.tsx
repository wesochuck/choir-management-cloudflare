import { NumberInput } from "@choir/ui";
import { useContext } from "react";

import { RosterConfigurationDraftProvider } from "./RosterConfigurationDraftProvider";
import {
  rosterConfigurationDraftContext,
  useRosterConfigurationDraft,
} from "./rosterConfigurationDraftContext";

interface Props {
  readonly enabled: boolean;
}

function AttendanceAutomationSettingsContent() {
  const {
    draft: configuration,
    draftReturn,
    error: contextError,
    loading,
  } = useRosterConfigurationDraft();

  const error = contextError ?? draftReturn.error;
  const setConfiguration = draftReturn.setDraft;

  return (
    <section className="roster-automation" aria-label="Attendance automation settings">
      {loading ? <p role="status">Loading attendance automation settings…</p> : null}
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {draftReturn.lastSavedAt && !draftReturn.dirty ? (
        <p className="notice notice--success" role="status">
          Attendance automation settings saved.
        </p>
      ) : null}
      {configuration ? (
        <div className="roster-automation__cards">
          <fieldset className="roster-automation__card">
            <legend className="roster-automation__legend">Attendance reports</legend>
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
              Performers who miss more than {configuration.attendanceReportWarningThreshold} linked
              Rehearsal{configuration.attendanceReportWarningThreshold === 1 ? "" : "s"} are flagged
              in the Attendance Report. This warning does not change Profile Status.
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
              <span className="choice-field__content">Send attendance reports for Rehearsals</span>
            </label>
            <p className="field-help">
              When enabled, attendance reports are sent 12 hours after Rehearsals in addition to
              Performances.
            </p>
            <p className="field-help">
              <a
                className="text-primary-strong underline underline-offset-2"
                href="/admin/communications?tab=templates&templateId=5f0ca4a5-7e4c-4e1a-9a1c-000000000016"
                rel="noopener noreferrer"
                target="_blank"
              >
                Edit Attendance Report template
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </p>
          </fieldset>
        </div>
      ) : null}
    </section>
  );
}

export function AttendanceAutomationSettings({ enabled }: Props) {
  const existingContext = useContext(rosterConfigurationDraftContext);
  if (!enabled) return null;
  if (existingContext) {
    return <AttendanceAutomationSettingsContent />;
  }
  return (
    <RosterConfigurationDraftProvider enabled={enabled}>
      <AttendanceAutomationSettingsContent />
    </RosterConfigurationDraftProvider>
  );
}
