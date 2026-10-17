import { Dialog, DialogClose } from "@choir/ui";
import { useId, useState } from "react";
import { normalizeEditorLinkUrl, type markdownLinkSelection } from "../../shared/markdownLinks";

type LinkSelection = ReturnType<typeof markdownLinkSelection>;
export function MarkdownLinkEditor({
  selection,
  onApply,
  onRemove,
  onClose,
}: {
  readonly selection: LinkSelection;
  readonly onApply: (text: string, url: string, newTab: boolean) => void;
  readonly onRemove: (text: string) => void;
  readonly onClose: () => void;
}) {
  const id = useId();
  const [text, setText] = useState(selection.text);
  const [url, setUrl] = useState(selection.url);
  const [newTab, setNewTab] = useState(selection.newTab);
  const [error, setError] = useState<string | null>(null);
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
  return (
    <Dialog
      open
      title={selection.existing ? "Edit link" : "Insert link"}
      className="markdown-link-dialog"
      onClose={onClose}
      dirty={text !== selection.text || url !== selection.url || newTab !== selection.newTab}
      description="Choose the text, destination, and how the link opens."
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
              type="button"
              onClick={() => {
                onRemove(text || selection.text);
              }}
            >
              Remove link
            </button>
          ) : null}
          <button className="button button--primary" type="button" onClick={apply}>
            Apply link
          </button>
        </>
      }
    >
      <div className="form-stack">
        {error ? (
          <p className="notice notice--error" role="alert" id={`${id}-error`}>
            {error}
          </p>
        ) : null}
        <label className="field" htmlFor={`${id}-text`}>
          Link text
          <input
            id={`${id}-text`}
            aria-describedby={error ? `${id}-error` : undefined}
            aria-invalid={Boolean(error) && !text.trim()}
            value={text}
            maxLength={1000}
            onChange={(event) => {
              setText(event.target.value);
              setError(null);
            }}
          />
        </label>
        <label className="field" htmlFor={`${id}-url`}>
          Link address
          <input
            id={`${id}-url`}
            aria-describedby={error ? `${id}-error` : undefined}
            aria-invalid={Boolean(error) && !destination}
            value={url}
            placeholder="https://example.org or /history"
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
          />
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={newTab}
            onChange={(event) => {
              setNewTab(event.target.checked);
            }}
          />
          Open in new tab
        </label>
        {destination ? (
          <p className="field-help">
            Destination:{" "}
            <a href={destination} target="_blank" rel="noopener noreferrer">
              {destination}
            </a>
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
