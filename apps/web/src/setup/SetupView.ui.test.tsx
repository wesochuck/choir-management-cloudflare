import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthApiError } from "../api/client";
import { completeSetup, getSetupStatus, saveSetupProgress } from "../api";
import { SetupView } from "./SetupView";

vi.mock("../api", () => ({
  AuthApiError,
  completeSetup: vi.fn(),
  getSetupStatus: vi.fn(),
  saveSetupProgress: vi.fn(),
  uploadPrivateOrganizationFile: vi.fn(),
}));
vi.mock("./SetupDataImportStep", () => ({ SetupDataImportStep: () => <p>Import data</p> }));

const status = {
  allModulesConfigured: true,
  completedSteps: ["organization_info", "modules", "theme", "data_import"],
  currentStep: "launch",
  launched: false,
  organizationId: "organization-test",
  organizationName: "Test Organization",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSetupStatus).mockResolvedValue(status);
  vi.mocked(saveSetupProgress).mockResolvedValue({ saved: true });
  vi.mocked(completeSetup).mockResolvedValue({ completed: true });
});

describe("setup wizard completion", () => {
  it("shows completion after the launch save and successful completion response", async () => {
    render(<SetupView />);
    fireEvent.click(await screen.findByRole("button", { name: "Launch Organization" }));
    expect(await screen.findByRole("heading", { name: "Setup complete" })).toBeVisible();
    expect(saveSetupProgress).toHaveBeenCalledWith({ step: "launch", data: undefined });
    expect(completeSetup).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Setup could not be completed.")).not.toBeInTheDocument();
  });

  it("stays on Launch and does not complete setup when saving fails", async () => {
    vi.mocked(saveSetupProgress).mockRejectedValue(
      new AuthApiError("Your session has expired. Sign in again.", 401, "unauthorized"),
    );
    render(<SetupView />);
    fireEvent.click(await screen.findByRole("button", { name: "Launch Organization" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Your session has expired. Sign in again.",
    );
    expect(completeSetup).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Launch Organization" })).toBeEnabled();
  });

  it("does not advance to the next step after a failed progress save", async () => {
    vi.mocked(getSetupStatus).mockResolvedValue({ ...status, currentStep: "theme" });
    vi.mocked(saveSetupProgress).mockRejectedValue(new Error("Network failure"));
    render(<SetupView />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Progress could not be saved.");
    expect(screen.getByRole("heading", { name: "Theme" })).toBeVisible();
    expect(completeSetup).not.toHaveBeenCalled();
  });

  it("preserves launch errors and allows retry", async () => {
    vi.mocked(completeSetup).mockRejectedValueOnce(
      new AuthApiError("Setup is temporarily unavailable. Try again.", 503, "setup_error"),
    );
    render(<SetupView />);
    fireEvent.click(await screen.findByRole("button", { name: "Launch Organization" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Setup is temporarily unavailable. Try again.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Launch Organization" }));
    expect(await screen.findByRole("heading", { name: "Setup complete" })).toBeVisible();
  });

  it("does not show completion if the server reports incomplete setup", async () => {
    vi.mocked(completeSetup).mockResolvedValue({ completed: false });
    render(<SetupView />);
    fireEvent.click(await screen.findByRole("button", { name: "Launch Organization" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Setup could not be completed.");
    expect(screen.queryByRole("heading", { name: "Setup complete" })).not.toBeInTheDocument();
  });

  it("repairs missing Organization Info for a live Organization without replaying module setup", async () => {
    const launched = {
      ...status,
      completedSteps: ["modules", "theme", "data_import", "launch"],
      launched: true,
      currentStep: null,
    };
    vi.mocked(getSetupStatus)
      .mockResolvedValueOnce(launched)
      .mockResolvedValue({
        ...launched,
        completedSteps: ["organization_info", ...launched.completedSteps],
      });
    render(<SetupView />);
    expect(await screen.findByRole("heading", { name: "Organization Info" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Setup complete" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Setup complete" })).toBeVisible();
    expect(saveSetupProgress).toHaveBeenCalledTimes(1);
    expect(saveSetupProgress).toHaveBeenCalledWith(
      expect.objectContaining({ step: "organization_info" }),
    );
    expect(completeSetup).not.toHaveBeenCalled();
  });

  it("still shows the missing step when a repair save fails", async () => {
    vi.mocked(getSetupStatus).mockResolvedValue({
      ...status,
      completedSteps: ["modules", "theme", "data_import", "launch"],
      launched: true,
      currentStep: null,
    });
    vi.mocked(saveSetupProgress).mockRejectedValue(new Error("Network failure"));
    render(<SetupView />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Progress could not be saved.");
    expect(screen.getByRole("heading", { name: "Organization Info" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Setup complete" })).not.toBeInTheDocument();
  });

  it("does not claim completion when status cannot be refreshed after a repair save", async () => {
    vi.mocked(getSetupStatus)
      .mockResolvedValueOnce({
        ...status,
        completedSteps: ["modules", "theme", "data_import", "launch"],
        launched: true,
        currentStep: null,
      })
      .mockRejectedValue(new Error("Network failure"));
    render(<SetupView />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Changes saved, but setup status could not be refreshed. Try again.",
    );
    expect(screen.queryByRole("heading", { name: "Setup complete" })).not.toBeInTheDocument();
    expect(saveSetupProgress).toHaveBeenCalledTimes(1);
  });

  it("recognizes setup already completed on the server when reloaded", async () => {
    vi.mocked(getSetupStatus).mockResolvedValue({
      ...status,
      completedSteps: [...status.completedSteps, "launch"],
      launched: true,
      currentStep: null,
    });
    render(<SetupView />);
    expect(await screen.findByRole("heading", { name: "Setup complete" })).toBeVisible();
    await waitFor(() => {
      expect(completeSetup).not.toHaveBeenCalled();
    });
  });
});
