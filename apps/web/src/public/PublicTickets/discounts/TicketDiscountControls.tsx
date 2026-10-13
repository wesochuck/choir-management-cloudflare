import { useRef, useState } from "react";
import type { TicketDiscountState } from "./useTicketDiscountQuote";

export type { TicketDiscountState };

export function TicketDiscountControls({ state }: { readonly state: TicketDiscountState }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  if (!state.hasRedeemableCode) return null;

  if (state.appliedCode && !state.quoteError) {
    const codeName = state.displayQuote.discountCode ?? state.appliedCode;
    return (
      <div className="ticket-discount-controls ticket-discount-applied" role="status">
        <span>
          <strong>{codeName} applied</strong>
          {state.quoteBusy ? " (checking…)" : null}
        </span>
        <span aria-hidden="true"> · </span>
        <button
          className="text-button ticket-discount-remove"
          onClick={() => {
            state.clearCode();
            setIsExpanded(false);
            requestAnimationFrame(() => {
              toggleRef.current?.focus();
            });
          }}
          type="button"
        >
          Remove
        </button>
      </div>
    );
  }

  const showEntry = isExpanded || Boolean(state.quoteError);

  return (
    <div className="ticket-discount-controls">
      <button
        aria-controls="ticket-discount-region"
        aria-expanded={showEntry}
        className="text-button ticket-discount-toggle"
        onClick={() => {
          const next = !showEntry;
          setIsExpanded(next);
          if (next) {
            requestAnimationFrame(() => {
              inputRef.current?.focus();
            });
          }
        }}
        ref={toggleRef}
        type="button"
      >
        Have a discount code?
      </button>

      {showEntry ? (
        <div className="field ticket-discount-region" id="ticket-discount-region">
          <label htmlFor="ticket-discount-code">Discount code (optional)</label>
          <div className="form-actions">
            <input
              aria-describedby={
                state.quoteError
                  ? "ticket-discount-code-error ticket-discount-code-help"
                  : "ticket-discount-code-help"
              }
              aria-invalid={Boolean(state.quoteError)}
              id="ticket-discount-code"
              maxLength={64}
              onChange={(event) => {
                state.setCodeInput(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (state.codeInput.trim() && !state.quoteBusy) {
                    state.applyCode();
                  }
                }
              }}
              ref={inputRef}
              value={state.codeInput}
            />
            <button
              className="button button--secondary"
              disabled={!state.codeInput.trim() || state.quoteBusy}
              onClick={state.applyCode}
              type="button"
            >
              {state.quoteBusy ? "Checking…" : "Apply code"}
            </button>
          </div>
          <p className="field-help" id="ticket-discount-code-help">
            {state.quoteBusy
              ? "Checking this code against the current price…"
              : "One code may be applied to this purchase."}
          </p>
          {state.quoteError ? (
            <p
              className="field-help field-help--error"
              id="ticket-discount-code-error"
              role="alert"
            >
              {state.quoteError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
