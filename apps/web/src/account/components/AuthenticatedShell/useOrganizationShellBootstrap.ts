import type {
  CurrentAuthSession,
  ModuleState,
  OrganizationImpersonationStatusResponse,
  PlatformMfaStatusResponse,
} from "@choir/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  AuthApiError,
  getOrganizationAuthStatus,
  getOrganizationBranding,
  getOrganizationImpersonationStatus,
  getOrganizationRosterConfiguration,
  getPlatformMfaStatus,
  getPlatformOrganizationContext,
  stopOrganizationImpersonation,
} from "../../../api";
import { isOrganizationHost, type PostSignInBootstrap } from "../../../auth/postSignIn";
import { purgeCachedPlayerMetadata, purgeOfflineAudioForSource } from "../../../offline/mediaStore";
import {
  clearAuthenticatedLayoutMetadata,
  readAuthenticatedLayoutMetadata,
  updateAuthenticatedLayoutMetadata,
} from "../../layoutMetadataCache";
import { getOrganizationSidebarGroups } from "../../organizationFeatures/selectors";
import { useOrganizationModuleState } from "../../organizationFeatures/useOrganizationModuleState";
import { normalizeOrganizationTerminology } from "../../organizationTerminologyUtils";
import type { NavigateFn } from "./hooks";
import type { AccessState, Workspace } from "./types";
import { visibleMemberNavigationGroups } from "./utils";
import { availableWorkspaces, organizationDisplayName } from "./workspacesUtils";

type CachedLayoutMetadata = ReturnType<typeof readAuthenticatedLayoutMetadata>;

function isExpectedAccessFailure(error: unknown): boolean {
  return error instanceof AuthApiError && [401, 403, 404].includes(error.status);
}

function isScopedPlatformOverview(access: AccessState): boolean {
  if (access.status === "platform-scoped") return true;
  return (
    access.status === "ready" && access.context.role === "member" && Boolean(access.platformContext)
  );
}

function canManageOrganization(access: AccessState, scopedPlatformOverview: boolean): boolean {
  return (access.status === "ready" && access.context.role !== "member") || scopedPlatformOverview;
}

function isOrganizationAccessEnabled(access: AccessState): boolean {
  if (access.status !== "ready") return false;
  return (
    !access.context.mfaRequired ||
    access.context.mfaSatisfied ||
    Boolean(access.context.mfaVerifiedUntil)
  );
}

function canOpenCommandPalette(selectedWorkspace: Workspace, access: AccessState): boolean {
  return (
    selectedWorkspace !== "member" &&
    (access.status === "ready" || access.status === "platform-scoped")
  );
}

function resolveEffectiveAccess(access: AccessState, modules: readonly ModuleState[]): AccessState {
  return access.status === "ready" || access.status === "platform-scoped"
    ? { ...access, modules }
    : access;
}

function resolveBootstrap(
  shellBootstrap: PostSignInBootstrap | null,
  host: string,
  userId: string,
): PostSignInBootstrap | null {
  return shellBootstrap?.host === host && shellBootstrap.userId === userId ? shellBootstrap : null;
}

function resolveInitialModules(
  bootstrap: PostSignInBootstrap | null,
  cachedLayout: CachedLayoutMetadata,
): readonly ModuleState[] | undefined {
  return bootstrap?.modules ?? cachedLayout?.modules ?? undefined;
}

function resolveInitialAccess(
  bootstrap: PostSignInBootstrap | null,
  cachedLayout: CachedLayoutMetadata,
  initialOrganizationName: string | null,
): AccessState {
  if (!bootstrap) return { status: "loading" };
  return {
    context: bootstrap.organizationAuthStatus,
    modules: bootstrap.modules ?? cachedLayout?.modules ?? [],
    organizationName: initialOrganizationName ?? cachedLayout?.organizationName ?? null,
    status: "ready",
  };
}

function resolveBranding(
  loadedBranding: { readonly logoFileId: string | null; readonly organizationName: string } | null,
  initialOrganizationName: string | null,
  initialLogoFileId: string | null,
  cachedLayout: CachedLayoutMetadata,
): { readonly logoFileId: string | null; readonly organizationName: string } | null {
  if (loadedBranding) return loadedBranding;
  const organizationName = initialOrganizationName ?? cachedLayout?.organizationName ?? null;
  const logoFileId = initialLogoFileId ?? cachedLayout?.logoFileId ?? null;
  return organizationName || logoFileId
    ? { logoFileId, organizationName: organizationName ?? "" }
    : null;
}

