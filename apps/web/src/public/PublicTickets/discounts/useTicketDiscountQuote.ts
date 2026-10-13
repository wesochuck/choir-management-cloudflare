import type {
  TicketCheckoutQuote,
  TicketCheckoutQuoteRequest,
  TransactionFeeSettings,
} from "@choir/contracts";
import { ticketProcessingFeeCents } from "@choir/domain";
import { useEffect, useState } from "react";
import { getPublicTicketDiscountAvailability, quotePublicTicketCheckout } from "../../../auth/api";

export interface TicketDiscountTarget {
  readonly bundleId?: string;
  readonly eventId?: string;
}

export interface TicketDiscountState {
  readonly appliedCode: string | null;
  readonly applyCode: () => void;
  readonly clearCode: () => void;
  readonly codeInput: string;
  readonly displayQuote: TicketCheckoutQuote;
  readonly hasRedeemableCode: boolean;
  readonly quoteBusy: boolean;
  readonly quoteError: string | null;
  readonly setCodeInput: (value: string) => void;
}

export function useTicketDiscountQuote({
  feeSettings,
  quantity,
  target,
  unitPriceCents,
}: {
  readonly feeSettings: TransactionFeeSettings;
  readonly quantity: number;
  readonly target: TicketDiscountTarget;
  readonly unitPriceCents: number;
}): TicketDiscountState {
  const [hasRedeemableCode, setHasRedeemableCode] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [quote, setQuote] = useState<TicketCheckoutQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const bundleId = target.bundleId;
  const eventId = target.eventId;

  useEffect(() => {
    const controller = new AbortController();
    void getPublicTicketDiscountAvailability(
      {
        ...(bundleId ? { bundleId } : {}),
        ...(eventId ? { eventId } : {}),
      },
      controller.signal,
    )
      .then((available) => {
        if (!controller.signal.aborted) setHasRedeemableCode(available);
      })
      .catch(() => {
        if (!controller.signal.aborted) setHasRedeemableCode(false);
      });
    return () => {
      controller.abort();
    };
  }, [bundleId, eventId]);

  useEffect(() => {
    if (!appliedCode) return;
    const controller = new AbortController();
    void quotePublicTicketCheckout(
      {
        bundleId: bundleId ?? null,
        discountCode: appliedCode,
        eventId: eventId ?? null,
        quantity,
      } satisfies TicketCheckoutQuoteRequest,
      controller.signal,
    )
      .then((nextQuote) => {
        if (controller.signal.aborted) return;
        setQuote(nextQuote);
        setQuoteError(null);
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setQuote(null);
        setAppliedCode(null);
        setQuoteError(
          failure instanceof Error ? failure.message : "This code is not valid for this purchase.",
        );
      });
    return () => {
      controller.abort();
    };
  }, [appliedCode, bundleId, eventId, quantity]);

  const localQuote: TicketCheckoutQuote = {
    discountAmountCents: 0,
    discountCode: null,
    discountType: null,
    discountValue: null,
    discountedSubtotalCents: unitPriceCents * quantity,
    feeCents: ticketProcessingFeeCents(unitPriceCents, quantity, feeSettings),
    originalSubtotalCents: unitPriceCents * quantity,
    originalUnitPriceCents: unitPriceCents,
    quantity,
    totalCents:
      unitPriceCents * quantity + ticketProcessingFeeCents(unitPriceCents, quantity, feeSettings),
  };

  return {
    appliedCode,
    applyCode: () => {
      const nextCode = codeInput.trim();
      setQuoteError(null);
      if (!nextCode) {
        setAppliedCode(null);
        setQuote(null);
        return;
      }
      setAppliedCode(nextCode);
    },
    clearCode: () => {
      setCodeInput("");
      setAppliedCode(null);
      setQuote(null);
      setQuoteError(null);
    },
    codeInput,
    displayQuote: quote ?? localQuote,
    hasRedeemableCode,
    quoteBusy: Boolean(appliedCode && quote?.quantity !== quantity),
    quoteError,
    setCodeInput,
  };
}
