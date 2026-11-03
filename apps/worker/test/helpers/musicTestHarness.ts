import {
  organizationVenueSchema,
  type OrganizationMusicPiece,
  type OrganizationMusicPieceRequest,
} from "@choir/contracts";
import {
  organizationRequest,
  provisionOrganization,
  readEmailOneTimeCode,
  seedAuthUser,
  signInWithOtp,
  writeJson,
} from "@choir/testkit";
import { applyD1Migrations } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { inject } from "vitest";
import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../../src/auth/platformEmail";

const USER_EMAIL = "music.manager@example.test";

export function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

export const database = requireBinding(env.CONTROL_DB, "CONTROL_DB");
export const stores = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

export const write = (host: string, path: string, cookie: string, body: unknown, method = "POST") =>
  writeJson(exports.default, host, path, cookie, body, method);
export const api = organizationRequest;

export async function createVenue(cookie: string, host = "alpha.localhost"): Promise<string> {
  const response = await write(host, "/api/organization/venues", cookie, {
    address: "1 Music Way",
    name: "Music Hall",
  });
  return organizationVenueSchema.parse(await response.json()).id;
}

const provision = (id: string, slug: string) =>
  provisionOrganization(database, stores, { id, slug, userId: "music-manager" });

export const signIn = () =>
  signInWithOtp(exports.default, "alpha.localhost", USER_EMAIL, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );

export function requestFrom(piece: OrganizationMusicPiece): OrganizationMusicPieceRequest {
  return {
    arranger: piece.arranger,
    catalogId: piece.catalogId,
    composer: piece.composer,
    copies: piece.copies,
    durationSeconds: piece.durationSeconds,
    genres: piece.genres,
    notes: piece.notes,
    parentId: piece.parentId,
    purchaseDate: piece.purchaseDate,
    scoreFileIds: piece.scoreFileIds,
    sectionBuckets: piece.sectionBuckets,
    title: piece.title,
    trackFileIds: piece.trackFileIds,
  };
}

export async function setupMusicTestEnvironment(): Promise<void> {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  await seedAuthUser(database, "music-manager", USER_EMAIL, "Music Manager");
  await provision("organization-alpha", "alpha");
  await provision("organization-bravo", "bravo");
}
