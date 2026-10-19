import type { OrganizationEvent } from "@choir/contracts";
import { Dialog, DialogClose } from "@choir/ui";
import { useEffect, useRef, useState } from "react";

import type { SetListManagerModel } from "../hooks";
import { SetListPreview } from "../shared";
import type { SetListItem } from "../types";

export function PrintPreviewDialog({
  copyListText,
  defaultTransitionSeconds,
  event,
  items,
  music,
  onClose,
  open,
  showNotes = false,
  venues,
}: {
  readonly copyListText: () => Promise<boolean>;
  readonly defaultTransitionSeconds?: number | undefined;
  readonly event: OrganizationEvent | null;
  readonly items: readonly SetListItem[];
  readonly music: SetListManagerModel["resources"]["music"];
  readonly onClose: () => void;
  readonly open: boolean;
  readonly showNotes?: boolean;
  readonly venues?: SetListManagerModel["resources"]["venues"] | undefined;
}) {
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  function handleClose(): void {
    setCopied(false);
    if (copyTimeoutRef.current !== null) {
      window.clearTimeout(copyTimeoutRef.current);
    }
    onClose();
  }

  if (!event) return null;

  async function handleCopy(): Promise<void> {
    const success = await copyListText();
    if (!success) return;
    setCopied(true);
    if (copyTimeoutRef.current !== null) {
      window.clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = window.setTimeout(() => {
      setCopied(false);
    }, 2000);
  }

  return (
    <Dialog onClose={handleClose} open={open} title="Printable Set List">
      <div className="set-list-preview-dialog">
        <SetListPreview
          defaultTransitionSeconds={defaultTransitionSeconds}
          event={event}
          items={items}
          music={music}
          showNotes={showNotes}
          venues={venues}
        />
        <div className="dialog__actions">
          <DialogClose asChild>
            <button className="button button--secondary" onClick={handleClose} type="button">
              Close
            </button>
          </DialogClose>
          <button
            className="button button--secondary"
            onClick={() => {
              void handleCopy();
            }}
            type="button"
          >
            {copied ? "✓ Copied!" : "Copy Plain Text"}
          </button>
          {copied ? (
            <span className="sr-only" role="status">
              Set list plain text copied to clipboard.
            </span>
          ) : null}
          <button
            className="button button--primary"
            onClick={() => {
              handleClose();
              window.setTimeout(() => {
                window.print();
              }, 0);
            }}
            type="button"
          >
            Print List
          </button>
        </div>
      </div>
    </Dialog>
  );
}
