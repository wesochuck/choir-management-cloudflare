import type { OrganizationEventRequest } from "@choir/contracts";
import { DialogClose } from "@choir/ui";

export function EventEditorHeader({
  busy = false,
  canManageSetLists = true,
  dirty,
  editingId,
  eventStart,
  eventTitle,
  eventType,
  onOpenSetList,
  timezoneLabel,
}: {
  readonly busy?: boolean | undefined;
  readonly canManageSetLists?: boolean | undefined;
  readonly dirty: boolean;
  readonly editingId: string | null;
  readonly eventStart: string;
  readonly eventTitle: string;
  readonly eventType: OrganizationEventRequest["type"];
  readonly onOpenSetList?: (() => void) | undefined;
  readonly timezoneLabel: string | null;
}) {
  const displayTitle = eventTitle.trim() ? eventTitle : editingId ? "Edit event" : "Create event";

  return (
    <div className="event-editor-header">
      <div className="event-editor-header__identity">
        <div className="event-editor-header__details">
          <h2 className="event-editor-header__title">
            {displayTitle} · {eventType}
          </h2>
          <p className="event-editor-header__subtext">
            {eventStart ? eventStart.replace("T", " · ") : "No start time yet"}
            {timezoneLabel ? ` · ${timezoneLabel}` : ""}
          </p>
        </div>
      </div>
      <div className="event-editor-header__actions">
        {editingId && eventType === "Performance" && canManageSetLists && onOpenSetList ? (
          <button
            className="text-button event-editor-header__set-list-action"
            disabled={busy}
            onClick={onOpenSetList}
            type="button"
          >
            Open set list →
          </button>
        ) : null}
        {dirty ? (
          <span className="status-pill status-pill--warning">Unsaved changes</span>
        ) : (
          <span className="status-pill status-pill--neutral">No unsaved changes</span>
        )}
        <DialogClose asChild>
          <button aria-label="Close" className="dialog__close" type="button">
            &times;
          </button>
        </DialogClose>
      </div>
    </div>
  );
}
