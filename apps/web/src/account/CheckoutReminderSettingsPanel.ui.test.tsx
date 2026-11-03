import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { CheckoutReminderSettingsPanel } from "./CheckoutReminderSettingsPanel";
import { SaveCoordinatorProvider, SaveBar } from "../persistence";
import * as api from "../api/checkoutReminders";
vi.mock("../api/checkoutReminders", () => ({
  getCheckoutReminderSettings: vi.fn(),
  updateCheckoutReminderSettings: vi.fn(),
}));
const settings = {
  enabled: true,
  enabledSince: new Date().toISOString(),
  generation: 0,
  requestId: "11111111-1111-4111-8111-111111111111",
};
beforeEach(() => {
  vi.mocked(api.getCheckoutReminderSettings).mockResolvedValue(settings);
  vi.mocked(api.updateCheckoutReminderSettings).mockImplementation((enabled) =>
    Promise.resolve({
      ...settings,
      enabled,
      generation: 1,
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("checkout reminder settings", () => {
  it("loads authoritative settings and saves through the shared SaveBar", async () => {
    render(
      <SaveCoordinatorProvider>
        <CheckoutReminderSettingsPanel />
        <SaveBar />
      </SaveCoordinatorProvider>,
    );
    const checkbox = await screen.findByRole("checkbox", {
      name: "Send incomplete checkout reminders",
    });
    expect(checkbox).toBeChecked();
    await userEvent.click(checkbox);
    expect(api.updateCheckoutReminderSettings).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(api.updateCheckoutReminderSettings).toHaveBeenCalledWith(false);
    });
    await screen.findByText("Reminder settings saved.");
    expect(screen.getByRole("link", { name: "Edit reminder templates" })).toHaveAttribute(
      "href",
      "/admin/communications?tab=templates",
    );
  });
  it("shows a load error without an editable fallback toggle", async () => {
    vi.mocked(api.getCheckoutReminderSettings).mockRejectedValue(new Error("Settings unavailable"));
    render(<CheckoutReminderSettingsPanel />);
    await screen.findByRole("alert");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
