import type { Env } from "../../env";
import type { OrganizationStore } from "../OrganizationStore";
import {
  organizationRpcDomainForPath,
  organizationRpcOperationForPath,
  isOrganizationRpcValue,
  type OrganizationRpcCall,
  type OrganizationRpcResult,
  type OrganizationRpcValue,
} from "./types";

export type OrganizationStoreStub = DurableObjectStub<OrganizationStore>;

const trustedOrganizationIds = new WeakMap<object, string>();

export function organizationStoreStub(
  env: Partial<Pick<Env, "ORGANIZATION_STORE">>,
  organizationId: string,
): OrganizationStoreStub {
  const namespace = env.ORGANIZATION_STORE;
  if (!namespace) throw new Error("The Organization store binding is not configured.");
  const stub = namespace.getByName(organizationId);
  trustedOrganizationIds.set(stub, organizationId);
  return stub;
}

async function invokeDomainRpc(
  stub: OrganizationStoreStub,
  call: OrganizationRpcCall,
): Promise<OrganizationRpcResult> {
  switch (call.domain) {
    case "calendar":
      return stub.calendarRpc(call);
    case "commerce":
      return stub.commerceRpc(call);
    case "communication":
      return stub.communicationRpc(call);
    case "content":
      return stub.contentRpc(call);
    case "engagement":
      return stub.engagementRpc(call);
    case "file":
      return stub.fileRpc(call);
    case "job":
      return stub.jobRpc(call);
    case "lifecycle":
      return stub.lifecycleRpc(call);
    case "operations":
      return stub.operationsRpc(call);
    case "profile":
      return stub.profileRpc(call);
  }
}

function responseFromRpcResult(result: OrganizationRpcResult): Response {
  const headers = new Headers(result.ok ? result.headers : result.error.headers);
  const contentType = headers.get("content-type") ?? "application/json";
  if (!headers.has("content-type")) headers.set("content-type", contentType);
  const value = result.ok ? result.value : result.error.body;
  if (result.ok && result.status === 204) {
    return new Response(null, { headers, status: result.status });
  }
  const body = contentType.toLowerCase().includes("json")
    ? JSON.stringify(value)
    : typeof value === "string"
      ? value
      : JSON.stringify(value);
  return new Response(body, {
    headers,
    status: result.ok ? result.status : result.error.status,
  });
}

function parseBody(value: string): OrganizationRpcValue | undefined {
  if (value.length === 0) return undefined;
  const parsed: unknown = JSON.parse(value);
  if (!isOrganizationRpcValue(parsed)) {
    throw new Error("Organization RPC payload must be JSON-serializable.");
  }
  return parsed;
}

function requestCall(
  method: "GET" | "POST",
  url: URL,
  body: OrganizationRpcValue | undefined,
): OrganizationRpcCall {
  const query = Object.fromEntries(url.searchParams.entries());
  return {
    ...(body === undefined ? {} : { body }),
    domain: organizationRpcDomainForPath(url.pathname),
    method,
    operation: organizationRpcOperationForPath(method, url.pathname),
    path: url.pathname,
    ...(Object.keys(query).length > 0 ? { query } : {}),
  };
}

export async function invokeOrganizationRpc(
  stub: OrganizationStoreStub,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const request = new Request(input, init);
  const trustedOrganizationId = trustedOrganizationIds.get(stub);
  if (!trustedOrganizationId) {
    throw new Error("Organization RPC calls must use a stub from organizationStoreStub.");
  }
  const method = request.method === "GET" ? "GET" : "POST";
  const body = await request.text();
  const parsedBody = parseBody(body);
  const url = new URL(request.url);
  if (url.pathname !== "/internal/provision" && !url.searchParams.has("organizationId")) {
    url.searchParams.set("organizationId", trustedOrganizationId);
  }
  const call = requestCall(method, url, parsedBody);
  const result = await invokeDomainRpc(stub, call);
  return responseFromRpcResult(result);
}

export function rpcBody(value: unknown): OrganizationRpcValue {
  if (!isOrganizationRpcValue(value)) {
    throw new Error("Organization RPC payload must be JSON-serializable.");
  }
  return value;
}
