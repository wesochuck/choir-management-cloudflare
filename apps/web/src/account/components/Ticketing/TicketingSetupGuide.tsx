import { AppLink } from "../AuthenticatedShell/navigation";

export function TicketingSetupGuide({
  navigate,
}: {
  readonly navigate?: ((href: string) => void) | undefined;
}) {
  const returnToPath =
    typeof window !== "undefined" && window.location.pathname.startsWith("/admin/ticketing")
      ? "/admin/ticketing"
      : "/admin/tickets";
  const setupHref = `/admin/events?${new URLSearchParams({
    type: "Performance",
    returnTo: returnToPath,
  }).toString()}`;

  return (
    <aside aria-label="Ticket sales setup guidance" className="ticketing-setup-guide">
      <div className="ticketing-setup-guide__main">
        <div aria-hidden="true" className="ticketing-setup-guide__icon">
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
            <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
            <path d="M13 5v2" />
            <path d="M13 17v2" />
            <path d="M13 11v2" />
          </svg>
        </div>
        <div className="ticketing-setup-guide__body">
          <h2 className="ticketing-setup-guide__title">Want to sell tickets for a concert?</h2>
          <p className="ticketing-setup-guide__description">
            Ticket sales are configured when creating or editing a Performance in{" "}
            <strong>Events</strong>. Once enabled, purchases and check-in are managed here.
          </p>
        </div>
      </div>
      <div className="ticketing-setup-guide__actions">
        <AppLink
          className="button button--secondary ticketing-setup-guide__action"
          href={setupHref}
          onNavigate={
            navigate ??
            ((href) => {
              window.location.assign(href);
            })
          }
        >
          Set Up Ticket Sales →
        </AppLink>
      </div>
    </aside>
  );
}
