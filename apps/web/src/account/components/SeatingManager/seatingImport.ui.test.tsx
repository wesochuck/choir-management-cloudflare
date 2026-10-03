import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  organizationProfileSchema,
  type OrganizationProfile,
  organizationRosterConfigurationRequestSchema,
} from "@choir/contracts";
import { defaultRosterConfiguration, defaultSeatingConfiguration } from "@choir/domain";
import { SeatingImportDialog } from "./SeatingImportDialog";
import {
  getOrganizationSeatingConfiguration,
  updateOrganizationSeatingConfiguration,
} from "../../../api";

vi.mock("../../../api", () => ({
  getOrganizationSeatingConfiguration: vi.fn(),
  updateOrganizationSeatingConfiguration: vi.fn(),
}));
const profile = organizationProfileSchema.parse({
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "Alex Singer",
  globalStatus: "Active",
  voicePart: "S1",
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
});
const configuration = {
  defaultFormationId: defaultSeatingConfiguration.defaultFormationId,
  formations: defaultSeatingConfiguration.formations.map((f) => ({
    ...f,
    sectionOrder: [...f.sectionOrder],
  })),
};
const formation = {
  ...configuration.formations[0],
  id: "columns-standard",
  name: "Legacy S–B–T–A",
  isVoicePartLayout: false,
  strategy: "vertical_column",
  sectionOrder: ["S", "B", "T", "A"],
};
const template = {
  format: "choir-seating-template",
  version: 1,
  charts: [
    {
      name: "America 250",
      formation,
      rowCounts: [2],
      assignments: [{ seatKey: "0-0", name: "alex singer" }],
    },
  ],
};

