import { moduleStateSchema } from "@choir/contracts";
import type { ModuleState } from "@choir/contracts";
import { z } from "zod";

const layoutMetadataSchema = z.object({
  host: z.string().min(1).max(255),
  logoFileId: z.string().max(128).nullable(),
  modules: z.array(moduleStateSchema).nullable(),
  organizationName: z.string().max(120).nullable(),
  performerLabel: z.string().min(1).max(120),
  rosterStructure: z.enum(["sections_only", "sections_with_parts"]),
  userId: z.string().min(1).max(128),
  version: z.literal(2),
});

export type AuthenticatedLayoutMetadata = z.infer<typeof layoutMetadataSchema>;

export type AuthenticatedLayoutMetadataUpdate = Partial<
  Pick<
    AuthenticatedLayoutMetadata,
    "logoFileId" | "modules" | "organizationName" | "performerLabel" | "rosterStructure"
  >
>;

const storageKeyPrefix = "choir.authenticated-layout.v2:";
const legacyStorageKeyPrefix = "choir.authenticated-layout.v1:";

function storageKey(host: string, userId: string): string {
  return `${storageKeyPrefix}${encodeURIComponent(host)}:${encodeURIComponent(userId)}`;
}

export function readAuthenticatedLayoutMetadata(
  host: string,
  userId: string,
): AuthenticatedLayoutMetadata | null {
  try {
    const key = storageKey(host, userId);
    window.sessionStorage.removeItem(
      `${legacyStorageKeyPrefix}${encodeURIComponent(host)}:${encodeURIComponent(userId)}`,
    );
    const raw = window.sessionStorage.getItem(key);
    if (raw === null) return null;
    const parsed = layoutMetadataSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success || parsed.data.host !== host || parsed.data.userId !== userId) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return parsed.data;
  } catch {
    // Storage can be unavailable in private browsing or restricted contexts.
    return null;
  }
}

function mergeLayoutMetadata(
  host: string,
  userId: string,
  previous: AuthenticatedLayoutMetadata | null,
  update: AuthenticatedLayoutMetadataUpdate,
): AuthenticatedLayoutMetadata {
  return {
    host,
    logoFileId: mergeLogoFileId(previous, update),
    modules: update.modules ?? previous?.modules ?? null,
    organizationName: mergeOrganizationName(previous, update),
    performerLabel: update.performerLabel ?? previous?.performerLabel ?? "Performer",
    rosterStructure: update.rosterStructure ?? previous?.rosterStructure ?? "sections_with_parts",
    userId,
    version: 2,
  };
}

function mergeLogoFileId(
  previous: AuthenticatedLayoutMetadata | null,
  update: AuthenticatedLayoutMetadataUpdate,
): string | null {
  if (Object.hasOwn(update, "logoFileId")) return update.logoFileId ?? null;
  return previous?.logoFileId ?? null;
}

function mergeOrganizationName(
  previous: AuthenticatedLayoutMetadata | null,
  update: AuthenticatedLayoutMetadataUpdate,
): string | null {
  if (Object.hasOwn(update, "organizationName")) return update.organizationName ?? null;
  return previous?.organizationName ?? null;
}

export function updateAuthenticatedLayoutMetadata(
  host: string,
  userId: string,
  update: AuthenticatedLayoutMetadataUpdate,
): void {
  try {
    const previous = readAuthenticatedLayoutMetadata(host, userId);
    const parsed = layoutMetadataSchema.safeParse(
      mergeLayoutMetadata(host, userId, previous, update),
    );
    if (!parsed.success) return;
    window.sessionStorage.setItem(storageKey(host, userId), JSON.stringify(parsed.data));
  } catch {
    // Layout caching is an optimization and must never block workspace access.
  }
}

export function writeAuthenticatedLayoutModules(
  host: string,
  userId: string,
  modules: readonly ModuleState[],
): void {
  updateAuthenticatedLayoutMetadata(host, userId, { modules: [...modules] });
}

export function clearAuthenticatedLayoutMetadata(host: string, userId: string): void {
  try {
    window.sessionStorage.removeItem(storageKey(host, userId));
    window.sessionStorage.removeItem(
      `${legacyStorageKeyPrefix}${encodeURIComponent(host)}:${encodeURIComponent(userId)}`,
    );
  } catch {
    // Sign-out and access cleanup must continue when storage is unavailable.
  }
}
