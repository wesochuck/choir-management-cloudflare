import type { DonationPublication } from "@choir/contracts";
import { formatTimezoneName } from "@choir/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useConfirmation } from "@choir/ui";
import { listDonationPublications, saveDonationPublication } from "../../../api/donations";
import { queryKeys } from "../../../api";
import { usePersistedDraft } from "../../../persistence";

export function PublicationSettings() {
  const client = useQueryClient();
  const [publicationCursor, setPublicationCursor] = useState<string>();
  const query = useQuery({
    queryKey: queryKeys.organization.donationPublications(publicationCursor),
    queryFn: () => listDonationPublications(publicationCursor),
  });
  const [editingId, setEditingId] = useState("");

  const [starting, setStarting] = useState(false);
  const [newId, setNewId] = useState(() => crypto.randomUUID());
  const { confirm, confirmationDialog } = useConfirmation();
  const initialValue = useMemo(
    () => publicationDraft(query.data, editingId, starting, newId),
    [query.data, editingId, starting, newId],
  );
  const { draft, updateField, save, saving, error, dirty } = usePersistedDraft({
    initialValue,
    resourceKey: "donation-publication-settings",
    save: async (value) => {
      await saveDonationPublication({
        id: value.id,
        name: value.name,
        recognitionDate: value.recognitionDate || null,
        artworkDate: value.artworkDate || null,
        expectedRevision: value.revision,
        requestId: crypto.randomUUID(),
      });
      await client.invalidateQueries({ queryKey: queryKeys.organization.donationSettings });
      setStarting(false);
      return { ...value, revision: value.revision + 1 };
    },
  });
  if (query.isPending) return <p>Loading publication settings…</p>;
  if (query.isError)
    return <p className="notice notice--error">Publication settings could not be loaded.</p>;
  if (!draft) return null;
  const cannotSwitch = dirty || saving || starting;
  return (
    <section className="surface-card form-stack" aria-label="Publication recognition settings">
      <h3>Publication recognition</h3>
      <p>
        One named publication at a time. These optional dates apply to every donation level.
        Donations and artwork remain welcome after the dates; inclusion is no longer guaranteed.
      </p>
      <label className="field">
        Publication to edit
        <select
          disabled={cannotSwitch}
          value={editingId}
          onChange={(e) => {
            setEditingId(e.target.value);
          }}
        >
          <option value="">Current publication</option>
          {query.data.publications.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {query.data.nextCursor ? (
        <button
          className="button button--secondary"
          disabled={cannotSwitch}
          type="button"
          onClick={() => {
            setPublicationCursor(query.data.nextCursor ?? undefined);
          }}
        >
          More publications
        </button>
      ) : null}
      {query.data.current && !starting ? (
        <button
          className="button button--secondary"
          type="button"
          disabled={saving || dirty}
          onClick={() =>
            void confirm({
              title: "Start next publication?",
              description:
                "Existing donations and artwork links keep their original publication. Save the new publication to activate it.",
              confirmLabel: "Start next publication",
            }).then((ok) => {
              if (ok) {
                setNewId(crypto.randomUUID());
                setEditingId("");
                setStarting(true);
              }
            })
          }
        >
          Start next publication
        </button>
      ) : null}
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="field">
          Publication name
          <input
            required
            maxLength={120}
            value={draft.name}
            onChange={(e) => {
              updateField("name", e.target.value);
            }}
          />
        </label>
        <label className="field">
          Name-recognition cutoff (optional)
          <input
            type="date"
            value={draft.recognitionDate}
            onChange={(e) => {
              updateField("recognitionDate", e.target.value);
            }}
          />
        </label>
        <label className="field">
          Artwork deadline (optional)
          <input
            type="date"
            value={draft.artworkDate}
            onChange={(e) => {
              updateField("artworkDate", e.target.value);
            }}
          />
        </label>
        <p className="field-help">
          Dates remain open through 11:59 p.m. in{" "}
          {query.data.current?.timezone
            ? formatTimezoneName(
                query.data.current.timezone,
                draft.recognitionDate || draft.artworkDate,
              )
            : "the Organization timezone"}
          . Extending a date reevaluates late flags. Moving it earlier preserves submissions that
          were already on time.
        </p>
        {error ? (
          <p role="alert" className="notice notice--error">
            {error}
          </p>
        ) : null}
        <button
          className="button button--primary"
          disabled={saving || !draft.name.trim()}
          type="submit"
        >
          Save publication
        </button>
      </form>
      {confirmationDialog}
    </section>
  );
}

function publicationDraft(
  data: { current: DonationPublication | null; publications: DonationPublication[] } | undefined,
  editingId: string,
  starting: boolean,
  newId: string,
) {
  if (!data) return null;
  const selected = data.publications.find((p) => p.id === editingId) ?? data.current;
  if (starting || !selected)
    return { id: newId, name: "", recognitionDate: "", artworkDate: "", revision: 0 };
  return {
    ...selected,
    recognitionDate: selected.recognitionDate ?? "",
    artworkDate: selected.artworkDate ?? "",
  };
}
