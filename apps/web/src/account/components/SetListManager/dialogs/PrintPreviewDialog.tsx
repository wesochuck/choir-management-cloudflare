import type { OrganizationEvent } from "@choir/contracts";
import { Dialog, DialogClose } from "@choir/ui";

import type { SetListManagerModel } from "../hooks";
import { SetListPreview } from "../shared";
import type { SetListItem } from "../types";

export function PrintPreviewDialog({
  copyListText,
  event,
  items,
  music,
  onClose,
  open,
  showNotes = false,
}: {
  readonly copyListText: () => Promise<void>;
  readonly event: OrganizationEvent | null;
  readonly items: readonly SetListItem[];
  readonly music: SetListManagerModel["resources"]["music"];
  readonly onClose: () => void;
  readonly open: boolean;
  readonly showNotes?: boolean;
}) {
  if (!event) return null;
  return (
    <Dialog onClose={onClose} open={open} title="Printable Set List">
      <div className="set-list-preview-dialog">
        <SetListPreview event={event} items={items} music={music} showNotes={showNotes} />
        <div className="dialog__actions">
          <DialogClose asChild>
            <button className="button button--secondary" type="button">
              Close
            </button>
          </DialogClose>
          <button
            className="button button--secondary"
            onClick={() => {
              void copyListText();
            }}
            type="button"
          >
            Copy Plain Text
          </button>
          <button
            className="button button--primary"
            onClick={() => {
              onClose();
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
