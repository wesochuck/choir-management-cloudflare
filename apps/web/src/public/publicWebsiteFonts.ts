export const publicWebsiteFontStacks = {
  "casual-handwritten": '"Segoe Print", "Bradley Hand", cursive',
  "formal-sans": "Arial, Helvetica, sans-serif",
  "formal-script": '"Brush Script MT", "Lucida Handwriting", cursive',
  "friendly-sans": '"Trebuchet MS", "Lucida Grande", sans-serif',
  "modern-serif": '"Iowan Old Style", "Palatino Linotype", serif',
  serif: 'Georgia, "Times New Roman", serif',
  system: "system-ui, sans-serif",
} as const;

export type PublicWebsiteFont = keyof typeof publicWebsiteFontStacks;

export const websiteFonts = [
  "system",
  "serif",
  "modern-serif",
  "friendly-sans",
  "formal-sans",
  "casual-handwritten",
  "formal-script",
] as const satisfies readonly PublicWebsiteFont[];

export function isPublicWebsiteFont(value: string): value is PublicWebsiteFont {
  return Object.hasOwn(publicWebsiteFontStacks, value);
}

export function fontLabel(font: PublicWebsiteFont): string {
  return font
    .split("-")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}
