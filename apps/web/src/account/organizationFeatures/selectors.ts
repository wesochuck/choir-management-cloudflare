import type { NavigationGroup } from "../components/AuthenticatedShell/types";
import type { CommandPaletteAction } from "../components/CommandPalette/types";
import { organizationFeatureIcons } from "./icons";
import {
  dashboardGroups,
  organizationFeatures,
  organizationPaletteShortcuts,
  organizationQuickActions,
  sidebarGroupLabels,
} from "./registry";
import type { OrganizationFeature, OrganizationFeatureContext } from "./types";

const byId = new Map(organizationFeatures.map((feature) => [feature.id, feature]));
const routeEntries = organizationFeatures
  .filter((feature) => !feature.href.includes("?"))
  .flatMap((feature) =>
    [feature.href, ...(feature.aliases ?? [])].map((path) => ({ path, feature })),
  )
  .toSorted((a, b) => b.path.length - a.path.length);

const contextualRoutes = organizationFeatures
  .filter((feature) => feature.href.includes("?"))
  .map((feature) => {
    const url = new URL(feature.href, "https://registry.invalid");
    return { feature, pathname: url.pathname, params: [...url.searchParams] };
  });

export function getAdminFeatureForPath(pathname: string): OrganizationFeature | undefined {
  const url = new URL(pathname, "https://registry.invalid");
  if (url.pathname === "/directory" && url.searchParams.get("from") !== "admin") return undefined;
  const contextual = contextualRoutes.find(
    (entry) =>
      entry.pathname === url.pathname &&
      entry.params.every(([key, value]) => url.searchParams.get(key) === value),
  );
  if (contextual) return contextual.feature;
  return routeEntries.find(
    ({ path }) =>
      url.pathname === path || (path !== "/admin" && url.pathname.startsWith(`${path}/`)),
  )?.feature;
}
export function isOrganizationFeatureEnabled(
  feature: Pick<OrganizationFeature, "requiredModule">,
  modules: OrganizationFeatureContext["modules"],
  context: Pick<OrganizationFeatureContext, "status">,
): boolean {
  return (
    feature.requiredModule === null ||
    (context.status === "ready" &&
      (modules.find((module) => module.id === feature.requiredModule)?.enabled ?? true))
  );
}
function eligible(feature: OrganizationFeature, context: OrganizationFeatureContext): boolean {
  return isOrganizationFeatureEnabled(feature, context.modules, context);
}
function copy(text: string, context: OrganizationFeatureContext): string {
  return text
    .replaceAll("{parts}", context.partLabelPlural ?? "Parts")
    .replaceAll("{performer}", context.performerLabel ?? "Performer")
    .replaceAll("{performers}", (context.performerLabelPlural ?? "Performers").toLowerCase());
}
export function getOrganizationSidebarGroups(
  context: OrganizationFeatureContext,
): readonly NavigationGroup[] {
  if (context.scopedReadOnly)
    return [{ label: "Organization", items: [{ href: "/admin", label: "Overview" }] }];
  return sidebarGroupLabels
    .map((label, group) => ({
      label,
      items: organizationFeatures
        .filter((f) => f.sidebar?.group === group && eligible(f, context))
        .toSorted((a, b) => (a.sidebar?.position ?? 0) - (b.sidebar?.position ?? 0))
        .map((f) => ({
          href: f.sidebar?.href ?? f.href,
          label: f.label,
          ...(f.requiredModule ? { module: f.requiredModule } : {}),
        })),
    }))
    .filter((g) => g.items.length > 0);
}
export function getOrganizationDashboardSections(context: OrganizationFeatureContext) {
  return dashboardGroups
    .map((group, index) => ({
      ...group,
      cards: organizationFeatures
        .filter((f) => f.dashboard?.group === index && eligible(f, context))
        .toSorted((a, b) => (a.dashboard?.position ?? 0) - (b.dashboard?.position ?? 0))
        .flatMap((f) =>
          f.dashboard
            ? [
                {
                  href: f.href,
                  icon: organizationFeatureIcons[f.iconId],
                  label: copy(f.dashboard.label, context),
                  description: copy(f.dashboard.description, context),
                  tone: f.dashboard.tone,
                },
              ]
            : [],
        ),
    }))
    .filter((g) => g.cards.length > 0);
}
export function getOrganizationQuickActions(context: OrganizationFeatureContext) {
  if (context.scopedReadOnly) return [];
  return organizationQuickActions
    .filter((action) => {
      const feature = byId.get(action.featureId);
      return feature && eligible(feature, context);
    })
    .map((action) => ({
      href: action.href,
      icon: organizationFeatureIcons[action.iconId],
      label: copy(action.label, context),
    }));
}
export function getOrganizationPaletteEntries(
  context: OrganizationFeatureContext,
): readonly CommandPaletteAction[] {
  if (context.scopedReadOnly) return [];
  const primary = organizationFeatures.flatMap((f) =>
    f.palette ? [{ ...f.palette, href: f.href, parentId: f.id }] : [],
  );
  return [...primary, ...organizationPaletteShortcuts]
    .toSorted((a, b) => a.position - b.position)
    .flatMap((entry) => {
      const feature = byId.get(entry.parentId);
      if (!feature || !eligible(feature, context) || (entry.ownerOnly && !context.isOwner))
        return [];
      return [
        {
          ...entry,
          title: copy(entry.title, context),
          subtitle: copy(entry.subtitle, context),
          ...(feature.requiredModule ? { requiredModule: feature.requiredModule } : {}),
        },
      ];
    });
}
