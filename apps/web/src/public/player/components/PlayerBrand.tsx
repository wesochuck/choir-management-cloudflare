import { useState } from "react";

function getOrganizationInitials(name?: string): string {
  if (!name) return "";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function PlayerBrand({
  organizationName,
}: {
  readonly organizationName?: string | undefined;
}) {
  const [logoFailed, setLogoFailed] = useState(false);

  if (!organizationName) {
    return null;
  }

  const initials = getOrganizationInitials(organizationName);

  return (
    <header aria-label="Organization" className="public-player__brand">
      {!logoFailed ? (
        <img
          alt=""
          className="public-player__brand-logo"
          onError={() => {
            setLogoFailed(true);
          }}
          src="/api/public/logo"
        />
      ) : initials ? (
        <span aria-hidden="true" className="public-player__brand-mark">
          {initials}
        </span>
      ) : null}
      <span>{organizationName}</span>
    </header>
  );
}
