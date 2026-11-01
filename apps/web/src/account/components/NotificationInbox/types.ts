import type { OrganizationNotification } from "@choir/contracts";

import type { OrganizationIconId } from "../../organizationFeatures/icons";

export function iconIdForKind(kind: OrganizationNotification["kind"]): OrganizationIconId {
  switch (kind) {
    case "audition":
      return "auditions";
    case "ticket_sale":
      return "ticketing";
    case "donation":
      return "donations";
  }
}

export function canAccessDestination(
  destinationPath: string | null | undefined,
  role: string | null | undefined,
): boolean {
  if (!destinationPath) return false;
  const isAdminOrOwner = role === "owner" || role === "administrator";
  if (destinationPath.startsWith("/admin/")) {
    return isAdminOrOwner;
  }
  return true;
}

export function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0 || !Number.isFinite(diffMs)) return "Just now";

  const diffSecs = Math.floor(diffMs / 1000);
  if (diffSecs < 60) return "Just now";

  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${String(diffMins)}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${String(diffHours)}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${String(diffDays)}d ago`;

  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}