function resolveActiveOrgName(
  branding: { readonly organizationName: string } | null,
  access: AccessState,
): string | null {
  if (branding?.organizationName) return branding.organizationName;
  return access.status === "ready" || access.status === "platform-scoped"
    ? access.organizationName
    : null;
}

function useShellAccessEffects({
  accessStatus,
  baseHostname,
  baseHostnameResolved,
  bootstrap,
  cachedOrganizationName,
  host,
  initialLogoFileId,
  initialModules,
  initialOrganizationName,
  initialPlatformMfaStatus,
  isOrganization,
  moduleSnapshot,
  routePathname,
  selectedWorkspace,
  setAccess,
  setLoadedBranding,
  setOrganizationPerformerLabel,
  setPlatformMfaStatus,
  setPlatformStatus,
  setRosterStructure,
  userId,
}: {
  readonly accessStatus: AccessState["status"];
  readonly baseHostname: string | null;
  readonly baseHostnameResolved: boolean;
  readonly bootstrap: PostSignInBootstrap | null;
  readonly cachedOrganizationName: string | null;
  readonly host: string;
  readonly initialLogoFileId: string | null;
  readonly initialModules: readonly ModuleState[] | undefined;
  readonly initialOrganizationName: string | null;
  readonly initialPlatformMfaStatus: PlatformMfaStatusResponse | null;
  readonly isOrganization: boolean;
  readonly moduleSnapshot: {
    readonly modules: readonly ModuleState[];
    readonly status: "loading" | "ready" | "error";
  };
  readonly routePathname: string;
  readonly selectedWorkspace: Workspace;
  readonly setAccess: Dispatch<SetStateAction<AccessState>>;
  readonly setLoadedBranding: Dispatch<
    SetStateAction<{
      readonly logoFileId: string | null;
      readonly organizationName: string;
    } | null>
  >;
  readonly setOrganizationPerformerLabel: Dispatch<SetStateAction<string>>;
  readonly setPlatformMfaStatus: Dispatch<SetStateAction<PlatformMfaStatusResponse | null>>;
  readonly setPlatformStatus: Dispatch<SetStateAction<"loading" | "ready" | "error">>;
  readonly setRosterStructure: Dispatch<SetStateAction<"sections_only" | "sections_with_parts">>;
  readonly userId: string;
}) {
  useEffect(() => {
    if (!baseHostnameResolved) return;
    const controller = new AbortController();
    const platformStatusPromise = (
      initialPlatformMfaStatus
        ? Promise.resolve(initialPlatformMfaStatus)
        : getPlatformMfaStatus(controller.signal)
    )
      .then((status) => {
        if (!controller.signal.aborted) {
          setPlatformMfaStatus(status);
          setPlatformStatus("ready");
        }
        return status;
      })
      .catch(() => {
        if (!controller.signal.aborted) setPlatformStatus("error");
        return null;
      });

    if (!isOrganization) {
      void platformStatusPromise.then((status) => {
        if (!controller.signal.aborted) {
          setAccess({ status: "none" });
          if (!status) setPlatformStatus("error");
        }
      });
      return () => {
        controller.abort();
      };
    }

    const organizationStatusPromise = bootstrap
      ? Promise.resolve(bootstrap.organizationAuthStatus)
      : getOrganizationAuthStatus(controller.signal).catch((error: unknown) => {
          if (isExpectedAccessFailure(error)) return null;
          throw error;
        });

    void organizationStatusPromise
      .then((context) => {
        if (controller.signal.aborted) return;
        if (context) {
          setAccess({
            context,
            modules: initialModules ?? [],
            organizationName: initialOrganizationName ?? cachedOrganizationName,
            status: "ready",
          });
          return;
        }
        void platformStatusPromise.then((status) => {
          if (controller.signal.aborted) return;
          if (!status) {
            setAccess({ status: "error" });
            return;
          }
          if (!status.activePlatformAdministrator) {
            setAccess({ status: "none" });
            return;
          }
          void getPlatformOrganizationContext(controller.signal)
            .then((platformContext) => {
              if (controller.signal.aborted) return;
              setAccess({
                modules: initialModules ?? [],
                organizationName: initialOrganizationName ?? cachedOrganizationName,
                platformContext,
                status: "platform-scoped",
              });
            })
            .catch((error: unknown) => {
              if (controller.signal.aborted) return;
              setAccess({ status: isExpectedAccessFailure(error) ? "none" : "error" });
            });
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setAccess({ status: "error" });
      });

    return () => {
      controller.abort();
    };
  }, [
    baseHostnameResolved,
    bootstrap,
    cachedOrganizationName,
    initialModules,
    initialOrganizationName,
    initialPlatformMfaStatus,
    isOrganization,
    setAccess,
    setPlatformMfaStatus,
    setPlatformStatus,
  ]);

  useEffect(() => {
    if (accessStatus !== "none" || !isOrganization) return;
    clearAuthenticatedLayoutMetadata(host, userId);
    void Promise.allSettled([
      purgeOfflineAudioForSource(host, "session"),
      purgeCachedPlayerMetadata(host),
    ]);
  }, [accessStatus, host, isOrganization, userId]);

  useEffect(() => {
    if (!isOrganization || moduleSnapshot.status !== "ready") return;
    updateAuthenticatedLayoutMetadata(host, userId, {
      modules: [...moduleSnapshot.modules],
    });
  }, [host, isOrganization, moduleSnapshot, userId]);

  useEffect(() => {
    if (!isOrganization || (!initialOrganizationName && !initialLogoFileId)) return;
    updateAuthenticatedLayoutMetadata(host, userId, {
      ...(initialLogoFileId ? { logoFileId: initialLogoFileId } : {}),
      ...(initialOrganizationName ? { organizationName: initialOrganizationName } : {}),
    });
  }, [host, initialLogoFileId, initialOrganizationName, isOrganization, userId]);

  useEffect(() => {
    if (
      selectedWorkspace !== "platform" ||
      routePathname === "/platform/access" ||
      baseHostname === null
    )
      return;
    if (window.location.hostname !== baseHostname) {
      window.location.replace(`https://${baseHostname}/platform`);
    }
  }, [baseHostname, routePathname, selectedWorkspace]);

  useEffect(() => {
    if (!isOrganization) return;
    const controller = new AbortController();
    getOrganizationRosterConfiguration(controller.signal)
      .then((configuration) => {
        if (!controller.signal.aborted) {
          setOrganizationPerformerLabel(configuration.performerLabel);
          const structure = configuration.rosterStructure ?? "sections_with_parts";
          setRosterStructure(structure);
          updateAuthenticatedLayoutMetadata(host, userId, {
            performerLabel: configuration.performerLabel,
            rosterStructure: structure,
          });
        }
      })
      .catch(() => {
        // Account and Platform workspaces do not have an Organization roster to load.
      });
    getOrganizationBranding(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setLoadedBranding(data);
          updateAuthenticatedLayoutMetadata(host, userId, {
            logoFileId: data.logoFileId,
            organizationName: data.organizationName,
          });
        }
      })
      .catch(() => {
        // Branding is optional / unavailable on Account or Platform workspaces.
      });
    return () => {
      controller.abort();
    };
  }, [
    host,
    isOrganization,
    setLoadedBranding,
    setOrganizationPerformerLabel,
    setRosterStructure,
    userId,
  ]);
}

