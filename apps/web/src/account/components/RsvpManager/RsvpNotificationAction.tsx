import type { OrganizationAttendanceRow } from "@choir/contracts";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { previewOrganizationCommunicationReach } from "../../../api";
import {
  rsvpNotificationAudience,
  rsvpNotificationHref,
  type RsvpNotificationStatus,
} from "./rsvpNotification";

function partsForRows(rows: readonly OrganizationAttendanceRow[]): string[] {
  return [...new Set(rows.map((row) => row.voicePart).filter((part) => part.trim() !== ""))];
}

function RsvpNotificationDisclosure({
  children,
  defaultOpen,
  status,
}: {
  readonly children: ReactNode;
  readonly defaultOpen: boolean;
  readonly status: string;
}) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const userTogglePending = useRef(false);
  const open = manualOpen ?? defaultOpen;

  return (
    <details
      className="rsvp-notification-disclosure"
      onToggle={(event) => {
        if (!userTogglePending.current) return;
        userTogglePending.current = false;
        setManualOpen(event.currentTarget.open);
      }}
      open={open}
    >
      <summary
        className="rsvp-notification-disclosure__summary"
        onClick={() => {
          userTogglePending.current = true;
        }}
      >
        <span className="rsvp-notification-disclosure__title">Manual RSVP email</span>
        <span aria-live="polite" className="rsvp-notification-disclosure__status">
          {status}
        </span>
      </summary>
      {children}
    </details>
  );
}

export function RsvpNotificationAction({
  activePendingCount,
  eventId,
  onNavigate,
  rows,
  rsvpDeadlinePassed = false,
}: {
  readonly activePendingCount?: number | undefined;
  readonly eventId: string;
  readonly rows: readonly OrganizationAttendanceRow[];
  readonly onNavigate?: ((href: string) => void) | undefined;
  readonly rsvpDeadlinePassed?: boolean | undefined;
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
  const previewStatus =
    globalStatuses.length === 0
      ? "Select at least one member status."
      : parts.length === 0
        ? "No performers to notify."
        : reach?.audience !== audience
          ? "Checking RSVP email recipients…"
          : reach.email === null
            ? "Email recipient count unavailable. Review recipients before sending."
            : `${String(reach.email)} awaiting response can receive RSVP email.`;
  const summaryStatus = rsvpDeadlinePassed
    ? `Self-service RSVP is closed · ${previewStatus}`
    : previewStatus;
  const defaultOpen = !rsvpDeadlinePassed && activePendingCount !== 0;

  return (
    <RsvpNotificationDisclosure defaultOpen={defaultOpen} key={eventId} status={summaryStatus}>
      <div className="rsvp-notification-disclosure__panel">
        <div className="rsvp-notification-disclosure__controls">
          <fieldset className="rsvp-notification-disclosure__recipients">
            <legend className="sr-only">Manual RSVP email recipients</legend>
            <div className="rsvp-notification-disclosure__status-options">
              {(
                [
                  ["Active", "Active"],
                  ["Idle", "On Break"],
                  ["Inactive", "Inactive"],
                ] as const
              ).map(([status, label]) => (
                <label
                  className="checkbox-row checkbox-row--compact rsvp-notification-disclosure__status-option"
                  key={status}
                  htmlFor={`${audienceId}-${status}`}
                >
                  <input
                    id={`${audienceId}-${status}`}
                    type="checkbox"
                    checked={globalStatuses.includes(status)}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setGlobalStatuses((current) =>
                        checked
                          ? [...current, status]
                          : current.filter((value) => value !== status),
                      );
                    }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          {parts.length > 0 && globalStatuses.length > 0 ? (
            <a
              className="button button--secondary button--control-height"
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
        </div>
        <p className="field-help">
          Only people who have not replied are included. Missing addresses, opt-outs, and suppressed
          addresses are excluded. Review and send an email now; the automatic reminder keeps its
          separate schedule.
        </p>
      </div>
    </RsvpNotificationDisclosure>
  );
}
