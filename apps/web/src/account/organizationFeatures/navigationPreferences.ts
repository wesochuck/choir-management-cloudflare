import { useEffect, useState } from "react";
import { organizationFeatureGroups } from "./registry";
import { getAdminFeatureForPath } from "./selectors";
import type { OrganizationGroupId } from "./types";

export type NavigationWorkspace = "organization" | "member";

const validOrganizationIds = new Set<string>(organizationFeatureGroups.map((group) => group.id));
const validMemberIds = new Set<string>(["people", "music"]);

const memberPeoplePrefixes = ["/schedule", "/profile", "/directory", "/dues"];
const memberMusicPrefixes = ["/practice", "/member/resources"];

export function navigationStorageKey(
  hostname: string,
  workspace: NavigationWorkspace,
  kind: "groups" | "compact",
): string {
  return `choir-organization-navigation:v1:${hostname}:${workspace}:${kind}`;
}

export function organizationNavigationKey(
  hostname: string,
  kind: "groups" | "compact",
  workspace: NavigationWorkspace = "organization",
): string {
  return navigationStorageKey(hostname, workspace, kind);
}

export function readCompact(
  hostname: string,
  workspace: NavigationWorkspace = "organization",
): boolean {
  try {
    const key = navigationStorageKey(hostname, workspace, "compact");
    const raw = window.localStorage.getItem(key);
    if (raw !== null) {
      return raw === "true";
    }
    // Reconcile legacy choir-sidebar-pinned:<hostname> === "false"
    const legacyPinned = window.localStorage.getItem(`choir-sidebar-pinned:${hostname}`);
    if (legacyPinned === "false") {
      return true;
    }
  } catch {
    /* Restricted or invalid storage uses safe defaults. */
  }
  return false;
}

function readExpanded<TGroup extends string>(
  hostname: string,
  workspace: NavigationWorkspace,
  validIds: Set<string>,
  fallback: readonly TGroup[],
): readonly TGroup[] {
  try {
    const raw: unknown = JSON.parse(
      window.localStorage.getItem(navigationStorageKey(hostname, workspace, "groups")) ?? "null",
    );
    if (Array.isArray(raw)) {
      return raw.filter((id): id is TGroup => typeof id === "string" && validIds.has(id));
    }
  } catch {
    /* Restricted or invalid storage uses safe defaults. */
  }
  return fallback;
}

function revealMemberRoute(expanded: readonly string[], path: string): readonly string[] {
  const normalized = path.split("?")[0] ?? path;
  const isPeople = memberPeoplePrefixes.some(
    (p) => normalized === p || normalized.startsWith(`${p}/`),
  );
  const isMusic = memberMusicPrefixes.some(
    (p) => normalized === p || normalized.startsWith(`${p}/`),
  );
  const targetGroup = isPeople ? "people" : isMusic ? "music" : undefined;
  return targetGroup && !expanded.includes(targetGroup) ? [...expanded, targetGroup] : expanded;
}

function revealAdminRoute(
  expanded: readonly OrganizationGroupId[],
  path: string,
): readonly OrganizationGroupId[] {
  const group = getAdminFeatureForPath(path)?.groupId;
  return group && group !== "home" && !expanded.includes(group) ? [...expanded, group] : expanded;
}

function revealStringAdminRoute(expanded: readonly string[], path: string): readonly string[] {
  const group = getAdminFeatureForPath(path)?.groupId;
  return group && group !== "home" && !expanded.includes(group) ? [...expanded, group] : expanded;
}

function revealRoute(
  expanded: readonly string[],
  path: string,
  workspace: NavigationWorkspace,
): readonly string[] {
  return workspace === "member"
    ? revealMemberRoute(expanded, path)
    : revealStringAdminRoute(expanded, path);
}

