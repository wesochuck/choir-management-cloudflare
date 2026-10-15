import type { OrganizationEventRequest } from "@choir/contracts";
import { TabsContent } from "@choir/ui";
import type { Dispatch, SetStateAction } from "react";

import type { SectionErrors } from "../eventSections";

export function BasicsSection({
  error,
  event,
  handleTypeChange,
  sectionErrors,
  setEvent,
  showErrorBadges,
}: {
  readonly error: string | null;
  readonly event: OrganizationEventRequest;
  readonly handleTypeChange: (type: OrganizationEventRequest["type"]) => void;
  readonly sectionErrors: SectionErrors;
  readonly setEvent: Dispatch<SetStateAction<OrganizationEventRequest>>;
  readonly showErrorBadges: boolean;
}) {
  return (
    <TabsContent
      aria-labelledby="event-editor-basics-tab"
      className="event-editor-panel"
      id="event-editor-basics-panel"
      value="basics"
    >
      <div className="event-editor-panel__header">
        <h3 className="event-editor-panel__title">Basics</h3>
        <p className="event-editor-panel__description">
          Title, type, and internal notes. Required sections must be complete before saving.
        </p>
      </div>
      <div className="field">
        <label htmlFor="events-page-title">Title *</label>
        <input
          aria-describedby={error ? "event-editor-error" : undefined}
          aria-invalid={sectionErrors.basics.length > 0}
          id="events-page-title"
          maxLength={500}
          onChange={(change) => {
            setEvent((current) => ({ ...current, title: change.target.value }));
          }}
          required
          value={event.title}
        />
        {sectionErrors.basics.some((message) => message.includes("title")) && showErrorBadges ? (
          <p className="notice notice--error" role="alert">
            {sectionErrors.basics.find((message) => message.includes("title"))}
          </p>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor="events-page-type">Type *</label>
        <select
          id="events-page-type"
          onChange={(change) => {
            const val = change.target.value;
            const type: OrganizationEventRequest["type"] =
              val === "Performance" ? "Performance" : val === "Other" ? "Other" : "Rehearsal";
            handleTypeChange(type);
          }}
          value={event.type}
        >
          <option value="Rehearsal">Rehearsal</option>
          <option value="Performance">Performance</option>
          <option value="Other">Other</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="events-page-details">Internal details</label>
        <textarea
          id="events-page-details"
          maxLength={100000}
          onChange={(change) => {
            setEvent((current) => ({ ...current, details: change.target.value }));
          }}
          rows={3}
          value={event.details}
        />
      </div>
    </TabsContent>
  );
}
