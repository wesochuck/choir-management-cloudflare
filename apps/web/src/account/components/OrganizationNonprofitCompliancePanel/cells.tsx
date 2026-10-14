import type { ComplianceAssignee, NonprofitComplianceTask } from "@choir/contracts";

import { isCustomTask, type ComplianceStatus, type TaskCardActions } from "./types";

export function ResponsibleCell({
  assignees,
  task,
}: {
  readonly assignees: readonly ComplianceAssignee[];
  readonly task: NonprofitComplianceTask;
}): React.JSX.Element {
  if (task.responsibleNeedsReassignment) return <span>Needs reassignment</span>;
  const direct =
    task.responsibleName && task.responsibleEmail
      ? { email: task.responsibleEmail, name: task.responsibleName }
      : null;
  const assigned = task.responsibleMembershipId
    ? assignees.find((a) => a.membershipId === task.responsibleMembershipId)
    : undefined;
  const contact = direct ?? (assigned ? { email: assigned.email, name: assigned.name } : null);
  if (!contact) {
    return <span>{task.responsibleMembershipId ? "Needs reassignment" : "Unassigned"}</span>;
  }
  return (
    <div className="compliance-responsible">
      <span className="compliance-responsible__name">{contact.name}</span>
      <span className="field__hint compliance-contact-email">{contact.email}</span>
    </div>
  );
}

export function TaskActionButtons({
  actions,
  operationBusy,
  task,
}: {
  readonly actions: TaskCardActions;
  readonly operationBusy: boolean;
  readonly task: NonprofitComplianceTask;
}): React.JSX.Element {
  return (
    <div className="compliance-task-actions">
      {task.applicable ? (
        <button
          className="button button--primary button--sm"
          disabled={operationBusy}
          onClick={(event) => {
            actions.onComplete(task, event.currentTarget);
          }}
          type="button"
        >
          Mark completed
        </button>
      ) : null}
      <button
        className="button button--secondary button--sm"
        disabled={operationBusy}
        onClick={() => {
          actions.onEdit(task);
        }}
        type="button"
      >
        Edit
      </button>
      {isCustomTask(task) ? (
        <button
          className="button button--secondary button--sm"
          disabled={operationBusy}
          onClick={() => {
            actions.onArchive(task);
          }}
          type="button"
        >
          Archive
        </button>
      ) : null}
    </div>
  );
}

export function RequirementCell({
  task,
}: {
  readonly task: NonprofitComplianceTask;
}): React.JSX.Element {
  const custom = isCustomTask(task);
  return (
    <div className="compliance-requirement">
      <strong className="compliance-requirement__title">{task.title}</strong>
      <div className="compliance-requirement__meta">
        <span
          className="status-pill"
          title={
            custom
              ? "Organization-defined custom reminder"
              : "Built-in filing template with Organization-specific dates"
          }
        >
          {custom ? "Custom" : "Built-in"}
        </span>
      </div>
      {task.kind === "ohio_unclaimed_funds_annual_report" ? (
        <div className="compliance-requirement__details">
          <span className="field__hint compliance-requirement__cue">
            Oct 31 is a suggested date — confirm applicability.
          </span>
          <details className="compliance-requirement__disclosure">
            <summary className="compliance-requirement__summary">
              Filing guidance and references
            </summary>
            <div className="compliance-requirement__guidance">
              <p className="field__hint">
                Suggested date only (October 31 target), not legal advice. Confirm applicability and
                dates for your Organization.
              </p>
              <div className="compliance-requirement__links">
                <a
                  href="https://unclaimedfunds.ohio.gov/app/submit-a-report"
                  rel="noreferrer"
                  target="_blank"
                >
                  Ohio holder reporting
                </a>
                {" · "}
                <a
                  href="https://codes.ohio.gov/ohio-revised-code/section-169.03"
                  rel="noreferrer"
                  target="_blank"
                >
                  ORC 169.03
                </a>
              </div>
            </div>
          </details>
        </div>
      ) : null}
    </div>
  );
}

export function StatusCell({ status }: { readonly status: ComplianceStatus }): React.JSX.Element {
  return (
    <span
      aria-label={`Status: ${status.label}`}
      className={`status-pill status-pill--${status.tone} compliance-status-pill`}
    >
      Status: {status.label}
    </span>
  );
}
