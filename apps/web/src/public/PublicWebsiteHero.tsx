export function PublicWebsiteHero({
  position = { x: 50, y: 50 },
  headline,
  subtitle,
  imageUrl,
  organizationName,
}: {
  readonly position?: { readonly x: number; readonly y: number } | undefined;
  readonly headline: string;
  readonly subtitle: string;
  readonly imageUrl: string | null;
  readonly organizationName: string;
}) {
  const heading = headline.trim();
  const description = subtitle.trim();
  return (
    <section
      className={`public-hero ${imageUrl ? "public-hero--image" : ""}`}
      style={
        imageUrl
          ? {
              backgroundImage: `url(${imageUrl})`,
              backgroundPosition: `${String(position.x)}% ${String(position.y)}%`,
            }
          : undefined
      }
    >
      {heading ? null : <h1 className="sr-only">{organizationName}</h1>}
      {heading || description ? (
        <div>
          {heading ? <h1>{heading}</h1> : null}
          {description ? <p>{description}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
