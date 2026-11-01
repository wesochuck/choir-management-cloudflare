import type { PublicWebsiteDocument } from "@choir/contracts";
import { Dialog, DialogClose } from "@choir/ui";
import { useEffect, useState, type RefObject } from "react";
import { listOrganizationPublicDocuments } from "../../api";

export function MarkdownDocumentPicker({
  documents: supplied,
  anchorRef,
  onReturnFocus,
  onSelect,
  onClose,
  onManage,
}: {
  readonly onReturnFocus: () => void;
  readonly anchorRef: RefObject<HTMLButtonElement | null>;
  readonly documents?: readonly PublicWebsiteDocument[] | undefined;
  readonly onSelect: (document: PublicWebsiteDocument) => void;
  readonly onClose: () => void;
  readonly onManage?: (() => Promise<void>) | undefined;
}) {
  const [documents, setDocuments] = useState(supplied ?? null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (supplied) return;
    const controller = new AbortController();
    void listOrganizationPublicDocuments(controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setDocuments(items);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => {
      controller.abort();
    };
  }, [supplied, attempt]);
  const matches = documents?.filter((item) =>
    item.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <Dialog
      anchorRef={anchorRef}
      open
      dirty={false}
      title="Insert document"
      description="Inserts a link at your cursor. Website documents are already public."
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        onReturnFocus();
      }}
      onClose={onClose}
      footer={
        <>
          <DialogClose asChild>
            <button className="button button--secondary" type="button">
              Cancel
            </button>
          </DialogClose>
          {onManage ? (
            <button
              className="button button--secondary"
              type="button"
              onClick={() => {
                void onManage();
              }}
            >
              Manage documents
            </button>
          ) : null}
        </>
      }
    >
      <label className="field">
        Search website documents
        <input
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
      </label>
      {error ? (
        <div role="alert">
          <p>Website documents could not be loaded.</p>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => {
              setError(false);
              setAttempt((value) => value + 1);
            }}
          >
            Retry
          </button>
        </div>
      ) : documents === null ? (
        <p role="status">Loading documents…</p>
      ) : documents.length === 0 ? (
        <p>No website documents yet. Add one in Documents.</p>
      ) : matches?.length === 0 ? (
        <p>No matching documents.</p>
      ) : (
        <ul className="website-document-picker">
          {matches?.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => {
                  onSelect(item);
                }}
              >
                <strong>{item.title}</strong>{" "}
                <span>
                  {item.contentType === "application/pdf" ? "PDF" : "Word"} ·{" "}
                  {Math.ceil(item.sizeBytes / 1024)} KB
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
