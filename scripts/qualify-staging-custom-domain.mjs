import { getStagingSession } from "./staging-auth-helper.mjs";

const productUrl = (process.env.STAGING_PRODUCT_URL ?? "https://staging.musicsite.org").replace(
  /\/$/u,
  "",
);
const productHostname = new URL(productUrl).hostname;
const organizationSlug = (process.env.STAGING_ORG_SLUG ?? "lcc").trim().toLowerCase();
const wrongOrganizationSlug = (process.env.STAGING_SECOND_ORG_SLUG ?? "lmc").trim().toLowerCase();
const email = (process.env.STAGING_AUTH_EMAIL ?? "cwosborn@gmail.com").trim().toLowerCase();
const suppliedSessionCookie = process.env.STAGING_SESSION_COOKIE?.trim() ?? "";
const organizationHost = `https://${organizationSlug}.${productHostname}`;
const wrongOrganizationHost = `https://${wrongOrganizationSlug}.${productHostname}`;
const planOnly = process.argv.includes("--plan-only");
const confirmed = process.argv.includes("--yes");
const pollAttempts = Math.min(
  72,
  Math.max(1, Number(process.env.STAGING_CUSTOM_DOMAIN_ATTEMPTS ?? "36")),
);
const pollDelayMs = Math.min(
  60_000,
  Math.max(0, Number(process.env.STAGING_CUSTOM_DOMAIN_RETRY_MS ?? "10_000")),
);

if (!/^[a-z0-9-]+$/u.test(organizationSlug) || !/^[a-z0-9-]+$/u.test(wrongOrganizationSlug)) {
  throw new Error("Organization slugs must contain only lowercase letters, numbers, or hyphens.");
}
if (organizationSlug === wrongOrganizationSlug) {
  throw new Error("The wrong-Organization host must be different from the target host.");
}

function uuid(value, label) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new Error(`${label} must be a UUID.`);
  }
  return value;
}

function requestFailure(status, body) {
  const code =
    typeof body === "object" && body !== null && "code" in body && typeof body.code === "string"
      ? body.code
      : null;
  return `HTTP ${String(status)}${code ? ` (${code})` : ""}`;
}

export function customDomainQualificationPlan() {
  return [
    "require explicitly supplied customer-owned subdomain, apex, and www hostnames",
    "register all three hostnames through the Organization public-domain API",
    "wait for Cloudflare custom-hostname activation and retain only bounded provider status",
    "verify each activated hostname serves the public projection",
    "verify auth and Organization administration routes remain unavailable on each public hostname",
    "verify the wrong Organization cannot read the controlled domain records",
    "disable every controlled hostname and verify provider rollback and routing removal",
    "retain only safe hostname, status, routing, and cleanup evidence; never print provider errors or signed values",
  ];
}

function isPublicHostname(value) {
  return (
    value.length <= 253 &&
    value.includes(".") &&
    !/^\d+(?:\.\d+){3}$/u.test(value) &&
    !/^\d+$/u.test(value.split(".").at(-1) ?? "") &&
    value
      .split(".")
      .every(
        (label) =>
          label.length >= 1 &&
          label.length <= 63 &&
          /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
      )
  );
}

export function customDomainHostnames(environment = process.env) {
  const apex = (environment.STAGING_CUSTOM_DOMAIN_APEX ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.$/u, "");
  const subdomain = (environment.STAGING_CUSTOM_DOMAIN_SUBDOMAIN ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.$/u, "");
  const www = (environment.STAGING_CUSTOM_DOMAIN_WWW ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.$/u, "");
  const values = { apex, subdomain, www };
  for (const [label, hostname] of Object.entries(values)) {
    if (!hostname || !isPublicHostname(hostname)) {
      throw new Error(
        `STAGING_CUSTOM_DOMAIN_${label.toUpperCase()} must be a valid public hostname.`,
      );
    }
    if (
      hostname === productHostname ||
      hostname.endsWith(`.${productHostname}`) ||
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      /\.(?:example|invalid|local|test|internal)$/u.test(hostname)
    ) {
      throw new Error("Custom-domain qualification requires customer-owned public DNS hostnames.");
    }
  }
  if (www !== `www.${apex}`) {
    throw new Error("STAGING_CUSTOM_DOMAIN_WWW must be www.<apex hostname>.");
  }
  if (subdomain === apex || subdomain === www || !subdomain.endsWith(`.${apex}`)) {
    throw new Error(
      "STAGING_CUSTOM_DOMAIN_SUBDOMAIN must be a distinct subdomain of STAGING_CUSTOM_DOMAIN_APEX.",
    );
  }
  if (new Set([subdomain, apex, www]).size !== 3) {
    throw new Error("The subdomain, apex, and www hostnames must be distinct.");
  }
  return { apex, subdomain, www };
}

