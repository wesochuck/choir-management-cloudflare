import type { OrganizationProfile } from "@choir/contracts";
import { getDirectoryListingReason, isProfileDirectoryListed } from "@choir/domain";
import { statusLabel } from "./utils";

export function RosterDeliveryStatus({ profile }: { readonly profile: OrganizationProfile }) {
  if (profile.providerEmailSuppressed) {
    return (
      <span
        className="status-pill status-pill--suppressed"
        title="Provider suppression is active. Contact a Platform Administrator to release local provider suppression after the address issue is resolved."
      >
        Email suppressed
      </span>
    );
  }
  if (profile.doNotEmail) {
    return (
      <span
        className="status-pill status-pill--warning"
        title={`Email delivery disabled${profile.bounceReason ? `: ${profile.bounceReason}` : ""}`}
      >
        Email blocked
      </span>
    );
  }
  return <span className="status-pill status-pill--success">Allowed</span>;
}

export function RosterCardMetadata({
  profile,
  partLabel,
}: {
  readonly profile: OrganizationProfile;
  readonly partLabel: string;
}) {
  return (
    <span className="roster-card-metadata">
      <span>
        <span className="sr-only">{partLabel}: </span>
        {profile.voicePart || "Not assigned"}
        <span aria-hidden="true"> · </span>
        <span className="sr-only">, Status: </span>
        {statusLabel(profile.globalStatus)}
      </span>
      {profile.hidden ? <span className="status-pill status-pill--hidden">Off roster</span> : null}
    </span>
  );
}

export function RosterCardDetails({
  profile,
  linked,
}: {
  readonly profile: OrganizationProfile;
  readonly linked: boolean;
}) {
  return (
    <details className="roster-card-details">
      <summary aria-label={`Details for ${profile.displayName}`}>Details</summary>
      <dl>
        <div>
          <dt>Login account</dt>
          <dd>{linked ? "Linked" : "Unlinked"}</dd>
        </div>
        <div>
          <dt>Delivery status</dt>
          <dd>
            <RosterDeliveryStatus profile={profile} />
          </dd>
        </div>
        <div>
          <dt>Directory listing</dt>
          <dd title={getDirectoryListingReason(profile) ?? undefined}>
            {isProfileDirectoryListed(profile) ? "Listed" : "Not listed"}
          </dd>
        </div>
      </dl>
    </details>
  );
}
