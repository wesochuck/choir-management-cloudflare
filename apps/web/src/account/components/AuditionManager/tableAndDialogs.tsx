import type {
  AuditionStatus,
  OrganizationAudition,
  OrganizationAuditionCreateRequest,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { Dialog } from "@choir/ui";

import {
  STATUS_LABELS,
  formatDate,
  localScheduleInputValue,
  requestedScheduleValue,
  requestedSlotState,
} from "./utils";

import { EditAuditionForm, CreateAuditionForm } from "./shared";

export function AuditionTable({
  auditions,
  onConvert,
  onDelete,
  onEdit,
  onSchedule,
}: {
  readonly auditions: readonly OrganizationAudition[];
  readonly onConvert: (audition: OrganizationAudition) => void;
  readonly onDelete: (audition: OrganizationAudition) => void;
  readonly onEdit: (audition: OrganizationAudition) => void;
  readonly onSchedule: (audition: OrganizationAudition) => void;
}) {
  return (
    <div className="audition-table" role="table">
      <div className="audition-table__header" role="row">
        <span role="columnheader">Name / contact</span>
        <span role="columnheader">Preferred times</span>
        <span role="columnheader">Status</span>
        <span role="columnheader">Submitted</span>
        <span role="columnheader">Actions</span>
      </div>
      {auditions.map((audition) => (
        <div className="audition-table__row" key={audition.id} role="row">
          <span role="cell">
            <strong>{audition.name}</strong>
            <small className="table-secondary">
              {audition.email}
              {audition.phone ? ` · ${audition.phone}` : ""}
              {audition.voicePart ? ` · ${audition.voicePart}` : ""}
            </small>
          </span>
          <span role="cell">
            {audition.scheduledTimeSlot
              ? formatDate(audition.scheduledTimeSlot)
              : audition.requestedSlots.length > 0
                ? (() => {
                    const requestedState = requestedSlotState(audition.requestedSlots);
                    return (
                      <>
                        <span>{String(audition.requestedSlots.length)} requested</span>
                        {requestedState.passedCount === audition.requestedSlots.length ? (
                          <small className="table-secondary audition-time-status audition-time-status--past">
                            All requested times passed
                          </small>
                        ) : requestedState.passedCount > 0 ? (
                          <small className="table-secondary audition-time-status audition-time-status--past">
                            {String(requestedState.passedCount)} passed
                          </small>
                        ) : null}
                      </>
                    );
                  })()
                : "Any time"}
          </span>
          <span role="cell">
            <span className={`badge badge--${audition.status}`}>
              {STATUS_LABELS[audition.status]}
            </span>
          </span>
          <span role="cell">{formatDate(audition.createdAt)}</span>
          <span role="cell">
            <div className="table-actions">
              <button
                className="button button--secondary button--small"
                onClick={() => {
                  onEdit(audition);
                }}
                type="button"
              >
                Edit
              </button>
              {audition.status === "pending" ||
              audition.status === "scheduled" ||
              audition.status === "completed" ? (
                <button
                  className="button button--secondary button--small"
                  onClick={() => {
                    onConvert(audition);
                  }}
                  type="button"
                >
                  Convert to Profile
                </button>
              ) : null}
              {audition.status === "pending" ? (
                <button
                  className="button button--secondary button--small"
                  onClick={() => {
                    onSchedule(audition);
                  }}
                  type="button"
                >
                  Schedule
                </button>
              ) : null}
              <button
                className="button button--danger button--small"
                onClick={() => {
                  onDelete(audition);
                }}
                type="button"
              >
                Delete
              </button>
            </div>
          </span>
        </div>
      ))}
    </div>
  );
}

export function AuditionDialogs({
  confirm,
  customScheduleTime,
  createAudition,
  createOpen,
  editing,
  executeConfirm,
  onCancelConfirm,
  onCancelCreate,
  onCancelEdit,
  onCancelSchedule,
  onCustomScheduleTimeChange,
  onScheduleTimeChange,
  rosterConfiguration,
  saveEdit,
  schedule,
  scheduleAudition,
  scheduleOpen,
  scheduleTime,
  timezone,
}: {
  readonly confirm: {
    readonly action: "convert" | "delete";
    readonly audition: OrganizationAudition;
  } | null;
  readonly createAudition: (next: OrganizationAuditionCreateRequest) => Promise<void>;
  readonly createOpen: boolean;
  readonly editing: OrganizationAudition | null;
  readonly executeConfirm: () => Promise<void>;
  readonly onCancelConfirm: () => void;
  readonly onCancelCreate: () => void;
  readonly onCancelEdit: () => void;
  readonly onCancelSchedule: () => void;
  readonly onCustomScheduleTimeChange: (value: string) => void;
  readonly onScheduleTimeChange: (value: string) => void;
  readonly rosterConfiguration: OrganizationRosterConfiguration | null;
  readonly saveEdit: (update: {
    readonly adminNotes: string;
    readonly availabilityNotes: string;
    readonly email: string;
    readonly experience: string;
    readonly name: string;
    readonly phone: string;
    readonly status: AuditionStatus;
    readonly voicePart: string;
  }) => Promise<void>;
  readonly schedule: OrganizationAudition | null;
  readonly scheduleAudition: () => Promise<void>;
  readonly scheduleOpen: boolean;
  readonly scheduleTime: string;
  readonly customScheduleTime: string;
  readonly timezone: string;
}) {
  return (
    <>
      <Dialog
        description="Update contact details, status, and internal notes."
        onClose={onCancelEdit}
        open={editing !== null}
        title="Edit audition"
      >
        {editing ? (
          <EditAuditionForm audition={editing} onCancel={onCancelEdit} onSave={saveEdit} />
        ) : null}
      </Dialog>
      <Dialog
        description="Create an internal audition request."
        onClose={onCancelCreate}
        open={createOpen}
        title="New audition"
      >
        {createOpen ? (
          <CreateAuditionForm
            onCancel={onCancelCreate}
            onSave={createAudition}
            rosterConfiguration={rosterConfiguration}
          />
        ) : null}
      </Dialog>
      <Dialog
        description="Choose a confirmed time and send the applicant a scheduling update."
        onClose={onCancelSchedule}
        open={scheduleOpen}
        title="Schedule audition"
      >
        <form
          className="form-stack audition-schedule-form"
          onSubmit={(event) => {
            event.preventDefault();
            void scheduleAudition();
          }}
        >
          {schedule?.requestedSlots && schedule.requestedSlots.length > 0 ? (
            <>
              <fieldset className="schedule-time-section">
                <legend>Applicant's requested times</legend>
                <p className="schedule-time-section__hint">
                  Choose one of the times the applicant requested.
                </p>
                <label className="field">
                  Requested time
                  <select
                    value={requestedScheduleValue(scheduleTime, schedule.requestedSlots, timezone)}
                    onChange={(event) => {
                      onScheduleTimeChange(event.target.value);
                    }}
                  >
                    <option value="">Choose a requested time…</option>
                    {schedule.requestedSlots.map((slot) => (
                      <option key={slot} value={localScheduleInputValue(slot, timezone)}>
                        {formatDate(slot)}
                      </option>
                    ))}
                  </select>
                </label>
              </fieldset>
              <fieldset className="schedule-time-section">
                <legend>Need a different time?</legend>
                <p className="schedule-time-section__hint">
                  Use this only when none of the requested times work.
                </p>
                <label className="field">
                  Custom confirmed time
                  <input
                    required={
                      !requestedScheduleValue(scheduleTime, schedule.requestedSlots, timezone)
                    }
                    type="datetime-local"
                    value={customScheduleTime}
                    onChange={(event) => {
                      onCustomScheduleTimeChange(event.target.value);
                    }}
                  />
                </label>
              </fieldset>
            </>
          ) : null}
          {!schedule?.requestedSlots || schedule.requestedSlots.length === 0 ? (
            <label className="field">
              Confirmed time
              <input
                required
                type="datetime-local"
                value={scheduleTime}
                onChange={(event) => {
                  onScheduleTimeChange(event.target.value);
                }}
              />
            </label>
          ) : null}
          <div className="form-actions">
            <button className="button button--secondary" onClick={onCancelSchedule} type="button">
              Cancel
            </button>
            <button className="button button--primary" type="submit">
              Confirm schedule
            </button>
          </div>
        </form>
      </Dialog>
      <Dialog
        description="This action cannot be undone."
        onClose={onCancelConfirm}
        open={confirm !== null}
        title={
          confirm?.action === "convert" ? "Convert to Organization Profile?" : "Delete audition?"
        }
      >
        {confirm ? (
          <div className="form-stack">
            <p>
              {confirm.action === "convert"
                ? `Create an Organization Profile for ${confirm.audition.name} and mark this audition complete?`
                : `Delete the audition request for ${confirm.audition.name}?`}
            </p>
            <div className="form-actions">
              <button className="button button--secondary" onClick={onCancelConfirm} type="button">
                Cancel
              </button>
              <button
                className="button button--danger"
                onClick={() => void executeConfirm()}
                type="button"
              >
                {confirm.action === "convert" ? "Convert" : "Delete"}
              </button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
