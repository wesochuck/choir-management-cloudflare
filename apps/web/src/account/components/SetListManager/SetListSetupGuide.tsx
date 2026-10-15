import { AppLink } from "../AuthenticatedShell/navigation";

export function SetListSetupGuide({
  busy,
  dirty,
  navigate,
  onSave,
  selectedEventId,
}: {
  readonly busy?: boolean | undefined;
  readonly dirty?: boolean | undefined;
  readonly navigate?: ((href: string) => void) | undefined;
  readonly onSave?: (() => Promise<boolean>) | undefined;
  readonly selectedEventId?: string | undefined;
}) {
  const returnToPath = selectedEventId
    ? `/admin/setlists?eventId=${encodeURIComponent(selectedEventId)}`
    : "/admin/setlists";
  const setupHref = `/admin/events?${new URLSearchParams({
    type: "Performance",
    returnTo: returnToPath,
  }).toString()}`;

  async function handleNavigate(href: string): Promise<void> {
    if ((dirty || busy) && onSave) {
      const saved = await onSave();
      if (!saved) return;
    }
    if (navigate) {
      navigate(href);
    } else {
      window.location.assign(href);
    }
  }

  return (
    <aside aria-label="Set list setup guidance" className="setlist-setup-guide">
      <div className="setlist-setup-guide__main">
        <div aria-hidden="true" className="setlist-setup-guide__icon">
          <svg
            fill="none"
            height="24"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            width="24"
          >
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        </div>
        <div className="setlist-setup-guide__body">
          <h2 className="setlist-setup-guide__title">Need a set list for a new performance?</h2>
          <p className="setlist-setup-guide__description">
            Set lists belong to active Performance events created in <strong>Events</strong>. Once
            added, song orders and practice players are managed here.
          </p>
        </div>
      </div>
      <div className="setlist-setup-guide__actions">
        <AppLink
          className="button button--secondary setlist-setup-guide__action"
          href={setupHref}
          onNavigate={(href) => {
            void handleNavigate(href);
          }}
        >
          Manage Performances →
        </AppLink>
      </div>
    </aside>
  );
}
