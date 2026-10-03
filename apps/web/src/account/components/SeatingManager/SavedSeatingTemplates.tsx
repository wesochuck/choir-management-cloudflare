import { useState } from "react";
import type { SavedSeatingTemplate, SeatingConfiguration } from "@choir/contracts";
import { Dialog, DialogClose } from "@choir/ui";
import {
  getOrganizationSeatingConfiguration,
  updateOrganizationSeatingConfiguration,
} from "../../../api";

export function SavedSeatingTemplates({
  configuration,
  canUse,
  onUse,
  onSaved,
}: {
  readonly configuration: SeatingConfiguration;
  readonly canUse: boolean;
  readonly onUse: (id: string) => void;
  readonly onSaved: (configuration: SeatingConfiguration) => void;
}) {
  const [removing, setRemoving] = useState<SavedSeatingTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const templates = configuration.templates ?? [];
  async function remove(): Promise<void> {
    if (!removing || busy) return;
    setBusy(true);
    setError(null);
    try {
      const latest = await getOrganizationSeatingConfiguration();
      const saved = await updateOrganizationSeatingConfiguration({
        ...latest,
        templates: (latest.templates ?? []).filter(({ id }) => id !== removing.id),
      });
      onSaved(saved);
      setRemoving(null);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "The template could not be deleted.");
    } finally {
      setBusy(false);
    }
  }
  if (templates.length === 0) return null;
  return (
    <>
      <details className="no-print">
        <summary>Saved templates ({templates.length})</summary>
        <p className="field-help">
          Reusable arrangements retain all singer names. Use a template to copy eligible assignments
          into the selected chart.
        </p>
        {!canUse ? <p>Create a Performance chart to use a template.</p> : null}
        <ul className="form-stack">
          {templates.map((template) => (
            <li key={template.id} className="flex flex-wrap items-center gap-2">
              <span>
                {template.name} · {template.assignments.length} singers
              </span>
              <button
                type="button"
                className="button button--secondary"
                disabled={!canUse}
                onClick={() => {
                  onUse(template.id);
                }}
              >
                Use {template.name}
              </button>
              <button
                type="button"
                className="button button--danger"
                onClick={() => {
                  setRemoving(template);
                  setError(null);
                }}
              >
                Delete {template.name}
              </button>
            </li>
          ))}
        </ul>
      </details>
      {removing ? (
        <Dialog
          open
          variant="confirmation"
          title="Delete seating template?"
          description="Performance charts already copied from this template are retained."
          onClose={() => {
            if (!busy) setRemoving(null);
          }}
        >
          <div className="form-stack">
            <p>Delete “{removing.name}” from saved templates?</p>
            {error ? <p role="alert">{error}</p> : null}
            <div className="dialog__actions">
              <DialogClose asChild>
                <button type="button" className="button button--secondary" disabled={busy}>
                  Cancel
                </button>
              </DialogClose>
              <button
                type="button"
                className="button button--danger"
                disabled={busy}
                onClick={() => {
                  void remove();
                }}
              >
                {busy ? "Deleting…" : "Delete template"}
              </button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
