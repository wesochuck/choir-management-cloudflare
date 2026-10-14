import { env, exports } from "cloudflare:workers";
import { organizationRequest, readEmailOneTimeCode, signInWithOtp } from "@choir/testkit";
import { z } from "zod";
import { readCapturedPlatformEmailsForTest } from "../src/auth/platformEmail";
import { requireIntegrationBinding } from "./organization.integration.fixture";

export { env, exports };

export const database = requireIntegrationBinding(env.CONTROL_DB, "CONTROL_DB");
export const stores = requireIntegrationBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");
export const organizationFiles = requireIntegrationBinding(
  env.ORGANIZATION_FILES,
  "ORGANIZATION_FILES",
);
export const managerEmail = "communications.manager@example.test";

export const api = organizationRequest;

export const write = async (
  host: string,
  path: string,
  cookie: string,
  body: unknown,
  requestHeaders: HeadersInit = {},
): Promise<Response> => {
  const headers = new Headers(requestHeaders);
  headers.set("content-type", "application/json");
  return exports.default.fetch(
    api(host, path, cookie, {
      body: JSON.stringify(body),
      headers,
      method: "POST",
    }),
  );
};

export const signIn = () =>
  signInWithOtp(exports.default, "alpha.localhost", managerEmail, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );

export async function createProfile(cookie: string, body: Record<string, unknown>) {
  const response = await write("alpha.localhost", "/api/organization/profiles", cookie, body);
  const parsed = z.object({ id: z.uuid() }).parse(await response.json());
  return parsed.id;
}
