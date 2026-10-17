import type { PublishedOrganizationProjection } from "@choir/contracts";
import { useEffect, useState } from "react";
import {
  getPublicCommerceProjection,
  getPublicTransactionFeeSettings,
  getPublishedOrganizationProjection,
} from "../auth/api";
import { OrganizationLayout, PublicTransactionLayout } from "./PublicOrganizationSite";
import {
  type TicketDiscountState,
  TicketDiscountControls,
} from "./PublicTickets/discounts/TicketDiscountControls";
import { TicketBundlePurchaseForm } from "./PublicTickets/forms/TicketBundlePurchaseForm";
import { TicketCheckoutFooter } from "./PublicTickets/forms/TicketCheckoutFooter";
import { TicketReceipt } from "./PublicTickets/receipt/TicketReceipt";
import { DEFAULT_TRANSACTION_FEE_SETTINGS, type LoadState } from "./PublicTickets/shared";
import { TicketsContent } from "./PublicTickets/TicketsContent";

export {
  type TicketDiscountState,
  TicketCheckoutFooter,
  TicketDiscountControls,
  TicketReceipt,
  TicketBundlePurchaseForm,
  TicketsContent,
};

function mergePerformances(
  published:
    readonly PublishedOrganizationProjection["payload"]["performances"][number][] | undefined,
  commerce:
    readonly PublishedOrganizationProjection["payload"]["performances"][number][] | undefined,
): PublishedOrganizationProjection["payload"]["performances"][number][] {
  const map = new Map<string, PublishedOrganizationProjection["payload"]["performances"][number]>();
  for (const item of published ?? []) {
    map.set(item.id, item);
  }
  for (const item of commerce ?? []) {
    map.set(item.id, item);
  }
  return Array.from(map.values());
}

function combineProjections(
  published: PublishedOrganizationProjection | null,
  commerce: PublishedOrganizationProjection | null,
): PublishedOrganizationProjection {
  if (!published) {
    if (!commerce) {
      throw new Error("Projection unavailable");
    }
    return commerce;
  }
  if (!commerce) {
    return published;
  }
  const mediaFileIds = Array.from(
    new Set([...published.payload.mediaFileIds, ...commerce.payload.mediaFileIds]),
  );
  return {
    ...published,
    payload: {
      ...published.payload,
      mediaFileIds,
      performances: mergePerformances(
        published.payload.performances,
        commerce.payload.performances,
      ),
      // A live commerce response is authoritative: omitted bundles are no longer offered.
      ticketBundles: commerce.payload.ticketBundles,
    },
    version: commerce.version,
  };
}

export function PublicTickets({ pathname }: { readonly pathname: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [nowMs] = useState(() => Date.now());
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      Promise.resolve()
        .then(() => getPublishedOrganizationProjection(controller.signal))
        .catch(() => null),
      Promise.resolve()
        .then(() => getPublicCommerceProjection(controller.signal))
        .catch(() => null),
    ])
      .then(async ([published, commerce]) => {
        const projection = combineProjections(published, commerce);
        const feeSettings = await getPublicTransactionFeeSettings(controller.signal).catch(
          () => DEFAULT_TRANSACTION_FEE_SETTINGS,
        );
        setState({ feeSettings, projection, status: "ready" });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" });
      });
    return () => {
      controller.abort();
    };
  }, []);
  if (state.status === "loading")
    return (
      <main className="auth-layout">
        <p className="notice notice--info">Loading tickets…</p>
      </main>
    );
  if (state.status === "error")
    return (
      <main className="auth-layout">
        <p className="notice notice--error">Tickets are unavailable.</p>
      </main>
    );
  const settings = state.projection.payload.settings;
  const content = (
    <TicketsContent
      feeSettings={state.feeSettings}
      nowMs={nowMs}
      pathname={pathname}
      projection={state.projection}
    />
  );

  return settings.showBrandingHeaderFooter ? (
    <OrganizationLayout pathname={pathname} projection={state.projection}>
      {content}
    </OrganizationLayout>
  ) : (
    <PublicTransactionLayout projection={state.projection}>{content}</PublicTransactionLayout>
  );
}