export function useWorkspaceNavigationPreferences(
  hostname: string,
  routeKey: string,
  workspace: NavigationWorkspace = "organization",
) {
  const [state, setState] = useState(() => {
    const initialExpanded = readExpanded(
      hostname,
      workspace,
      workspace === "member" ? validMemberIds : validOrganizationIds,
      workspace === "member" ? ["people", "music"] : ["people"],
    );
    return {
      hostname,
      routeKey,
      workspace,
      expanded: revealRoute(initialExpanded, routeKey, workspace),
      compact: readCompact(hostname, workspace),
    };
  });

  if (state.hostname !== hostname || state.workspace !== workspace) {
    const nextExpanded = readExpanded(
      hostname,
      workspace,
      workspace === "member" ? validMemberIds : validOrganizationIds,
      workspace === "member" ? ["people", "music"] : ["people"],
    );
    setState({
      hostname,
      routeKey,
      workspace,
      expanded: revealRoute(nextExpanded, routeKey, workspace),
      compact: readCompact(hostname, workspace),
    });
  } else if (state.routeKey !== routeKey) {
    setState({
      ...state,
      routeKey,
      expanded: revealRoute(state.expanded, routeKey, workspace),
    });
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(
        navigationStorageKey(hostname, workspace, "groups"),
        JSON.stringify(state.expanded),
      );
      window.localStorage.setItem(
        navigationStorageKey(hostname, workspace, "compact"),
        String(state.compact),
      );
    } catch {
      /* Navigation remains usable without browser storage. */
    }
  }, [hostname, workspace, state.expanded, state.compact]);

  return {
    expanded: state.expanded,
    compact: state.compact,
    toggleGroup: (id: string) => {
      setState((current) => ({
        ...current,
        expanded: current.expanded.includes(id)
          ? current.expanded.filter((value) => value !== id)
          : [...current.expanded, id],
      }));
    },
    expandGroup: (id: string) => {
      setState((current) => ({
        ...current,
        compact: false,
        expanded: current.expanded.includes(id) ? current.expanded : [...current.expanded, id],
      }));
    },
    setCompact: (compact: boolean) => {
      setState((current) => ({ ...current, compact }));
    },
    toggleCompact: () => {
      setState((current) => ({ ...current, compact: !current.compact }));
    },
  };
}

export function useOrganizationNavigationPreferences(
  hostname: string,
  routeKey: string,
  workspace: NavigationWorkspace = "organization",
) {
  const [state, setState] = useState(() => {
    const initialExpanded = readExpanded<OrganizationGroupId>(
      hostname,
      workspace,
      validOrganizationIds,
      ["people"],
    );
    return {
      hostname,
      routeKey,
      workspace,
      expanded: revealAdminRoute(initialExpanded, routeKey),
      compact: readCompact(hostname, workspace),
    };
  });

  if (state.hostname !== hostname || state.workspace !== workspace) {
    const nextExpanded = readExpanded<OrganizationGroupId>(
      hostname,
      workspace,
      validOrganizationIds,
      ["people"],
    );
    setState({
      hostname,
      routeKey,
      workspace,
      expanded: revealAdminRoute(nextExpanded, routeKey),
      compact: readCompact(hostname, workspace),
    });
  } else if (state.routeKey !== routeKey) {
    setState({
      ...state,
      routeKey,
      expanded: revealAdminRoute(state.expanded, routeKey),
    });
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(
        navigationStorageKey(hostname, workspace, "groups"),
        JSON.stringify(state.expanded),
      );
      window.localStorage.setItem(
        navigationStorageKey(hostname, workspace, "compact"),
        String(state.compact),
      );
    } catch {
      /* Navigation remains usable without browser storage. */
    }
  }, [hostname, workspace, state.expanded, state.compact]);

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
    expandGroup: (id: OrganizationGroupId) => {
      setState((current) => ({
        ...current,
        compact: false,
        expanded: current.expanded.includes(id) ? current.expanded : [...current.expanded, id],
      }));
    },
    setCompact: (compact: boolean) => {
      setState((current) => ({ ...current, compact }));
    },
    toggleCompact: () => {
      setState((current) => ({ ...current, compact: !current.compact }));
    },
  };
}
