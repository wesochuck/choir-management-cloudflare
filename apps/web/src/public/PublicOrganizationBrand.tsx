import { useState } from "react";

export function PublicOrganizationBrand({
  href = "/",
  organizationName,
  publishedLogoUrl,
}: {
  readonly href?: string;
  readonly organizationName: string;
  readonly publishedLogoUrl?: string | null | undefined;
}) {
  const [currentSrc, setCurrentSrc] = useState<string | null>(
    () => publishedLogoUrl ?? "/api/public/logo",
  );

  return (
    <a className="public-site-brand" href={href}>
      {currentSrc ? (
        <img
          alt=""
          aria-hidden="true"
          onError={() => {
            if (currentSrc !== "/api/public/logo") {
              setCurrentSrc("/api/public/logo");
            } else {
              setCurrentSrc(null);
            }
          }}
          src={currentSrc}
        />
      ) : null}
      <span>{organizationName}</span>
    </a>
  );
}
