import type { OrganizationAttendanceRow, OrganizationEventRequest } from "@choir/contracts";
import { useEffect, useMemo, useState } from "react";
import { listOrganizationEventAttendance } from "../../../../api";

export interface EventRsvpSummaryProps {
  readonly editingId: string | null;
  readonly eventType: OrganizationEventRequest["type"];
  readonly onOpenRsvpDetails?: (() => void) | undefined;
  readonly staffingGoal?: number | null | undefined;
}

function ActiveEventRsvpSummary({
  editingId,
  eventType,
  onOpenRsvpDetails,
  staffingGoal,
}: EventRsvpSummaryProps & { readonly editingId: string }) {
  const [rows, setRows] = useState<readonly OrganizationAttendanceRow[]>([]);
  const [state, setState] = useState<"error" | "loading" | "ready">("loading");

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset state when editingId changes
    setState("loading");

    listOrganizationEventAttendance(editingId, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setRows(data);
          setState("ready");
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          setState("error");
        }
      });

    return () => {
      controller.abort();
    };
  }, [editingId]);

  const counts = useMemo(() => {
    let yes = 0;
    let no = 0;
    let pending = 0;
    for (const row of rows) {
      if (row.rsvp === "Yes") {
        yes++;
      } else if (row.rsvp === "No") {
        no++;
      } else {
        pending++;
      }
    }
    return {
      no,
      pending,
      total: rows.length,
      yes,
    };
  }, [rows]);

  const targetUrl = `/admin/rsvp?eventId=${encodeURIComponent(editingId)}`;

  return (
    <fieldset className="event-rsvp-summary">
      <legend>RSVP responses</legend>
      <p className="field-help">
        {eventType === "Performance"
          ? "Live summary of Performer responses for this performance."
          : "Live summary of member responses and volunteering for this event."}
      </p>

      {state === "loading" ? (
        <p className="field-help" role="status">
          Loading RSVP responses…
        </p>
      ) : null}

      {state === "error" ? (
        <p className="notice notice--error" role="alert">
          Unable to load RSVP responses.
        </p>
      ) : null}

      {state === "ready" ? (
        <>
          <div
            aria-label="RSVP response summary"
            className="event-rsvp-summary__metrics"
            role="group"
          >
            <span className="rsvp-status-badge rsvp-status-badge--Yes">
              Attending: {String(counts.yes)}
            </span>
            <span className="rsvp-status-badge rsvp-status-badge--No">
              Declined: {String(counts.no)}
            </span>
            <span className="rsvp-status-badge rsvp-status-badge--Pending">
              No response: {String(counts.pending)}
            </span>
            <span className="status-pill">Total: {String(counts.total)}</span>
          </div>

          {staffingGoal && staffingGoal > 0 ? (
            <p className="event-rsvp-summary__staffing">
              Staffing goal: <strong>{String(counts.yes)}</strong> of{" "}
              <strong>{String(staffingGoal)}</strong> volunteers committed
              {counts.yes >= staffingGoal ? " (goal reached)" : ""}.
            </p>
          ) : null}

          <div className="button-row">
            <a
              className="button button--secondary button--small"
              href={targetUrl}
              onClick={(clickEvent) => {
                if (
                  !clickEvent.defaultPrevented &&
                  clickEvent.button === 0 &&
                  !clickEvent.metaKey &&
                  !clickEvent.ctrlKey &&
                  !clickEvent.shiftKey &&
                  !clickEvent.altKey
                ) {
                  clickEvent.preventDefault();
                  onOpenRsvpDetails?.();
                }
              }}
            >
              View full RSVP details →
            </a>
          </div>
        </>
      ) : null}
    </fieldset>
  );
}

export function EventRsvpSummary(props: EventRsvpSummaryProps) {
  if (!props.editingId) {
    return (
      <fieldset className="event-rsvp-summary">
        <legend>RSVP responses</legend>
        <p className="field-help" role="status">
          Save this event to view RSVP responses and manage attendance.
        </p>
      </fieldset>
    );
  }

  return <ActiveEventRsvpSummary {...props} editingId={props.editingId} />;
}
