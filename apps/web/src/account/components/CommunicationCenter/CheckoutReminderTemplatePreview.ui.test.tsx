import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, it, expect, vi } from "vitest";
import { CheckoutReminderTemplatePreview } from "./CheckoutReminderTemplatePreview";
import { checkoutReminderTemplates } from "@choir/domain";
vi.mock("../../../api/organization", () => ({
  getOrganizationBranding: vi.fn().mockRejectedValue(new Error("Sample branding")),
}));
afterEach(cleanup);
describe("complete checkout reminder template preview", () => {
  it.each(checkoutReminderTemplates)(
    "keeps protected actions visible for $kind even when copy omits them",
    async (template) => {
      render(
        <CheckoutReminderTemplatePreview
          templateId={template.id}
          subject="Hello {recipientName}"
          content="Thank you for considering {organizationName}."
        />,
      );
      expect(screen.getByText("Hello Alex")).toBeInTheDocument();
      const review = screen.getByRole("link", { name: "Review and continue" });
      expect(review).toHaveAttribute("href", "https://example.invalid/checkout/return");
      expect(screen.getByRole("link", { name: "Stop these reminders" })).toHaveAttribute(
        "href",
        "https://example.invalid/checkout/reminders/stop",
      );
      expect(screen.getByText("Organization mailing address")).toBeInTheDocument();
      await userEvent.click(review);
      expect(window.location.hostname).not.toBe("example.invalid");
    },
  );
});
