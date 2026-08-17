import { DataTable, Dialog, DialogClose } from "@choir/ui";
import { useMemo, useState } from "react";

import { summarizeMusicCredits, type MusicCreditSummary } from "./utils";
import type { OrganizationMusicPiece } from "@choir/contracts";

export function MusicCredits({
  busy,
  onRename,
  pieces,
}: {
  readonly busy: boolean;
  readonly onRename: (currentName: string, newName: string) => Promise<number>;
  readonly pieces: readonly OrganizationMusicPiece[];
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<MusicCreditSummary | null>(null);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const credits = useMemo(() => summarizeMusicCredits(pieces), [pieces]);
  const visibleCredits = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return needle
      ? credits.filter(({ name }) => name.toLocaleLowerCase().includes(needle))
      : credits;
  }, [credits, search]);
  const trimmedName = newName.trim();
  const dirty = selected !== null && trimmedName !== selected.name;
  const canSubmit = trimmedName.length > 0 && dirty;
  const merges =
    selected !== null &&
    trimmedName !== selected.name &&
    credits.some(({ name }) => name === trimmedName);

  function close(): void {
    if (busy) return;
    setSelected(null);
    setNewName("");
    setError(null);
  }

  async function submit(): Promise<void> {
    if (!selected || !canSubmit || busy) return;
    setError(null);
    try {
      await onRename(selected.name, trimmedName);
      close();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "The music credit could not be renamed.");
    }
  }

  return (
    <div className="music-credits">
      <div className="music-credits__toolbar">
        <label className="field">
          Search composers and arrangers
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </label>
      </div>
      {credits.length === 0 ? (
        <p className="empty-state">
          No composer or arranger credits have been added to the catalog.
        </p>
      ) : (
        <DataTable
          columns={[
            {
              header: "Name",
              id: "name",
              mobileLabel: "Name",
              render: ({ name }) => <strong>{name}</strong>,
              sortValue: ({ name }) => name,
            },
            {
              header: "Composer pieces",
              id: "composerPieces",
              mobileLabel: "Composer pieces",
              render: ({ composerPieces }) => composerPieces,
              sortValue: ({ composerPieces }) => composerPieces,
            },
            {
              header: "Arranger pieces",
              id: "arrangerPieces",
              mobileLabel: "Arranger pieces",
              render: ({ arrangerPieces }) => arrangerPieces,
              sortValue: ({ arrangerPieces }) => arrangerPieces,
            },
            {
              header: "Total pieces",
              id: "totalPieces",
              mobileLabel: "Total pieces",
              render: ({ totalPieces }) => totalPieces,
              sortValue: ({ totalPieces }) => totalPieces,
            },
            {
              header: "Actions",
              id: "actions",
              mobileLabel: "Actions",
              render: (credit) => (
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={() => {
                    setSelected(credit);
                    setNewName(credit.name);
                    setError(null);
                  }}
                >
                  Rename
                </button>
              ),
            },
          ]}
          emptyMessage="No composer or arranger credits match your search."
          initialSort={{ columnId: "name", direction: "asc" }}
          keySelector={({ name }) => name}
          rows={visibleCredits}
        />
      )}
      <Dialog
        description="This changes exact composer and arranger values on the affected catalog pieces."
        dirty={dirty}
        onClose={close}
        open={selected !== null}
        title="Rename music credit"
      >
        {selected ? (
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <p>
              Rename <strong>{selected.name}</strong> across {selected.totalPieces} distinct piece
              {selected.totalPieces === 1 ? "" : "s"} ({selected.composerPieces} composer,{" "}
              {selected.arrangerPieces} arranger).
            </p>
            <label className="field">
              New credit name
              <input
                autoFocus
                maxLength={300}
                required
                value={newName}
                onChange={(event) => {
                  setNewName(event.target.value);
                  setError(null);
                }}
              />
            </label>
            {merges ? (
              <p className="notice">
                This exact name already exists. Saving merges these credit rows; the source spelling
                will no longer remain distinct.
              </p>
            ) : null}
            {error ? (
              <p className="notice notice--error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="dialog__actions">
              <DialogClose asChild>
                <button className="button button--secondary" disabled={busy} type="button">
                  Cancel
                </button>
              </DialogClose>
              <button
                className="button button--primary"
                disabled={!canSubmit || busy}
                type="submit"
              >
                {busy ? "Saving…" : merges ? "Merge credits" : "Rename credit"}
              </button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </div>
  );
}