export function safeCustomDomainBoundaryResponsesSafe(responses, targetHostnames) {
  const targetSet = new Set(targetHostnames);
  return responses.every((result) => {
    if (result.status === 401 || result.status === 403 || result.status === 404) return true;
    return (
      result.status === 200 &&
      Array.isArray(result.body?.domains) &&
      result.body.domains.every((domain) => !targetSet.has(domain?.hostname))
    );
  });
}

export function safeCustomDomainQualificationSummary(input) {
  return {
    activatedDomainCount: input.activatedDomainCount ?? 0,
    cleanupCompleted: input.cleanupCompleted === true,
    crossOrganizationRejected: input.crossOrganizationRejected === true,
    publicProjectionServed: input.publicProjectionServed === true,
    publicRoutesProtected: input.publicRoutesProtected === true,
    rollbackCompleted: input.rollbackCompleted === true,
    registeredDomainCount: input.registeredDomainCount ?? 0,
  };
}

async function request(url, method, cookie, body) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "cache-control": "no-cache",
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      origin: new URL(url).origin,
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    },
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  const responseText = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    // Do not retain or print unexpected response bodies.
  }
  return { body: parsed, response };
}

async function signIn() {
  return getStagingSession({
    email,
    productUrl,
    sessionCookie: suppliedSessionCookie || undefined,
  });
}

async function readDomains(cookie) {
  const result = await request(
    `${organizationHost}/api/organization/public-domains`,
    "GET",
    cookie,
  );
  if (result.response.status !== 200 || !Array.isArray(result.body?.domains)) {
    throw new Error(
      `Public-domain list failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return result.body.domains;
}

async function registerDomain(cookie, hostname) {
  const result = await request(
    `${organizationHost}/api/organization/public-domains`,
    "POST",
    cookie,
    { hostname },
  );
  if (result.response.status !== 201 || typeof result.body?.domainId !== "string") {
    throw new Error(
      `Registration for ${hostname} failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return {
    domainId: uuid(result.body.domainId, "Public-domain ID"),
    hostname: result.body.hostname,
    routingVersion: result.body.routingVersion,
  };
}

async function waitForActivation(cookie, domain) {
  for (let attempt = 1; attempt <= pollAttempts; attempt += 1) {
    const records = await readDomains(cookie);
    const current = records.find((candidate) => candidate?.domainId === domain.domainId);
    if (!current) throw new Error(`Registered hostname ${domain.hostname} disappeared.`);
    if (current.providerStatus === "error") {
      throw new Error(`Cloudflare custom-hostname activation failed for ${domain.hostname}.`);
    }
    if (current.status === "active" && current.providerStatus === "active") {
      return current;
    }
    if (attempt < pollAttempts) {
      console.log(
        `WAIT custom-domain ${domain.hostname} (${String(attempt)}/${String(pollAttempts)})`,
      );
      await new Promise((resolve) => setTimeout(resolve, pollDelayMs));
    }
  }
  throw new Error(`Cloudflare custom-hostname activation timed out for ${domain.hostname}.`);
}

async function probe(url, expectedStatus, label) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        accept: expectedStatus === 200 ? "text/html" : "application/json",
        "cache-control": "no-cache",
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/131.0.0.0",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "network error";
    throw new Error(`${label} could not be reached: ${reason}.`, { cause: error });
  }
  await response.text();
  if (response.status !== expectedStatus) {
    throw new Error(`${label} returned HTTP ${String(response.status)}.`);
  }
}

