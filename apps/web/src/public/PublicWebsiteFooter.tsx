import {
  publicWebsiteSettingsRequestSchema,
  type PublicWebsiteSettingsRequest,
} from "@choir/contracts";
import { PublicCopy } from "./PublicCopy";

export function PublicWebsiteFooter({
  settings,
  organizationName,
  year,
}: {
  readonly settings: PublicWebsiteSettingsRequest;
  readonly organizationName: string;
  readonly year: string | number;
}) {
  return (
    <footer className="public-site-footer">
      <div className="public-site-footer__content">
        <PublicCopy text={settings.footerText} />
        {(settings.footerEmbeds?.length ?? 0) > 0 ? (
          <div className="public-site-footer__embeds">
            {settings.footerEmbeds?.map((candidate, index) => {
              const parsed = publicWebsiteSettingsRequestSchema.safeParse({
                footerEmbeds: [candidate],
              });
              const embed = parsed.success ? parsed.data.footerEmbeds?.[0] : undefined;
              if (!embed) return null;
              return (
                <div
                  className={`public-footer-embed public-footer-embed--${embed.kind}`}
                  key={index}
                >
                  {embed.kind === "iframe" ? (
                    <iframe
                      title={embed.title}
                      src={embed.src}
                      height={embed.height}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      sandbox="allow-scripts"
                    />
                  ) : embed.href ? (
                    <a href={embed.href} target="_blank" rel="noopener noreferrer">
                      <img
                        alt={embed.title}
                        src={embed.src}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    </a>
                  ) : (
                    <img
                      alt={embed.title}
                      src={embed.src}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  )}
                  {embed.kind === "iframe" && embed.href ? (
                    <a href={embed.href} target="_blank" rel="noopener noreferrer">
                      {embed.title}
                    </a>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
      <div className="public-site-footer__meta">
        <p>
          © {year} {organizationName}
        </p>
        <div className="public-site-footer__links">
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          {settings.contactEmail ? (
            <a href={`mailto:${settings.contactEmail}`}>Contact us</a>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
