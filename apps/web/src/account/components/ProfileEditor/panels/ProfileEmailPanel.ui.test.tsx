import {
  organizationProfileRequestSchema,
  type OrganizationProfileRequest,
} from "@choir/contracts";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

import { ProfileEmailPanel } from "./ProfileEmailPanel";

const baseProfileRequest: OrganizationProfileRequest = organizationProfileRequestSchema.parse({
  displayName: "Jordan Singer",
  doNotEmail: false,
  globalStatus: "Active",
  phone: "555-0144",
  voicePart: "Alto",
});

describe("ProfileEmailPanel notification copy and semantics", () => {
  it("renders grammatically correct notification guarantee copy and single heading", () => {
    const setProfile = vi.fn();
    render(
      <ProfileEmailPanel
        busy={false}
        editingProfileRecord={null}
        profile={baseProfileRequest}
        setProfile={setProfile}
      />,
    );

    // Verify correct description copy (not "delivery is never guarantee")
    expect(
      screen.getByText(
        "Choose what messages this member receives. Local settings only; provider delivery is never guaranteed.",
      ),
    ).toBeInTheDocument();

    // Verify panel title heading
    const heading = screen.getByRole("heading", { level: 3, name: "Email & notifications" });
    expect(heading).toBeInTheDocument();

    // Verify not blocked status pill tooltip
    const pill = screen.getByText("Not blocked");
    expect(pill).toHaveAttribute(
      "title",
      "Local settings allow email. Provider delivery is not guaranteed.",
    );
  });

  it("renders financial alerts switch with donations copy in label and description", () => {
    const setProfile = vi.fn();
    render(
      <ProfileEmailPanel
        busy={false}
        editingProfileRecord={null}
        profile={baseProfileRequest}
        setProfile={setProfile}
      />,
    );

    const switchControl = screen.getByLabelText(
      "Financial alerts — Receive updates about ticket sales, donations, and finances",
    );
    expect(switchControl).toBeInTheDocument();
    expect(
      screen.getByText("Updates about ticket sales, donations, and finances."),
    ).toBeInTheDocument();
  });
});
