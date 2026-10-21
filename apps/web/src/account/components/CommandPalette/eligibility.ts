import {
  moduleIdSchema,
  type SearchResultItem,
  type SearchCategory,
  type ModuleId,
} from "@choir/contracts";
import {
  getAdminFeatureForPath,
  getOrganizationPaletteEntries,
  isOrganizationFeatureEnabled,
} from "../../organizationFeatures/selectors";
import type { OrganizationFeatureContext } from "../../organizationFeatures/types";
import { otherNavigationItems } from "./navigationIndex";
import type { CommandPaletteAction, CommandPaletteWorkspace, RecentItem } from "./types";

const entityModules: Partial<Record<SearchCategory, ModuleId>> = {
  music: "music_library",
  events: "events",
  roster: "roster",
  polls: "polls",
};
function staticAllowed(
  item: CommandPaletteAction,
  workspace: CommandPaletteWorkspace,
  isOwner: boolean,
  enabled: ReadonlySet<string>,
): boolean {
  if (!(item.workspaces ?? ["organization"]).includes(workspace)) return false;
  if (item.ownerOnly && !isOwner) return false;
  return workspace === "organization" || !item.requiredModule || enabled.has(item.requiredModule);
}
function organizationAllowed(
  item: SearchResultItem | RecentItem,
  context: OrganizationFeatureContext,
): boolean {
  if (context.scopedReadOnly) return item.id === "act-toggle-theme";
  const feature = item.href ? getAdminFeatureForPath(item.href) : undefined;
  if (feature && !isOrganizationFeatureEnabled(feature, context.modules, context)) return false;
  const requiredModule = entityModules[item.category];
  return (
    !requiredModule || isOrganizationFeatureEnabled({ requiredModule }, context.modules, context)
  );
}
export function paletteEligibility(
  workspace: CommandPaletteWorkspace,
  modules: readonly string[],
  isOwner: boolean,
  context?: OrganizationFeatureContext,
) {
  const effectiveContext: OrganizationFeatureContext = context
    ? { ...context, isOwner }
    : {
        modules: moduleIdSchema.options.map((id) => ({ id, enabled: modules.includes(id) })),
        status: "ready",
        isOwner,
      };
  const enabled = new Set(modules);
  const entries =
    workspace === "organization" ? getOrganizationPaletteEntries(effectiveContext) : [];
  const staticById = new Map([...entries, ...otherNavigationItems].map((item) => [item.id, item]));
  const allowed = (item: SearchResultItem | RecentItem): boolean => {
    const registered = staticById.get(item.id);
    if (registered) {
      if (!staticAllowed(registered, workspace, isOwner, enabled)) return false;
    } else if (/^(nav|set|act)-/.test(item.id)) return false;
    if (workspace === "organization") return organizationAllowed(item, effectiveContext);
    return !entityModules[item.category];
  };
  return {
    entries: [...entries, ...otherNavigationItems],
    allowed,
    resolveRecent: (item: RecentItem): RecentItem => {
      const current = staticById.get(item.id);
      return current
        ? { ...item, title: current.title, subtitle: current.subtitle, href: current.href }
        : item;
    },
  };
}
