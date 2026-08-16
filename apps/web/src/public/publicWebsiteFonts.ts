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
