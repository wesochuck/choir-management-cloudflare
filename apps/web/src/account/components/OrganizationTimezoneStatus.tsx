import type { ReactNode } from "react";

export function OrganizationTimezoneStatus({
  failed,
  onRetry,
  errorMessage,
}: {
  readonly failed: boolean;
  readonly onRetry: () => void;
  readonly errorMessage?: string | null | undefined;
}) {
  if (!failed) return <p role="status">Loading Organization timezone…</p>;
  return (
    <div className="notice notice--error" role="alert">
      <p>
        {errorMessage ??
          "The Organization timezone could not be loaded. Try again to view event times."}
      </p>
      <button className="button" onClick={onRetry} type="button">
        Retry
      </button>
    </div>
  );
}

export function OrganizationTimezoneBoundary({
  timezone,
  children,
  ...status
}: {
  readonly timezone: string | null | undefined;
  readonly children: ReactNode;
  readonly failed: boolean;
  readonly onRetry: () => void;
  readonly errorMessage?: string | null | undefined;
}) {
  if (!timezone) return <OrganizationTimezoneStatus {...status} />;
  return children;
}
