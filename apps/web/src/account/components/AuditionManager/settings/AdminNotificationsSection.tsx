import type { AuditionMigrationReview } from "@choir/contracts";
import { AppLink } from "../../AuthenticatedShell/navigation";

export function AdminNotificationsSection({
  migrationReviews = [],
}: {
  readonly migrationReviews?: readonly AuditionMigrationReview[];
}) {
  return (
    <fieldset className="surface-card organization-settings-panel form-stack">
      <legend>Audition notifications</legend>
      <p className="field-help">
        Audition inquiry notifications are sent to roster members who have “Audition notices”
        enabled in their Profile settings. Configure recipients on the{" "}
        <AppLink
          href="/admin/roster"
          onNavigate={(href) => {
            window.location.assign(href);
          }}
        >
          Roster
        </AppLink>{" "}
        page.
      </p>
      {migrationReviews.length > 0 ? (
        <div className="notice notice--warning form-stack" role="status">
          <p>
            <strong>Review migrated notification recipients:</strong> The following email addresses
            from previous settings could not be matched automatically to a single roster profile.
            Please review the roster to enable audition notices for these individuals:
          </p>
          <ul className="account-list">
            {migrationReviews.map((review) => (
              <li className="flex items-center justify-between gap-2" key={review.email}>
                <span>{review.email}</span>
                <span className="status-pill status-pill--warning">
                  {review.reason === "ambiguous" ? "Multiple profiles match" : "No profile match"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </fieldset>
  );
}
