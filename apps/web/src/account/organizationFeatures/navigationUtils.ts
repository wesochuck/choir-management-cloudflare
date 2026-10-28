import type { NavigationGroup } from "../components/AuthenticatedShell/types";
import { getAdminFeatureForPath } from "./selectors";

export function activeHref(groups: readonly NavigationGroup[], path: string): string | undefined {
  const feature = getAdminFeatureForPath(path);
  const targetPath = feature?.href.split("?")[0] ?? path.split("?")[0] ?? path;
  // Patrons is a contextual Donations destination without its own sidebar link.
  const canonical = targetPath === "/admin/patrons" ? "/admin/donations" : targetPath;
  return groups
    .flatMap((g) => g.items)
    .filter((item) => {
      const target = item.href.split("?")[0];
      return (
        target === canonical ||
        (target && target !== "/admin" && canonical.startsWith(`${target}/`))
      );
    })
    .toSorted((a, b) => b.href.length - a.href.length)[0]?.href;
}
