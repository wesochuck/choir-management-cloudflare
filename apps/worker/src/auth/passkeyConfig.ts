function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

export function resolveRpId(productBaseDomain: string, requestUrl: URL): string {
  const normalizedBaseDomain = normalizeHostname(productBaseDomain);
  const hostname = normalizeHostname(requestUrl.hostname);

  if (normalizedBaseDomain === "localhost") {
    if (hostname !== "localhost" && !hostname.endsWith(".localhost")) {
      throw new Error(`Hostname ${hostname} is not a valid auth host for localhost base domain.`);
    }
    return "localhost";
  }

  if (normalizedBaseDomain.endsWith(".workers.dev")) {
    if (hostname !== normalizedBaseDomain && !hostname.endsWith(`.${normalizedBaseDomain}`)) {
      throw new Error(`Hostname ${hostname} is not a valid auth host on ${normalizedBaseDomain}.`);
    }
    return hostname;
  }

  if (hostname !== normalizedBaseDomain && !hostname.endsWith(`.${normalizedBaseDomain}`)) {
    throw new Error(
      `Custom public domain ${hostname} cannot be used for authenticated account operations.`,
    );
  }

  return normalizedBaseDomain;
}
