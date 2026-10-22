import { useEffect, useState } from "react";
import type {
  LoudnessFailure,
  OrganizationMusicPiece,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { Dialog, DialogClose } from "@choir/ui";
import { getOrganizationRosterConfiguration } from "../../auth/api";
import { MusicAudioTracks } from "../components/MusicCatalog/tracksAndBulkEdit";

export function LoudnessRecordingRepair({
  failure,
  pieces,
  onSaved,
  onClose,
}: {
  readonly failure: LoudnessFailure;
  readonly pieces: readonly OrganizationMusicPiece[];
  readonly onSaved: (piece: OrganizationMusicPiece) => void;
  readonly onClose: () => void;
}) {
  const [configuration, setConfiguration] = useState<OrganizationRosterConfiguration | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    getOrganizationRosterConfiguration(controller.signal)
      .then(setConfiguration)
      .catch((caught: unknown) => {
        if (!controller.signal.aborted)
          setError(
            caught instanceof Error ? caught.message : "Recording controls could not be loaded.",
          );
      });
    return () => {
      controller.abort();
    };
  }, []);
  return (
    <Dialog
      className="dialog--recording-repair"
      open
      onClose={onClose}
      title="Replace practice recording"
      description={`${failure.fileName}. File changes save immediately using the existing learning-track controls.`}
      footer={
        <DialogClose asChild>
          <button type="button" className="button button--secondary">
            Close
          </button>
        </DialogClose>
      }
    >
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {!configuration && !error ? <p role="status">Loading recording controls…</p> : null}
      {configuration
        ? pieces.map((piece) => (
            <MusicAudioTracks
              key={piece.id}
              configuration={configuration}
              piece={piece}
              onlyFileId={failure.fileId}
              onTrackDurationDetected={() => undefined}
              onSaved={(saved) => {
                onSaved(saved);
                onClose();
              }}
            />
          ))
        : null}
      {pieces.length === 0 ? (
        <p className="notice">
          This recording is no longer attached to a catalog piece. Refresh the library settings.
        </p>
      ) : null}
    </Dialog>
  );
}
