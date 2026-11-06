export function PlayerRosterInviteBanner({
  onDismiss,
  onSignUp,
  organizationName,
}: {
  readonly onDismiss: () => void;
  readonly onSignUp: () => void;
  readonly organizationName?: string | undefined;
}) {
  const trimmed = organizationName?.trim();
  const displayName = trimmed && trimmed.length > 0 ? trimmed : "your choir";

  return (
    <aside aria-label="Choir registration" className="public-player__invite-banner">
      <div className="public-player__invite-banner-body">
        <div aria-hidden="true" className="public-player__invite-banner-icon">
          <svg
            fill="none"
            height="20"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            width="20"
          >
            <path d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
          </svg>
        </div>
        <div className="public-player__invite-banner-text-block">
          <h2 className="public-player__invite-banner-heading">Singing with {displayName}?</h2>
          <p className="public-player__invite-banner-copy">
            Register for a free account to save your voice part preference across devices, view
            rehearsal schedules, and RSVP to concerts.
          </p>
        </div>
      </div>
      <div className="public-player__invite-banner-actions">
        <button
          className="button button--secondary public-player__invite-banner-dismiss"
          onClick={onDismiss}
          type="button"
        >
          Maybe later
        </button>
        <button
          className="button button--primary public-player__invite-banner-signup"
          onClick={onSignUp}
          type="button"
        >
          Sign Up
        </button>
      </div>
    </aside>
  );
}
