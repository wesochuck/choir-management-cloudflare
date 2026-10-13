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
    <span>
      <span style={{ display: "block" }}>{contact.name}</span>
      <span
        className="field__hint compliance-contact-email"
        style={{ display: "block", marginTop: "0.125rem" }}
      >
        {contact.email}
      </span>
    </span>
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
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
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
    <div>
      <strong style={{ display: "block", fontSize: "1rem" }}>{task.title}</strong>
      <span
        className="status-pill"
        style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}
        title={
          custom
            ? "Organization-defined custom reminder"
            : "Built-in filing template with Organization-specific dates"
        }
      >
        {custom ? "Custom" : "Built-in"}
      </span>
      {task.kind === "ohio_unclaimed_funds_annual_report" ? (
        <span className="field__hint" style={{ display: "block", marginTop: "0.375rem" }}>
          Suggested date only (October 31 target), not legal advice. Confirm applicability and dates
          for your Organization.{" "}
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
        </span>
      ) : null}
    </div>
  );
}

export function StatusCell({ status }: { readonly status: ComplianceStatus }): React.JSX.Element {
  return (
    <span
      aria-label={`Status: ${status.label}`}
      className={`status-pill status-pill--${status.tone}`}
      style={{ display: "inline-block", fontSize: "0.8125rem", fontWeight: 600 }}
    >
      Status: {status.label}
    </span>
  );
}
