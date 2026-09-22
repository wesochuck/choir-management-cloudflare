import type { PublishedOrganizationProjection } from "@choir/contracts";
import { useEffect, useState } from "react";

import { getPublicCommerceProjection, getPublishedOrganizationProjection } from "../auth/api";
import { PublicDonationSuccessView } from "./PublicDonationSuccessView";
import { PublicDonationView } from "./PublicDonationView";
import { OrganizationLayout, PublicTransactionLayout } from "./PublicOrganizationSite";

type LoadState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly projection: PublishedOrganizationProjection; readonly status: "ready" };

export function PublicDonations({ pathname }: { readonly pathname: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    void getPublishedOrganizationProjection(controller.signal)
      .then((projection) => projection ?? getPublicCommerceProjection(controller.signal))
      .then((projection) => {
        setState({ projection, status: "ready" });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" });
      });
    return () => {
      controller.abort();
    };
  }, []);

  if (state.status === "loading") {
    return (
      <main className="auth-layout">
        <p className="notice notice--info">Loading donations…</p>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="auth-layout">
        <p className="notice notice--error">Donations are unavailable.</p>
      </main>
    );
  }

  const settings = state.projection.payload.settings;
  const content =
    pathname === "/donate/success" ? <PublicDonationSuccessView /> : <PublicDonationView />;

  return settings.showBrandingHeaderFooter ? (
    <OrganizationLayout pathname={pathname} projection={state.projection}>
      {content}
    </OrganizationLayout>
  ) : (
    <PublicTransactionLayout projection={state.projection}>{content}</PublicTransactionLayout>
  );
}