async function probeDisabledHost(url, label) {
  try {
    const response = await fetch(url, {
      headers: { "cache-control": "no-cache", "user-agent": "ChoirManagementQualification/1.0" },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    await response.text();
    if (response.status === 404) return true;
    throw new Error(`${label} returned HTTP ${String(response.status)} after rollback.`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("after rollback")) throw error;
    return true;
  }
}

async function disableDomain(cookie, domain) {
  const result = await request(
    `${organizationHost}/api/organization/public-domains/${encodeURIComponent(domain.domainId)}`,
    "DELETE",
    cookie,
  );
  if (result.response.status !== 200 || result.body?.status !== "disabled") {
    throw new Error(
      `Rollback for ${domain.hostname} failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  if (
    !Number.isInteger(result.body.routingVersion) ||
    result.body.routingVersion <= domain.activeRoutingVersion
  ) {
    throw new Error(`Rollback for ${domain.hostname} did not advance its routing version.`);
  }
  return result.body;
}

async function inspectWrongOrganization(cookie, targetHostnames) {
  const result = await request(
    `${wrongOrganizationHost}/api/organization/public-domains`,
    "GET",
    cookie,
  );
  return safeCustomDomainBoundaryResponsesSafe(
    [{ status: result.response.status, body: result.body }],
    targetHostnames,
  );
}

async function main() {
  if (planOnly) {
    for (const [index, step] of customDomainQualificationPlan().entries()) {
      console.log(`${String(index + 1)}. ${step}`);
    }
    return;
  }
  if (!confirmed) {
    throw new Error(
      "Custom-domain qualification changes hosted staging state; rerun with --yes after reviewing the supplied hostnames.",
    );
  }

  const hostnames = customDomainHostnames();
  const targetHostnames = [hostnames.subdomain, hostnames.apex, hostnames.www];
  let cookie = "";
  const registered = [];
  const disabled = new Set();
  const summary = {
    activatedDomainCount: 0,
    cleanupCompleted: false,
    crossOrganizationRejected: false,
    publicProjectionServed: false,
    publicRoutesProtected: false,
    rollbackCompleted: false,
    registeredDomainCount: 0,
  };

  try {
    cookie = await signIn();
    const context = await request(`${organizationHost}/api/organization/context`, "GET", cookie);
    if (context.response.status !== 200) {
      throw new Error(
        `Organization context failed with ${requestFailure(context.response.status, context.body)}.`,
      );
    }

    for (const hostname of targetHostnames) {
      const existing = (await readDomains(cookie)).find(
        (domain) => domain?.hostname === hostname && domain?.status !== "disabled",
      );
      if (existing) {
        throw new Error(`A non-disabled controlled domain already exists for ${hostname}.`);
      }
      const domain = await registerDomain(cookie, hostname);
      registered.push(domain);
      console.log(`PASS custom-domain registration (${hostname})`);
    }
    summary.registeredDomainCount = registered.length;

    const activeDomains = [];
    for (const domain of registered) {
      const active = await waitForActivation(cookie, domain);
      activeDomains.push({
        ...domain,
        activeRoutingVersion: active.routingVersion,
      });
      console.log(`PASS custom-domain activation (${domain.hostname})`);
    }
    summary.activatedDomainCount = activeDomains.length;

    for (const domain of activeDomains) {
      await probe(`https://${domain.hostname}/`, 200, `${domain.hostname} public projection`);
      console.log(`PASS custom-domain public projection (${domain.hostname})`);
      await probe(
        `https://${domain.hostname}/api/auth/get-session`,
        404,
        `${domain.hostname} authentication boundary`,
      );
      await probe(
        `https://${domain.hostname}/api/organization/context`,
        404,
        `${domain.hostname} Organization boundary`,
      );
    }
    summary.publicProjectionServed = true;
    summary.publicRoutesProtected = true;

    summary.crossOrganizationRejected = await inspectWrongOrganization(cookie, targetHostnames);
    console.log(
      `${summary.crossOrganizationRejected ? "PASS" : "FAIL"} custom-domain cross-Organization boundary`,
    );
    if (!summary.crossOrganizationRejected) {
      throw new Error("The wrong Organization host could read a controlled custom-domain record.");
    }

    for (const domain of activeDomains) {
      await disableDomain(cookie, domain);
      disabled.add(domain.domainId);
      await probeDisabledHost(
        `https://${domain.hostname}/`,
        `${domain.hostname} rollback boundary`,
      );
      console.log(`PASS custom-domain provider rollback (${domain.hostname})`);
    }
    summary.rollbackCompleted = disabled.size === registered.length;
  } finally {
    if (cookie) {
      for (const domain of registered) {
        if (disabled.has(domain.domainId)) continue;
        try {
          const current = (await readDomains(cookie)).find(
            (candidate) => candidate?.domainId === domain.domainId,
          );
          if (current?.status !== "disabled") {
            await disableDomain(cookie, {
              ...domain,
              activeRoutingVersion: current?.routingVersion ?? domain.routingVersion,
            });
          }
          disabled.add(domain.domainId);
        } catch {
          console.error("Custom-domain cleanup did not complete for every controlled hostname.");
        }
      }
    }
    summary.cleanupCompleted = disabled.size === registered.length;
  }

  const result = safeCustomDomainQualificationSummary(summary);
  console.log(JSON.stringify(result));
  if (
    !result.cleanupCompleted ||
    !result.crossOrganizationRejected ||
    !result.publicProjectionServed ||
    !result.publicRoutesProtected ||
    !result.rollbackCompleted ||
    result.activatedDomainCount !== 3
  ) {
    throw new Error("Custom-domain qualification did not satisfy all checks.");
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  await main();
}
