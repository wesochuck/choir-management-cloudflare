import type { OrganizationEventRequest } from "@choir/contracts";
import { TabsContent } from "@choir/ui";
import type { Dispatch, DragEvent, SetStateAction } from "react";

export function PublicSection({
  activeGraphicPreviewUrl,
  event,
  graphicDragging,
  graphicError,
  graphicFile,
  handleGraphicDrop,
  handleGraphicFile,
  handleRemoveGraphicFile,
  setEvent,
  setGraphicDragging,
  setGraphicError,
  tbdInfo,
}: {
  readonly activeGraphicPreviewUrl: string | null;
  readonly event: OrganizationEventRequest;
  readonly graphicDragging: boolean;
  readonly graphicError: string | null;
  readonly graphicFile: File | null;
  readonly handleGraphicDrop: (dropEvent: DragEvent<HTMLLabelElement>) => void;
  readonly handleGraphicFile: (nextFile: File | null) => void;
  readonly handleRemoveGraphicFile: () => void;
  readonly setEvent: Dispatch<SetStateAction<OrganizationEventRequest>>;
  readonly setGraphicDragging: (dragging: boolean) => void;
  readonly setGraphicError: (error: string | null) => void;
  readonly tbdInfo: { readonly isTbd: boolean };
}) {
  return (
    <TabsContent
      aria-labelledby="event-editor-public-tab"
      className="event-editor-panel"
      id="event-editor-public-panel"
      value="public"
    >
      <div className="event-editor-panel__header">
        <div className="event-editor-panel__title-row">
          <h3 className="event-editor-panel__title">Public content</h3>
          <span className="event-editor__badge event-editor__badge--optional">Optional</span>
        </div>
        <p className="event-editor-panel__description">
          Public description, graphic, and website visibility.
        </p>
      </div>
      <div className="field">
        <label htmlFor="events-page-public-details">Public details</label>
        <textarea
          id="events-page-public-details"
          maxLength={100000}
          onChange={(change) => {
            setEvent((current) => ({ ...current, publicDetails: change.target.value }));
          }}
          rows={3}
          value={event.publicDetails}
        />
      </div>
      <div className="field">
        <label
          className={`event-graphic-dropzone${graphicDragging ? " is-dragging" : ""}`}
          onDragEnter={(dragEvent) => {
            dragEvent.preventDefault();
            setGraphicDragging(true);
          }}
          onDragLeave={() => {
            setGraphicDragging(false);
          }}
          onDragOver={(dragEvent) => {
            dragEvent.preventDefault();
            dragEvent.dataTransfer.dropEffect = "copy";
            setGraphicDragging(true);
          }}
          onDrop={handleGraphicDrop}
        >
          <span className="event-graphic-dropzone__title">Public graphic</span>
          {activeGraphicPreviewUrl ? (
            <div className="event-graphic-dropzone__preview">
              <img
                alt="Public graphic preview"
                className="event-graphic-dropzone__image"
                src={activeGraphicPreviewUrl}
              />
            </div>
          ) : null}
          <span className="event-graphic-dropzone__label">
            {graphicFile ? (
              <>
                Selected: <strong>{graphicFile.name}</strong>
              </>
            ) : (
              <>
                Drag and drop an image here, or{" "}
                <span className="event-graphic-dropzone__browse">browse</span>
              </>
            )}
          </span>
          <span className="field-help">
            {event.publicGraphicFileId && !graphicFile
              ? "An image is already saved. Choose another image to replace it."
              : "PNG, JPG, or WebP images are supported."}
          </span>
          <input
            accept="image/jpeg,image/png,image/webp"
            aria-describedby={graphicError ? "event-graphic-error" : undefined}
            aria-invalid={Boolean(graphicError)}
            className="sr-only"
            id="events-page-graphic"
            onChange={(change) => {
              handleGraphicFile(change.target.files?.[0] ?? null);
              change.target.value = "";
            }}
            type="file"
          />
        </label>
        {graphicError ? (
          <p className="notice notice--error" id="event-graphic-error" role="alert">
            {graphicError}
          </p>
        ) : null}
        {graphicFile ? (
          <button className="text-button" onClick={handleRemoveGraphicFile} type="button">
            Remove selected image
          </button>
        ) : event.publicGraphicFileId ? (
          <button
            className="text-button"
            onClick={() => {
              setGraphicError(null);
              setEvent((current) => ({ ...current, publicGraphicFileId: null }));
            }}
            type="button"
          >
            Remove saved image
          </button>
        ) : null}
      </div>
      <label className="checkbox-row" htmlFor="events-page-publish">
        <input
          checked={event.publishOnWebsite}
          id="events-page-publish"
          onChange={(change) => {
            setEvent((current) => ({
              ...current,
              publishOnWebsite: change.target.checked,
            }));
          }}
          type="checkbox"
        />
        Publish on public website
      </label>
      {event.publishOnWebsite && tbdInfo.isTbd ? (
        <p className="notice notice--info" role="status">
          <strong>Publishing with TBD venue:</strong> the public page will show “TBD” without an
          address or map pin until the actual venue is assigned.
        </p>
      ) : null}
      {!event.publishOnWebsite ? (
        <p className="notice notice--info" role="status">
          This event will not appear on the public concert schedule until publishing is enabled.
        </p>
      ) : null}
    </TabsContent>
  );
}
