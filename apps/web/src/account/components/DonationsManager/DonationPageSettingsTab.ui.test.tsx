import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import type { DonationSettings } from "@choir/contracts";

import { DonationPageSettingsTab } from "./DonationPageSettingsTab";

const settings: DonationSettings = {
  buttonText: "Support our Music",
  description: "Your gift supports our work.",
  levels: [],
  thankYouMessage: "Your support keeps our music going.",
};

describe("DonationPageSettingsTab", () => {
  it("exposes a bounded plain-text thank-you message setting", () => {
    const setThankYouMessage = vi.fn();
    render(
      <DonationPageSettingsTab
        busy={false}
        portalButtonText={settings.buttonText}
        portalDescription={settings.description}
        portalThankYouMessage={settings.thankYouMessage ?? ""}
        savePortalSettings={(event) => {
          event.preventDefault();
          return Promise.resolve();
        }}
        setPortalButtonText={vi.fn()}
        setPortalDescription={vi.fn()}
        setPortalThankYouMessage={setThankYouMessage}
        settingsState={{ settings, status: "ready" }}
      />,
    );

    const message = screen.getByRole("textbox", {
      name: /^Thank-you message after donation/,
    });
    expect(message).toHaveValue("Your support keeps our music going.");
    expect(message).toHaveAttribute("maxLength", "2000");
    expect(message).toHaveAttribute("aria-describedby", "donation-portal-thank-you-help");
    expect(screen.getByText(/cannot contain HTML/)).toBeInTheDocument();

    fireEvent.change(message, { target: { value: "Thank you for giving." } });
    expect(setThankYouMessage).toHaveBeenCalledWith("Thank you for giving.");
  });
});
