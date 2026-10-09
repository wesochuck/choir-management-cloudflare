import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { PublicGraphicImage } from "./PublicGraphicImage";

describe("PublicGraphicImage", () => {
  it("renders an img when src is provided", () => {
    render(
      <PublicGraphicImage
        alt="Concert Poster"
        className="hero__img"
        src="https://example.com/poster.jpg"
        wrapperClassName="hero__wrapper"
      />,
    );

    const img = screen.getByAltText("Concert Poster");
    expect(img).toHaveAttribute("src", "https://example.com/poster.jpg");
    expect(img).toHaveClass("hero__img");
    expect(img.parentElement).toHaveClass("hero__wrapper");
    expect(img.parentElement).toHaveClass("is-loading");
  });

  it("adds is-loaded class on image load", () => {
    render(
      <PublicGraphicImage
        alt="Concert Poster"
        src="https://example.com/poster.jpg"
        wrapperClassName="hero__wrapper"
      />,
    );

    const img = screen.getByAltText("Concert Poster");
    fireEvent.load(img);
    expect(img.parentElement).toHaveClass("is-loaded");
    expect(img.parentElement).not.toHaveClass("is-loading");
  });

  it("completely unmounts wrapper and image when image fails to load", () => {
    const { container } = render(
      <PublicGraphicImage
        alt="Broken Image"
        src="https://example.com/broken.jpg"
        wrapperClassName="hero__wrapper"
      />,
    );

    const img = screen.getByAltText("Broken Image");
    expect(img).toBeInTheDocument();

    fireEvent.error(img);

    expect(screen.queryByAltText("Broken Image")).not.toBeInTheDocument();
    expect(container.querySelector(".hero__wrapper")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when src is null or undefined or empty", () => {
    const { container: nullContainer } = render(
      <PublicGraphicImage alt="Empty" src={null} wrapperClassName="wrapper" />,
    );
    expect(nullContainer).toBeEmptyDOMElement();

    const { container: undefContainer } = render(
      <PublicGraphicImage alt="Empty" src={undefined} wrapperClassName="wrapper" />,
    );
    expect(undefContainer).toBeEmptyDOMElement();

    const { container: emptyContainer } = render(
      <PublicGraphicImage alt="Empty" src="" wrapperClassName="wrapper" />,
    );
    expect(emptyContainer).toBeEmptyDOMElement();
  });
});
