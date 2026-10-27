import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

import { DonationLevelDialog } from "./DonationLevelDialog";
import { DonationLevelsTab } from "./DonationLevelsTab";

describe("DonationLevelsTab and DonationLevelDialog", () => {
  it("renders donation levels table with Program ad column and ad badges", () => {
    const editLevel = vi.fn();
    const deleteLevel = vi.fn();
    const newLevel = vi.fn();

    render(
      <DonationLevelsTab
        busy={false}
        deleteLevel={deleteLevel}
        editLevel={editLevel}
        newLevel={newLevel}
        settingsState={{
          settings: {
            buttonText: "Donate",
            description: "Support our choir.",
            levels: [
              {
                amountCents: 5000,
                artworkInstructions: "",
                benefit: "Mention in program",
                id: "lvl-1",
                includesProgramAd: false,
                label: "Friend",
              },
              {
                amountCents: 25000,
                artworkInstructions: "Half page ad: 300 DPI",
                benefit: "Half page program ad",
                id: "lvl-2",
                includesProgramAd: true,
                label: "Corporate Sponsor",
              },
            ],
            thankYouMessage: "Thank you!",
          },
          status: "ready",
        }}
      />,
    );

    expect(screen.getByRole("columnheader", { name: "Program ad" })).toBeInTheDocument();
    expect(screen.getByText("Includes ad")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("toggles Includes a program advertisement and shows artwork instructions in DonationLevelDialog", async () => {
    const user = userEvent.setup();
    const setLevelIncludesProgramAd = vi.fn();
    const setLevelArtworkInstructions = vi.fn();
    const saveLevel = vi.fn((e: React.SyntheticEvent) => {
      e.preventDefault();
      return Promise.resolve();
    });

    const { rerender } = render(
      <DonationLevelDialog
        busy={false}
        editingLevelId="lvl-2"
        levelAmount="250"
        levelArtworkInstructions=""
        levelBenefit="Half page ad"
        levelIncludesProgramAd={false}
        levelLabel="Corporate Sponsor"
        onClose={vi.fn()}
        open={true}
        saveLevel={saveLevel}
        setLevelAmount={vi.fn()}
        setLevelArtworkInstructions={setLevelArtworkInstructions}
        setLevelBenefit={vi.fn()}
        setLevelIncludesProgramAd={setLevelIncludesProgramAd}
        setLevelLabel={vi.fn()}
      />,
    );

    const checkbox = screen.getByLabelText("Includes a program advertisement");
    expect(checkbox).not.toBeChecked();
    expect(screen.queryByLabelText("Artwork instructions")).not.toBeInTheDocument();

    await user.click(checkbox);
    expect(setLevelIncludesProgramAd).toHaveBeenCalledWith(true);

    // Rerender with levelIncludesProgramAd = true
    rerender(
      <DonationLevelDialog
        busy={false}
        editingLevelId="lvl-2"
        levelAmount="250"
        levelArtworkInstructions="Quarter page color ad"
        levelBenefit="Half page ad"
        levelIncludesProgramAd={true}
        levelLabel="Corporate Sponsor"
        onClose={vi.fn()}
        open={true}
        saveLevel={saveLevel}
        setLevelAmount={vi.fn()}
        setLevelArtworkInstructions={setLevelArtworkInstructions}
        setLevelBenefit={vi.fn()}
        setLevelIncludesProgramAd={setLevelIncludesProgramAd}
        setLevelLabel={vi.fn()}
      />,
    );

    const instructionsTextarea = screen.getByLabelText("Artwork instructions");
    expect(instructionsTextarea).toBeInTheDocument();
    expect(instructionsTextarea).toHaveValue("Quarter page color ad");

    fireEvent.change(instructionsTextarea, { target: { value: "Updated specs" } });
    expect(setLevelArtworkInstructions).toHaveBeenCalledWith("Updated specs");
  });
});
