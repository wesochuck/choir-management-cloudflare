import type { OrganizationAttendanceRow } from "@choir/contracts";
import { useEffect, useId, useMemo, useState } from "react";
import { previewOrganizationCommunicationReach } from "../../../api";
import {
  rsvpNotificationAudience,
  rsvpNotificationHref,
  type RsvpNotificationStatus,
} from "./rsvpNotification";

function partsForRows(rows: readonly OrganizationAttendanceRow[]): string[] {
  return [...new Set(rows.map((row) => row.voicePart).filter((part) => part.trim() !== ""))];
}

export function RsvpNotificationAction({
  eventId,
  rows,
  onNavigate,
}: {
  readonly eventId: string;
  readonly rows: readonly OrganizationAttendanceRow[];
  readonly onNavigate?: ((href: string) => void) | undefined;
}) {
  const audienceId = useId();
  const [globalStatuses, setGlobalStatuses] = useState<readonly RsvpNotificationStatus[]>([
    "Active",
  ]);
  const parts = useMemo(() => partsForRows(rows), [rows]);
  const audience = useMemo(
    () => rsvpNotificationAudience(eventId, parts, globalStatuses),
    [eventId, parts, globalStatuses],
  );
  const [reach, setReach] = useState<{
    readonly audience: typeof audience;
    readonly email: number | null;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    if (parts.length === 0 || globalStatuses.length === 0) return;
    void previewOrganizationCommunicationReach({ audience, channel: "Email" }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setReach({ audience, email: result.email });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setReach({ audience, email: null });
      });
    return () => {
      controller.abort();
    };
  }, [audience, globalStatuses, parts]);

  const href = rsvpNotificationHref(eventId, parts, globalStatuses);
  return (
    <div>
      <fieldset className="field">
        <legend>Manual RSVP email recipients</legend>
        <div className="checkbox-grid">
          {(
            [
              ["Active", "Active"],
              ["Idle", "On Break"],
              ["Inactive", "Inactive"],
            ] as const
          ).map(([status, label]) => (
            <label className="checkbox-row" key={status} htmlFor={`${audienceId}-${status}`}>
              <input
                id={`${audienceId}-${status}`}
                type="checkbox"
                checked={globalStatuses.includes(status)}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setGlobalStatuses((current) =>
                    checked ? [...current, status] : current.filter((value) => value !== status),
                  );
                }}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="field-help" aria-live="polite">
        {globalStatuses.length === 0
          ? "Select at least one member status."
          : parts.length === 0
            ? "No performers to notify."
            : reach?.audience !== audience
              ? "Checking RSVP email recipients…"
              : reach.email === null
                ? "Email recipient count unavailable. Review recipients before sending."
                : `${String(reach.email)} awaiting response can receive RSVP email.`}{" "}
        Only people who have not replied are included. Missing addresses, opt-outs, and suppressed
        addresses are excluded.
      </p>
      {parts.length > 0 && globalStatuses.length > 0 ? (
        <a
          className="button button--secondary button--small"
          href={href}
          onClick={(event) => {
            if (
              onNavigate &&
              event.button === 0 &&
              !event.metaKey &&
              !event.ctrlKey &&
              !event.shiftKey &&
              !event.altKey
            ) {
              event.preventDefault();
              onNavigate(href);
            }
          }}
        >
          Request RSVPs
        </a>
      ) : null}
      <p className="field-help">
        Review and send an email now. The automatic reminder keeps its separate schedule.
      </p>
    </div>
  );
}
