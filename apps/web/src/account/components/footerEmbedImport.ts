import { publicWebsiteSettingsRequestSchema } from "@choir/contracts";

/** Read only supported attributes from an inert document; never render supplied HTML. */
export function importFooterEmbeds(code: string) {
  if (code.length > 20_000) throw new Error("Embed code must be 20,000 characters or fewer.");
  const document = new DOMParser().parseFromString(code, "text/html");
  if (document.querySelector("script, object, embed")) {
    throw new Error("Use a linked image or iframe embed. Script-based widgets are not supported.");
  }
  const embeds = Array.from(document.querySelectorAll("img, iframe")).map((element) => {
    const isImage = element.tagName === "IMG";
    const anchor = element.closest("a");
    const height = Number(element.getAttribute("height"));
    return {
      kind: isImage ? "image" : "iframe",
      title:
        [element.getAttribute(isImage ? "alt" : "title"), anchor?.getAttribute("aria-label")]
          .find((text) => text?.trim())
          ?.trim() ?? "Organization badge or widget",
      src: element.getAttribute("src") ?? "",
      href: anchor?.getAttribute("href") ?? "",
      height: height >= 100 && height <= 800 ? Math.round(height) : 240,
    };
  });
  if (embeds.length === 0) throw new Error("Paste embed code containing an image or iframe.");
  const parsed = publicWebsiteSettingsRequestSchema.safeParse({ footerEmbeds: embeds });
  if (!parsed.success) throw new Error("Use up to six images or iframes with valid HTTPS URLs.");
  return parsed.data.footerEmbeds ?? [];
}
