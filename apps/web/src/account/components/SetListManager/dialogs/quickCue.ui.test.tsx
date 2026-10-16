import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

import { PortalContainerHost, PortalContainerProvider } from "@choir/ui";
import { CustomItemDialog } from "./CustomItemDialog";
import { EditItemDialog } from "./EditItemDialog";
import type { SetListItem } from "../types";

describe("Quick Cue defaults", () => {
  it("uses No Announcements when a new custom entry is changed to a Quick Cue", () => {
    const setCustomTitle = vi.fn();
    render(
      <PortalContainerProvider>
        <CustomItemDialog
          addCustomItem={vi.fn()}
          canAddCustomEntry={true}
          customComposer=""
          customCueInstruction=""
          customCueKind="timed"
          customDuration=""
          customNotes=""
          customTitle="Intermission"
          customType="intermission"
          onClose={vi.fn()}
          open={true}
          setCustomComposer={vi.fn()}
          setCustomCueInstruction={vi.fn()}
          setCustomCueKind={vi.fn()}
          setCustomDuration={vi.fn()}
          setCustomNotes={vi.fn()}
          setCustomTitle={setCustomTitle}
          setCustomType={vi.fn()}
        />
        <PortalContainerHost />
      </PortalContainerProvider>,
    );

    const dialog = screen.getByRole("dialog", { name: "Add custom item" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Quick cue" }));

    expect(setCustomTitle).toHaveBeenCalledWith("No Announcements");
  });

  it("uses No Announcements when an inserted timed entry is changed to a Quick Cue", () => {
    const setEditingItem = vi.fn();
    const editingItem: SetListItem = {
      cueKind: "timed",
      id: "cue-1",
      title: "Intermission",
      type: "intermission",
    };

    render(
      <PortalContainerProvider>
        <EditItemDialog
          closeItemEditor={vi.fn()}
          editingItem={editingItem}
          error={null}
          performerLabelPlural="Performers"
          resources={{ events: [], music: [], profiles: [], venues: [] }}
          saveItemEdit={vi.fn()}
          setEditingItem={setEditingItem}
        />
        <PortalContainerHost />
      </PortalContainerProvider>,
    );

    const dialog = screen.getByRole("dialog", { name: "Edit set-list item" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Quick cue" }));

    expect(setEditingItem).toHaveBeenCalledWith(
      expect.objectContaining({ cueKind: "quick", duration: undefined, title: "No Announcements" }),
    );
  });

  it("disables adding a custom entry when it would sit next to a Quick Cue", () => {
    render(
      <PortalContainerProvider>
        <CustomItemDialog
          addCustomItem={vi.fn()}
          canAddCustomEntry={false}
          customComposer=""
          customCueInstruction=""
          customCueKind="timed"
          customDuration=""
          customNotes=""
          customTitle=""
          customType="song"
          onClose={vi.fn()}
          open={true}
          setCustomComposer={vi.fn()}
          setCustomCueInstruction={vi.fn()}
          setCustomCueKind={vi.fn()}
          setCustomDuration={vi.fn()}
          setCustomNotes={vi.fn()}
          setCustomTitle={vi.fn()}
          setCustomType={vi.fn()}
        />
        <PortalContainerHost />
      </PortalContainerProvider>,
    );

    const dialog = screen.getByRole("dialog", { name: "Add custom item" });
    expect(within(dialog).getByRole("option", { name: "Custom entry" })).toBeDisabled();
    expect(
      within(dialog).getByText(/cannot be placed directly before or after a Quick Cue/i),
    ).toBeInTheDocument();
  });
});