async function upload(value: unknown = template) {
  const file = new File([JSON.stringify(value)], "seating.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: () => Promise.resolve(JSON.stringify(value)) });
  await userEvent.upload(screen.getByLabelText("Seating template (JSON)"), file);
}
function setup(
  eligible = true,
  importer = vi.fn().mockResolvedValue(undefined),
  profiles: OrganizationProfile[] = [profile],
) {
  const onClose = vi.fn();
  render(
    <SeatingImportDialog
      charts={[]}
      eligibleProfiles={eligible ? [profile] : []}
      importChart={importer}
      onClose={onClose}
      onConfigurationSaved={vi.fn()}
      performanceName="Destination concert"
      resources={{
        profiles,
        events: [],
        roster: organizationRosterConfigurationRequestSchema.parse(defaultRosterConfiguration),
        seating: configuration,
      }}
      venueId={null}
    />,
  );
  return { importer, onClose };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOrganizationSeatingConfiguration).mockResolvedValue(configuration);
  vi.mocked(updateOrganizationSeatingConfiguration).mockImplementation((c) => Promise.resolve(c));
});
describe("seating chart import review", () => {
  it("matches names, adds a separate formation, and creates a new chart with destination IDs", async () => {
    const { importer, onClose } = setup();
    await userEvent.selectOptions(screen.getByLabelText("Import as"), "chart");
    await upload();
    expect(
      await screen.findByText("1 rows · 2 seats · 1 matched assignments · 0 need review"),
    ).toBeVisible();
    await userEvent.selectOptions(screen.getByLabelText("Formation"), "__template__");
    await userEvent.click(screen.getByRole("button", { name: "Import as new chart" }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
    expect(importer).toHaveBeenCalledWith({
      name: "America 250 (imported)",
      formationId: "import-columns-standard",
      rowCounts: [2],
      assignments: { "0-0": profile.id },
      sectionSuggestions: {},
      sortOrder: 0,
      venueId: null,
    });
    expect(
      vi.mocked(updateOrganizationSeatingConfiguration).mock.calls[0]?.[0].formations.slice(0, 2),
    ).toEqual(configuration.formations);
  });
  it("requires explicit acceptance of empty seats for ineligible matches", async () => {
    const { importer } = setup(false);
    await userEvent.selectOptions(screen.getByLabelText("Import as"), "chart");
    await upload();
    await userEvent.selectOptions(screen.getByLabelText("Formation"), "columns-standard");
    const button = screen.getByRole("button", { name: "Import as new chart" });
    expect(button).toBeDisabled();
    expect(
      screen.getByText("alex singer: Must be Active, have a voice part, and RSVP Yes"),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("checkbox", { name: "Leave these 1 seats empty" }));
    await userEvent.click(button);
    await waitFor(() => {
      expect(importer).toHaveBeenCalledWith(expect.objectContaining({ assignments: {} }));
    });
    expect(updateOrganizationSeatingConfiguration).not.toHaveBeenCalled();
  });
  it("shows validation failures and keeps invalid files from creating charts", async () => {
    const { importer } = setup();
    await userEvent.selectOptions(screen.getByLabelText("Import as"), "chart");
    await upload({ ...template, version: 2 });
    expect(await screen.findByRole("alert")).toHaveTextContent("not a valid seating template");
    expect(screen.getByRole("button", { name: "Import as new chart" })).toBeDisabled();
    expect(importer).not.toHaveBeenCalled();
  });
  it("keeps the preview open after authorization or creation failures", async () => {
    const { onClose } = setup(
      true,
      vi.fn().mockRejectedValue(new Error("Organization MFA verification required.")),
    );
    await userEvent.selectOptions(screen.getByLabelText("Import as"), "chart");
    await upload();
    await userEvent.selectOptions(screen.getByLabelText("Formation"), "columns-standard");
    await userEvent.click(screen.getByRole("button", { name: "Import as new chart" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Organization MFA verification required.",
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Import as new chart" })).toBeEnabled();
  });
  it("guards keyboard dismissal of an uploaded preview", async () => {
    const { onClose } = setup();
    await userEvent.selectOptions(screen.getByLabelText("Import as"), "chart");
    await upload();
    await screen.findByLabelText("New chart name");
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByRole("dialog", { name: "Discard unsaved changes?" })).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("reusable seating templates", () => {
  it("saves all assignments without current attendance and preserves unresolved names", async () => {
    const { importer, onClose } = setup(false);
    await upload({
      ...template,
      charts: [
        {
          ...template.charts[0],
          assignments: [
            { seatKey: "0-0", name: "alex singer" },
            { seatKey: "0-1", name: "Future Singer" },
          ],
        },
      ],
    });
    expect(screen.getByLabelText("Import as")).toHaveValue("template");
    const save = screen.getByRole("button", { name: "Save reusable template" });
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
    expect(importer).not.toHaveBeenCalled();
    expect(updateOrganizationSeatingConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        formations: configuration.formations,
        templates: [
          expect.objectContaining({
            name: "America 250 (imported)",
            formation,
            assignments: [
              { seatKey: "0-0", name: "alex singer", profileId: profile.id },
              { seatKey: "0-1", name: "Future Singer" },
            ],
          }),
        ],
      }),
    );
  });
  it("lets the manager resolve duplicate names without RSVP eligibility", async () => {
    const duplicate = { ...profile, id: "22222222-2222-4222-8222-222222222222", voicePart: "B1" };
    setup(false, vi.fn(), [profile, duplicate]);
    await upload();
    const select = screen.getByLabelText("Match alex singer · seat 0-0");
    await userEvent.selectOptions(select, duplicate.id);
    expect(select).toHaveValue(duplicate.id);
    await userEvent.click(screen.getByRole("button", { name: "Save reusable template" }));
    await waitFor(() => {
      expect(updateOrganizationSeatingConfiguration).toHaveBeenCalled();
    });
    expect(
      vi.mocked(updateOrganizationSeatingConfiguration).mock.calls[0]?.[0].templates?.[0]
        ?.assignments,
    ).toEqual([{ seatKey: "0-0", name: "alex singer", profileId: duplicate.id }]);
  });
  it("retains the review and names when saving is rejected", async () => {
    const { onClose } = setup(false);
    vi.mocked(updateOrganizationSeatingConfiguration).mockRejectedValue(
      new Error("Organization MFA verification required."),
    );
    await upload();
    await userEvent.click(screen.getByRole("button", { name: "Save reusable template" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Organization MFA verification required.",
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save reusable template" })).toBeEnabled();
  });
});
