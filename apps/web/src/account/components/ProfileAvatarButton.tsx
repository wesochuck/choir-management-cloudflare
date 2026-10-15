import { getInitials } from "@choir/domain";
import { type MouseEvent, useState } from "react";

export interface ProfileAvatarButtonProps {
  readonly className?: string | undefined;
  readonly displayName: string;
  readonly onOpenViewer?: ((src: string) => void) | undefined;
  readonly photoFileId?: string | null | undefined;
  readonly photoSrc?: string | null | undefined;
  readonly size?: number | undefined;
}

export function ProfileAvatarButton({
  className = "",
  displayName,
  onOpenViewer,
  photoFileId,
  photoSrc,
  size = 32,
}: ProfileAvatarButtonProps) {
  const [loadFailed, setLoadFailed] = useState(false);

  const resolvedSrc =
    photoSrc ?? (photoFileId ? `/api/organization/files/${encodeURIComponent(photoFileId)}` : null);

  const hasPhoto = Boolean(resolvedSrc) && !loadFailed;
  const initials = getInitials(displayName) || displayName.slice(0, 1).toUpperCase() || "—";

  if (!hasPhoto || !resolvedSrc || !onOpenViewer) {
    return (
      <div
        aria-hidden="true"
        className={`profile-avatar-placeholder ${className}`.trim()}
        style={{ height: `${String(size)}px`, width: `${String(size)}px` }}
      >
        {initials}
      </div>
    );
  }

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (resolvedSrc && onOpenViewer) {
      onOpenViewer(resolvedSrc);
    }
  }

  return (
    <button
      aria-label={`View larger photo of ${displayName}`}
      className={`profile-avatar-button ${className}`.trim()}
      onClick={handleClick}
      style={{ height: `${String(size)}px`, width: `${String(size)}px` }}
      type="button"
    >
      <img
        alt=""
        loading="lazy"
        onError={() => {
          setLoadFailed(true);
        }}
        src={resolvedSrc}
      />
    </button>
  );
}
