import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PublicWebsiteFooter } from "./PublicWebsiteFooter";
import { publicWebsiteSettingsRequestSchema } from "@choir/contracts";

it("renders linked images and isolated iframe widgets with accessible descriptions", () => {
  const settings = publicWebsiteSettingsRequestSchema.parse({
    footerText: "**Our supporters**\n\n<script>bad()</script>",
    footerEmbeds: [
      {
        kind: "image",
        title: "Silver seal",
        src: "https://widgets.guidestar.org/seal.svg",
        href: "https://app.candid.org/profile/123",
      },
      { kind: "iframe", title: "Partner widget", src: "https://partner.example/widget" },
    ],
  });
  const { container } = render(
    <PublicWebsiteFooter settings={settings} organizationName="Alpha Choir" year={2026} />,
  );
  expect(screen.getByText("Our supporters").tagName).toBe("STRONG");
  expect(container.querySelector("script")).toBeNull();
  const image = screen.getByRole("img", { name: "Silver seal" });
  expect(image.closest("a")).toHaveAttribute("href", "https://app.candid.org/profile/123");
  expect(image).toHaveAttribute("referrerpolicy", "no-referrer");
  const iframe = screen.getByTitle("Partner widget");
  expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
  expect(iframe).not.toHaveAttribute("srcdoc");
  expect(iframe).not.toHaveAttribute("allow");
  expect(screen.getByRole("link", { name: "Privacy" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Terms" })).toBeVisible();
});

describe("older website projections", () => {
  it("renders the standard footer when custom fields are omitted", () => {
    render(
      <PublicWebsiteFooter
        settings={publicWebsiteSettingsRequestSchema.parse({})}
        organizationName="Bravo Choir"
        year={2026}
      />,
    );
    expect(screen.getByText("© 2026 Bravo Choir")).toBeVisible();
  });
});
