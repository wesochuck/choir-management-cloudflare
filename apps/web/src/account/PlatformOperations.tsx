import { PlatformDeadLetterWorkspace } from "./components/PlatformOperations/DeadLetterWorkspace";
import { OrganizationDirectory } from "./components/PlatformOperations/OrganizationDirectory";
import { OrganizationElevation } from "./components/PlatformOperations/OrganizationElevation";
import {
  AccessUnavailable,
  DeadLettersUnavailable,
  OrganizationsUnavailable,
} from "./components/PlatformOperations/Unavailable";
import type { PlatformOperationsMode, PlatformScope } from "./components/PlatformOperations/shared";

export type { PlatformOperationsMode } from "./components/PlatformOperations/shared";

export function PlatformOperations({
  mode,
  scope,
}: {
  readonly mode: PlatformOperationsMode;
  readonly scope: PlatformScope;
}) {
  if (mode === "organizations") {
    return scope.kind === "product_base" ? <OrganizationDirectory /> : <OrganizationsUnavailable />;
  }
  if (mode === "dead-letters") {
    return scope.kind === "product_base" ? (
      <PlatformDeadLetterWorkspace />
    ) : (
      <DeadLettersUnavailable />
    );
  }
  return scope.kind === "organization" ? (
    <OrganizationElevation organizationId={scope.organizationId} />
  ) : (
    <AccessUnavailable />
  );
}