export function useOrganizationShellBootstrap({
  baseHostname,
  baseHostnameResolved,
  currentSession,
  initialLogoFileId,
  initialOrganizationName,
  initialPlatformMfaStatus,
  navigate,
  routePathname,
  selectedWorkspace,
  shellBootstrap,
}: {
  readonly baseHostname: string | null;
  readonly baseHostnameResolved: boolean;
  readonly currentSession: NonNullable<CurrentAuthSession>;
  readonly initialLogoFileId: string | null;
  readonly initialOrganizationName: string | null;
  readonly initialPlatformMfaStatus: PlatformMfaStatusResponse | null;
  readonly navigate: NavigateFn;
  readonly routePathname: string;
  readonly selectedWorkspace: Workspace;
  readonly shellBootstrap: PostSignInBootstrap | null;
}) {
  const host = window.location.host;
  const userId = currentSession.user.id;
  const identity = `${host}:${userId}`;
  const isOrganization =
    baseHostnameResolved && isOrganizationHost(window.location.hostname, baseHostname);
  const bootstrap = resolveBootstrap(shellBootstrap, host, userId);
  const [cachedLayout] = useState(() => readAuthenticatedLayoutMetadata(host, userId));
  const initialModules = resolveInitialModules(bootstrap, cachedLayout);
  const hasPrewarmedModules = bootstrap !== null && bootstrap.modules !== null;
  const moduleController = useOrganizationModuleState(
    identity,
    initialModules,
    isOrganization,
    !hasPrewarmedModules,
  );
  const [access, setAccess] = useState<AccessState>(() =>
    resolveInitialAccess(bootstrap, cachedLayout, initialOrganizationName),
  );
  const [platformMfaStatus, setPlatformMfaStatus] = useState<PlatformMfaStatusResponse | null>(
    initialPlatformMfaStatus,
  );
  const [platformStatus, setPlatformStatus] = useState<"loading" | "ready" | "error">(
    initialPlatformMfaStatus ? "ready" : "loading",
  );
  const platformAvailable = platformMfaStatus?.activePlatformAdministrator ?? false;
  const [rosterStructure, setRosterStructure] = useState<"sections_only" | "sections_with_parts">(
    cachedLayout?.rosterStructure ?? "sections_with_parts",
  );
  const [organizationPerformerLabel, setOrganizationPerformerLabel] = useState(
    cachedLayout?.performerLabel ?? "Performer",
  );
  const [loadedBranding, setLoadedBranding] = useState<{
    readonly logoFileId: string | null;
    readonly organizationName: string;
  } | null>(null);
  const branding = useMemo(
    () => resolveBranding(loadedBranding, initialOrganizationName, initialLogoFileId, cachedLayout),
    [cachedLayout, initialLogoFileId, initialOrganizationName, loadedBranding],
  );
  const [impersonation, setImpersonation] =
    useState<OrganizationImpersonationStatusResponse | null>(null);

  useEffect(() => {
    if (!isOrganization) return;
    const controller = new AbortController();
    getOrganizationImpersonationStatus(controller.signal)
      .then((status) => {
        setImpersonation(status.active ? status : null);
      })
      .catch(() => {
        setImpersonation(null);
      });
    return () => {
      controller.abort();
    };
  }, [isOrganization, routePathname]);

  const handleExitImpersonation = useCallback(async () => {
    try {
      await stopOrganizationImpersonation();
    } finally {
      setImpersonation(null);
      void navigate("/admin/roster");
    }
  }, [navigate]);

  useShellAccessEffects({
    accessStatus: access.status,
    baseHostname,
    baseHostnameResolved,
    bootstrap,
    cachedOrganizationName: cachedLayout?.organizationName ?? null,
    host,
    initialLogoFileId,
    initialModules,
    initialOrganizationName,
    initialPlatformMfaStatus,
    isOrganization,
    moduleSnapshot: moduleController.snapshot,
    routePathname,
    selectedWorkspace,
    setAccess,
    setLoadedBranding,
    setOrganizationPerformerLabel,
    setPlatformMfaStatus,
    setPlatformStatus,
    setRosterStructure,
    userId,
  });

  const refreshPlatformStatus = useCallback(() => {
    const controller = new AbortController();
    setPlatformStatus("loading");
    void getPlatformMfaStatus(controller.signal)
      .then((status) => {
        setPlatformMfaStatus(status);
        setPlatformStatus("ready");
      })
      .catch(() => {
        setPlatformStatus("error");
      });
  }, []);

  const scopedPlatformOverview = useMemo(() => isScopedPlatformOverview(access), [access]);
  const canManage = canManageOrganization(access, scopedPlatformOverview);
  const memberEnabled = isOrganizationAccessEnabled(access);
  const modules = moduleController.snapshot.modules;
  const terminology = useMemo(
    () => normalizeOrganizationTerminology(organizationPerformerLabel, rosterStructure),
    [organizationPerformerLabel, rosterStructure],
  );
  const featureContext = useMemo(
    () => ({
      ...terminology,
      modules,
      status: moduleController.snapshot.status,
      scopedReadOnly: scopedPlatformOverview,
    }),
    [terminology, modules, moduleController.snapshot.status, scopedPlatformOverview],
  );
  const visibleOrganizationGroups = useMemo(
    () => getOrganizationSidebarGroups(featureContext),
    [featureContext],
  );
  const effectiveAccess = useMemo(() => resolveEffectiveAccess(access, modules), [access, modules]);
  const visibleMemberGroups = useMemo(
    () => visibleMemberNavigationGroups(moduleController.snapshot.status, modules),
    [moduleController.snapshot.status, modules],
  );

  const workspaceOptions = availableWorkspaces(canManage, platformAvailable);
  const canAccessPalette = canOpenCommandPalette(selectedWorkspace, access);
  const organizationName = organizationDisplayName(access, currentSession);
  const activeOrgName = resolveActiveOrgName(branding, access);

  return {
    access,
    activeOrgName,
    branding,
    canAccessPalette,
    canManage,
    effectiveAccess,
    featureContext,
    handleExitImpersonation,
    identity,
    impersonation,
    isOrganization,
    memberEnabled,
    moduleController,
    modules,
    organizationName,
    organizationPerformerLabel,
    platformAvailable,
    platformMfaStatus,
    platformStatus,
    refreshPlatformStatus,
    rosterStructure,
    setOrganizationPerformerLabel,
    setRosterStructure,
    visibleMemberGroups,
    visibleOrganizationGroups,
    workspaceOptions,
  };
}
