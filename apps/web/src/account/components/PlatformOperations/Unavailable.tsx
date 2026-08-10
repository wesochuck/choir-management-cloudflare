import { platformDeadLettersHref, platformOrganizationsHref } from "./shared";

export function OrganizationsUnavailable() {
  return (
    <p className="notice notice--warning" role="status">
      The Organization directory is available from the platform control-plane host. Open it here to
      provision and monitor Organizations:{" "}
      <a href={platformOrganizationsHref()}>Platform Organizations</a>.
    </p>
  );
}

export function AccessUnavailable() {
  return (
    <p className="notice notice--warning" role="status">
      Scoped Organization access is available after an Organization host has been selected.
    </p>
  );
}

export function DeadLettersUnavailable() {
  return (
    <p className="notice notice--warning" role="status">
      Queue dead letters are available from the platform control-plane host. Open them here:{" "}
      <a href={platformDeadLettersHref()}>Queue dead letters</a>
    </p>
  );
}
