import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import type * as AuthApiModule from "../auth/api";
import { TicketDiscountControls, type TicketDiscountState } from "./PublicTickets";

vi.mock("../auth/api", async (importOriginal) => {
  const actual = await importOriginal<typeof AuthApiModule>();
  return {
    ...actual,
    createPublicTicketCheckout: vi.fn(),
    getPublicCommerceProjection: vi.fn().mockResolvedValue(null),
    getPublicTicketConfirmationSettings: vi.fn(),
    getPublicTicketDiscountAvailability: vi.fn().mockResolvedValue({ hasRedeemableCode: false }),
    getPublicTicketPurchase: vi.fn(),
    getPublicTransactionFeeSettings: vi.fn(),
    getPublishedOrganizationProjection: vi.fn().mockResolvedValue(null),
    quotePublicTicketCheckout: vi.fn(),
  };
});

describe("TicketDiscountControls", () => {
  const dummyQuote = {
    discountAmountCents: 0,
    discountCode: null,
    discountType: null,
    discountValue: null,
    discountedSubtotalCents: 2000,
    feeCents: 50,
    originalSubtotalCents: 2000,
    originalUnitPriceCents: 2000,
    quantity: 1,
    totalCents: 2050,
  };

  const createMockState = (overrides: Partial<TicketDiscountState> = {}): TicketDiscountState => ({
    appliedCode: null,
    applyCode: vi.fn(),
    clearCode: vi.fn(),
    codeInput: "",
    displayQuote: dummyQuote,
    hasRedeemableCode: true,
    quoteBusy: false,
    quoteError: null,
    setCodeInput: vi.fn(),
    ...overrides,
  });

  it("renders nothing when hasRedeemableCode is false", () => {
    const state = createMockState({ hasRedeemableCode: false });
    const { container } = render(<TicketDiscountControls state={state} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button", { name: "Have a discount code?" })).not.toBeInTheDocument();
  });

  it("renders compact disclosure button and hides input initially when a code is eligible", () => {
    const state = createMockState({ hasRedeemableCode: true });
    render(<TicketDiscountControls state={state} />);
    const button = screen.getByRole("button", { name: "Have a discount code?" });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("aria-controls", "ticket-discount-region");
    expect(screen.queryByLabelText("Discount code (optional)")).not.toBeInTheDocument();
  });

  it("expands the labeled input and Apply button on disclosure click, updating aria-expanded", async () => {
    const user = userEvent.setup();
    const state = createMockState({ hasRedeemableCode: true });
    render(<TicketDiscountControls state={state} />);

    const button = screen.getByRole("button", { name: "Have a discount code?" });
    await user.click(button);

    expect(button).toHaveAttribute("aria-expanded", "true");
    const input = screen.getByLabelText("Discount code (optional)");
    expect(input).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply code" })).toBeInTheDocument();

    // Clicking again collapses
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Discount code (optional)")).not.toBeInTheDocument();
  });

  it("replaces expanded input with compact applied state with Remove action after successful apply", () => {
    const state = createMockState({
      appliedCode: "SUMMER25",
      displayQuote: {
        ...dummyQuote,
        discountAmountCents: 500,
        discountCode: "SUMMER25",
        discountedSubtotalCents: 1500,
        totalCents: 1550,
      },
    });
    render(<TicketDiscountControls state={state} />);

    expect(screen.getByText("SUMMER25 applied")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Discount code (optional)")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Have a discount code?" })).not.toBeInTheDocument();
  });

  it("stays expanded and displays safe error when code is invalid", () => {
    const state = createMockState({
      codeInput: "BADCODE",
      quoteError: "This code is not valid for this purchase.",
    });
    render(<TicketDiscountControls state={state} />);

    expect(screen.getByRole("button", { name: "Have a discount code?" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const input = screen.getByLabelText("Discount code (optional)");
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("BADCODE");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute(
      "aria-describedby",
      "ticket-discount-code-error ticket-discount-code-help",
    );
    const errorAlert = screen.getByRole("alert");
    expect(errorAlert).toHaveTextContent("This code is not valid for this purchase.");
  });

  it("calls clearCode and returns to compact available state when Remove is clicked", async () => {
    const user = userEvent.setup();
    const clearCode = vi.fn();
    const state = createMockState({
      appliedCode: "SUMMER25",
      clearCode,
      displayQuote: {
        ...dummyQuote,
        discountAmountCents: 500,
        discountCode: "SUMMER25",
      },
    });
    const { rerender } = render(<TicketDiscountControls state={state} />);

    const removeBtn = screen.getByRole("button", { name: "Remove" });
    await user.click(removeBtn);
    expect(clearCode).toHaveBeenCalledTimes(1);

    // After clearing code
    const resetState = createMockState({ appliedCode: null });
    rerender(<TicketDiscountControls state={resetState} />);
    const disclosure = screen.getByRole("button", { name: "Have a discount code?" });
    expect(disclosure).toBeInTheDocument();
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Discount code (optional)")).not.toBeInTheDocument();
  });

  it("shows checking status in applied state when quote is busy during quantity change", () => {
    const state = createMockState({
      appliedCode: "SUMMER25",
      displayQuote: {
        ...dummyQuote,
        discountAmountCents: 500,
        discountCode: "SUMMER25",
      },
      quoteBusy: true,
    });
    render(<TicketDiscountControls state={state} />);

    expect(screen.getByText("SUMMER25 applied")).toBeInTheDocument();
    expect(screen.getByText("(checking…)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("supports keyboard interaction and applies code on Enter key press", async () => {
    const user = userEvent.setup();
    const applyCode = vi.fn();
    const state = createMockState({
      applyCode,
      codeInput: "WINTER10",
    });
    render(<TicketDiscountControls state={state} />);

    const disclosure = screen.getByRole("button", { name: "Have a discount code?" });
    disclosure.focus();
    await user.keyboard("{Enter}");

    const input = screen.getByLabelText("Discount code (optional)");
    expect(input).toBeInTheDocument();

    input.focus();
    await user.keyboard("{Enter}");
    expect(applyCode).toHaveBeenCalledTimes(1);
  });
});
