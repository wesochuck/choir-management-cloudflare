import { useEffect, useState } from "react";
import { organizationFeatureGroups } from "./registry";
import { getAdminFeatureForPath } from "./selectors";
import type { OrganizationGroupId } from "./types";

const validIds = new Set<string>(organizationFeatureGroups.map((group) => group.id));
export function organizationNavigationKey(hostname: string, kind: "groups" | "compact"): string {
  return `choir-organization-navigation:v1:${hostname}:organization:${kind}`;
}
function readExpanded(hostname: string): readonly OrganizationGroupId[] {
  try {
    const raw: unknown = JSON.parse(
      window.localStorage.getItem(organizationNavigationKey(hostname, "groups")) ?? "null",
    );
    if (Array.isArray(raw))
      return raw.filter(
        (id): id is OrganizationGroupId => typeof id === "string" && validIds.has(id),
      );
  } catch {
    /* Restricted or invalid storage uses safe defaults. */
  }
  return ["people"];
}
function readCompact(hostname: string): boolean {
  try {
    return window.localStorage.getItem(organizationNavigationKey(hostname, "compact")) === "true";
  } catch {
    return false;
  }
}
function revealRoute(
  expanded: readonly OrganizationGroupId[],
  path: string,
): readonly OrganizationGroupId[] {
  const group = getAdminFeatureForPath(path)?.groupId;
  return group && group !== "home" && !expanded.includes(group) ? [...expanded, group] : expanded;
}
export function useOrganizationNavigationPreferences(hostname: string, routeKey: string) {
  const [state, setState] = useState(() => ({
    hostname,
    routeKey,
    expanded: revealRoute(readExpanded(hostname), routeKey),
    compact: readCompact(hostname),
  }));
  if (state.hostname !== hostname)
    setState({
      hostname,
      routeKey,
      expanded: revealRoute(readExpanded(hostname), routeKey),
      compact: readCompact(hostname),
    });
  else if (state.routeKey !== routeKey)
    setState({ ...state, routeKey, expanded: revealRoute(state.expanded, routeKey) });
  useEffect(() => {
    try {
      window.localStorage.setItem(
        organizationNavigationKey(hostname, "groups"),
        JSON.stringify(state.expanded),
      );
      window.localStorage.setItem(
        organizationNavigationKey(hostname, "compact"),
        String(state.compact),
      );
    } catch {
      /* Navigation remains usable without browser storage. */
    }
  }, [hostname, state.expanded, state.compact]);
  return {
    expanded: state.expanded,
    compact: state.compact,
    toggleGroup: (id: OrganizationGroupId) => {
      setState((current) => ({
        ...current,
        expanded: current.expanded.includes(id)
          ? current.expanded.filter((value) => value !== id)
          : [...current.expanded, id],
      }));
    },
    toggleCompact: () => {
      setState((current) => ({ ...current, compact: !current.compact }));
    },
  };
}
