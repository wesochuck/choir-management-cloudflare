import type { PublicWebsiteDocument } from "@choir/contracts";
import { Dialog, DialogClose } from "@choir/ui";
import { useEffect, useId, useState } from "react";

import { listOrganizationPublicDocuments } from "../../api";
import { normalizeEditorLinkUrl, type markdownLinkSelection } from "../../shared/markdownLinks";

type LinkSelection = ReturnType<typeof markdownLinkSelection>;

export function MarkdownLinkEditor({
  selection,
  hostedDocuments: initialHostedDocuments,
  onApply,
  onRemove,
  onClose,
}: {
  readonly selection: LinkSelection;
  readonly hostedDocuments?: readonly PublicWebsiteDocument[] | undefined;
  readonly onApply: (text: string, url: string, newTab: boolean) => void;
  readonly onRemove: (text: string) => void;
  readonly onClose: () => void;
}) {
  const id = useId();
  const [text, setText] = useState(selection.text);
  const [url, setUrl] = useState(selection.url);
  const [newTab, setNewTab] = useState(selection.newTab);
  const [error, setError] = useState<string | null>(null);
  const [fetchedDocuments, setFetchedDocuments] = useState<readonly PublicWebsiteDocument[]>([]);
  const hostedDocuments = initialHostedDocuments ?? fetchedDocuments;

  useEffect(() => {
    if (initialHostedDocuments) {
      return;
    }
    let active = true;
    void listOrganizationPublicDocuments()
      .then((docs) => {
        if (active) setFetchedDocuments(docs);
      })
      .catch(() => {
        // Gracefully ignore if not authenticated or not supported in current context
      });
    return () => {
      active = false;
    };
  }, [initialHostedDocuments]);

  const destination = normalizeEditorLinkUrl(url);

  function apply() {
    if (!text.trim() || !destination) {
      setError(
        "Enter link text and a valid website address, email link, page path, or page anchor.",
      );
      return;
    }
    onApply(text.trim(), destination, newTab);
  }

  const selectedDocumentId = hostedDocuments.find((doc) => doc.downloadPath === url)?.id ?? "";

  return (
    <Dialog
      className="markdown-link-dialog"
      description="Choose the text, destination, and how the link opens."
      dirty={text !== selection.text || url !== selection.url || newTab !== selection.newTab}
      footer={
        <>
          <DialogClose asChild>
            <button className="button button--secondary" type="button">
              Cancel
            </button>
          </DialogClose>
          {selection.existing ? (
            <button
              className="button button--secondary"
              onClick={() => {
                onRemove(text || selection.text);
              }}
              type="button"
            >
              Remove link
            </button>
          ) : null}
          <button className="button button--primary" onClick={apply} type="button">
            Apply link
          </button>
        </>
      }
      onClose={onClose}
      open
      title={selection.existing ? "Edit link" : "Insert link"}
    >
      <div className="form-stack">
        {error ? (
          <p className="notice notice--error" id={`${id}-error`} role="alert">
            {error}
          </p>
        ) : null}

        {hostedDocuments.length > 0 ? (
          <label className="field" htmlFor={`${id}-hosted-doc`}>
            Hosted document (optional)
            <select
              id={`${id}-hosted-doc`}
              onChange={(event) => {
                const docId = event.target.value;
                const found = hostedDocuments.find((d) => d.id === docId);
                if (found) {
                  setUrl(found.downloadPath);
                  if (!text.trim()) {
                    setText(found.title);
                  }
                  setNewTab(true);
                  setError(null);
                }
              }}
              value={selectedDocumentId}
            >
              <option value="">Choose a hosted document or enter address below…</option>
              {hostedDocuments.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.title} ({doc.contentType === "application/pdf" ? "PDF" : "DOCX"})
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="field" htmlFor={`${id}-text`}>
          Link text
          <input
            aria-describedby={error ? `${id}-error` : undefined}
            aria-invalid={Boolean(error) && !text.trim()}
            id={`${id}-text`}
            maxLength={1000}
            onChange={(event) => {
              setText(event.target.value);
              setError(null);
            }}
            value={text}
          />
        </label>

        <label className="field" htmlFor={`${id}-url`}>
          Link address
          <input
            aria-describedby={error ? `${id}-error` : undefined}
            aria-invalid={Boolean(error) && !destination}
            id={`${id}-url`}
            maxLength={2048}
            onChange={(event) => {
              setUrl(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                apply();
              }
            }}
            placeholder="https://example.org or /history"
            value={url}
          />
        </label>

        <label className="checkbox-row">
          <input
            checked={newTab}
            onChange={(event) => {
              setNewTab(event.target.checked);
            }}
            type="checkbox"
          />
          Open in new tab
        </label>

        {destination ? (
          <p className="field-help">
            Destination:{" "}
            <a href={destination} rel="noopener noreferrer" target="_blank">
              {destination}
            </a>
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
