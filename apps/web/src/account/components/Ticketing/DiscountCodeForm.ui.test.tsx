import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { DiscountCodeForm } from "./DiscountCodeForm";
import { EMPTY_DISCOUNT_DRAFT, type DiscountDraft } from "./shared";

function Harness() {
  const [draft, setDraft] = useState<DiscountDraft>({
    ...EMPTY_DISCOUNT_DRAFT,
    discountType: "fixed",
    discountValue: "0",
  });
  return (
    <DiscountCodeForm
      bundles={[]}
      busy={false}
      closeDiscountDialog={vi.fn()}
      discountDialogOpen
      discountDraft={draft}
      editingDiscountCodeId={null}
      saveDiscountCode={vi.fn()}
      setDiscountDraft={setDraft}
      ticketEvents={[]}
    />
  );
}

it("allows clearing a fixed discount and entering a decimal replacement", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const input = screen.getByLabelText("Amount per unit (USD)");
  await user.clear(input);
  expect(input).toHaveValue(null);
  await user.click(screen.getByLabelText("Code"));
  expect(input).toHaveValue(null);
  expect(input).toBeInvalid();
  await user.type(input, "1.25");
  await user.click(screen.getByLabelText("Code"));
  expect(input).toHaveValue(1.25);
  expect(input).toBeValid();
});
