export function OfflineStatusNotices({
  blockedFileId,
  currentFileId,
  onRetryPlayback,
  online,
  saveError,
}: {
  readonly blockedFileId: string | null;
  readonly currentFileId: string | undefined;
  readonly onRetryPlayback: () => void;
  readonly online: boolean;
  readonly saveError: boolean;
}) {
  const showOfflineBlocked = !online && blockedFileId !== null && blockedFileId === currentFileId;
  const showOnlinePlaybackError =
    online && blockedFileId !== null && blockedFileId === currentFileId;
  return (
    <>
      {showOfflineBlocked ? (
        <p className="notice notice--warning" role="status">
          This track isn&apos;t saved offline. Reconnect to download it.
        </p>
      ) : null}
      {showOnlinePlaybackError ? (
        <div className="notice notice--error" role="alert">
          <p>This track could not be played. Check your connection or audio source.</p>
          <button
            className="button button--secondary button--small mt-2"
            onClick={onRetryPlayback}
            type="button"
          >
            Retry audio
          </button>
        </div>
      ) : null}
      {saveError ? (
        <p className="notice notice--error" role="alert">
          This track couldn&apos;t be saved offline. Try again while online.
        </p>
      ) : null}
    </>
  );
}
