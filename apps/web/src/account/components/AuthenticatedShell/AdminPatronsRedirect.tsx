import { useEffect } from "react";

export function AdminPatronsRedirect({
  navigate,
  search,
}: {
  readonly navigate: (href: string, options?: { readonly replace?: boolean }) => void;
  readonly search: string;
}) {
  useEffect(() => {
    const target = search ? `/admin/donations${search}` : "/admin/donations";
    navigate(target, { replace: true });
  }, [navigate, search]);

  return (
    <p className="notice notice--info" role="status">
      Redirecting to Donations…
    </p>
  );
}
