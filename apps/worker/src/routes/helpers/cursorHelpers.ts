import {
  platformOrganizationCursorSchema,
  platformDeadLetterCursorSchema,
  type PlatformOrganizationRow,
  type PlatformDeadLetterRow,
} from "./routeContracts";

export function parsePlatformOrganizationCursor(
  value: string | null,
): readonly [createdAt: string, organizationId: string] | null | undefined {
  if (value === null) {
    return null;
  }
  if (value.length > 128) {
    return undefined;
  }
  const parsed = platformOrganizationCursorSchema.safeParse(value.split("|"));
  return parsed.success ? parsed.data : undefined;
}

export function encodePlatformOrganizationCursor(row: PlatformOrganizationRow): string {
  return `${row.createdAt}|${row.organizationId}`;
}

export function parsePlatformDeadLetterCursor(
  value: string | null,
): readonly [lastSeenAt: string, id: string] | null | undefined {
  if (value === null) {
    return null;
  }
  if (value.length > 512) {
    return undefined;
  }
  const parsed = platformDeadLetterCursorSchema.safeParse(value.split("|"));
  return parsed.success ? parsed.data : undefined;
}

export function encodePlatformDeadLetterCursor(row: PlatformDeadLetterRow): string {
  return `${row.lastSeenAt}|${row.id}`;
}
