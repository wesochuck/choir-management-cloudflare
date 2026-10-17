import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { PublicWebsiteHero } from "./PublicWebsiteHero";

it.each(["", " \n "])(
  "omits the overlay for empty hero text while retaining the image",
  (blank) => {
    const { container } = render(
      <PublicWebsiteHero
        headline={blank}
        subtitle={blank}
        imageUrl="/hero.png"
        organizationName="Our Choir"
      />,
    );
    expect(container.querySelector(".public-hero")).toHaveStyle({
      backgroundImage: 'url("/hero.png")',
    });
    expect(container.querySelector(".public-hero > div")).toBeNull();
    expect(screen.getByRole("heading", { name: "Our Choir" })).toHaveClass("sr-only");
  },
);
it.each([
  { headline: "Our Concert", subtitle: "" },
  { headline: "", subtitle: "Music for all" },
  { headline: "Our Concert", subtitle: "Music for all" },
])("keeps an overlay when either text field has content", ({ headline, subtitle }) => {
  const { container } = render(
    <PublicWebsiteHero
      headline={headline}
      subtitle={subtitle}
      imageUrl="/hero.png"
      organizationName="Our Choir"
    />,
  );
  expect(container.querySelector(".public-hero > div")).not.toBeNull();
  if (headline) expect(screen.getByRole("heading", { name: headline })).toBeVisible();
  if (subtitle) expect(screen.getByText(subtitle)).toBeVisible();
  expect(container.querySelectorAll("h1")).toHaveLength(1);
});
