import { organizationFeatureIcons, type OrganizationIconId } from "./icons";
export function OrganizationFeatureIcon({
  iconId,
  className,
}: {
  readonly iconId: OrganizationIconId;
  readonly className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      data-feature-icon={iconId}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={organizationFeatureIcons[iconId]} />
    </svg>
  );
}
