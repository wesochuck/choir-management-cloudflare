const practicePath = /^\/practice\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/u;
const maximumPracticeSlugLength = 48;

export const practiceShareCodePattern = /^[A-Za-z0-9_-]{21}[AQgw]$/u;

export function practiceShareSlug(title: string): string {
  return (
    title
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+/u, "")
      .slice(0, maximumPracticeSlugLength)
      .replace(/-+$/u, "") || "performance"
  );
}

export function practiceSharePathSlug(pathname: string): string | null {
  const slug = practicePath.exec(pathname)?.[1];
  return slug && slug.length <= maximumPracticeSlugLength ? slug : null;
}

export function isPracticePlayerPath(pathname: string): boolean {
  return pathname === "/player" || practiceSharePathSlug(pathname) !== null;
}
