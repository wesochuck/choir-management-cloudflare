import { Dialog, DialogClose } from "@choir/ui";

export interface ProfilePhotoViewerDialogProps {
  readonly displayName: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly photoSrc: string | null;
}

export function ProfilePhotoViewerDialog({
  displayName,
  isOpen,
  onClose,
  photoSrc,
}: ProfilePhotoViewerDialogProps) {
  if (!isOpen || !photoSrc) return null;

  return (
    <Dialog
      description={`Full-size profile photo of ${displayName}`}
      footer={
        <DialogClose asChild>
          <button className="button button--secondary" onClick={onClose} type="button">
            Close
          </button>
        </DialogClose>
      }
      onClose={onClose}
      open={isOpen}
      title={`${displayName}'s photo`}
    >
      <div className="profile-photo-viewer">
        <img
          alt={`Photo of ${displayName}`}
          className="profile-photo-viewer__image"
          src={photoSrc}
        />
      </div>
    </Dialog>
  );
}
