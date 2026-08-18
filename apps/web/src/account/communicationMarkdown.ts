import type { OrganizationEvent } from "@choir/contracts";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isSafeHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function renderInline(value: string): string {
  const links: string[] = [];
  const escaped = escapeHtml(value);
  const withPolls = escaped.replace(
    /\{\{POLL_LINK:[0-9a-f-]{36}\}\}/gi,
    '<span class="communication-poll-link-placeholder">Respond Here (No login required)</span>',
  );
  const withLinks = withPolls.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (match, label: string, url: string) => {
      if (!isSafeHttpUrl(url)) return match;
      const index = links.length;
      links.push(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
      return `@@LINK_${String(index)}@@`;
    },
  );

  const formatted = withLinks
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>");

  return formatted.replace(/@@LINK_(\d+)@@/g, (_, index: string) => links[Number(index)] ?? "");
}

function formatPreviewDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "August 20, 2026 at 7:00 PM"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeStyle: "short" }).format(date);
}

function formatPreviewTime(value: string): string {
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value.split(":") : null;
  if (!match) return value.length > 0 ? value : "6:30 PM";
  const date = new Date(2000, 0, 1, Number(match[0]), Number(match[1]));
  return new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(date);
}

function previewText(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : fallback;
}

export function communicationPreviewValues(
  event: OrganizationEvent | null,
): Readonly<Record<string, string>> {
  const eventTitle = event?.title ?? "Example Performance";
  const eventType = event?.type ?? "Performance";
  const eventDate = event ? formatPreviewDate(event.startsAt) : "August 20, 2026 at 7:00 PM";
  const eventLocation = previewText(event?.location, "Main Hall");
  const eventDetails = previewText(event?.details, "Event details will appear here.");
  const setlist = previewText(
    event?.setList.map(({ title }) => `- ${title}`).join("\n"),
    "- Set list not published",
  );

  return {
    "{singerName}": "Alex Morgan",
    "{eventTitle}": eventTitle,
    "{eventType}": eventType,
    "{eventDate}": eventDate,
    "{eventLocation}": eventLocation,
    "{eventCallTime}": formatPreviewTime(event?.callTime ?? ""),
    "{eventDetails}": eventDetails,
    "{setlist}": setlist,
    "{ticketQuantity}": "2",
    "{ticketAmount}": "$25.00",
    "{ticketBundleName}": "Spring Concert Pass",
    "{{RSVP_LINKS}}": "View RSVP details",
    "{{PLAYER_LINK}}": "Open practice player",
    "{{TICKET_LINK}}": "View ticket order",
    "{attendanceRate}": "85%",
    "{presentCount}": "17",
    "{totalCount}": "20",
    "{absenteesList}": "- Jordan Lee\n- Taylor Kim",
    "{thresholdWarningsSection}":
      "### Rehearsal follow-up warnings\n- Jordan Lee (3 missed Rehearsals)",
    "{auditionDate}": "August 15, 2026",
    "{auditionTime}": "6:30 PM",
    "{auditionDateTime}": "August 15, 2026 at 6:30 PM",
    "{auditionLocation}": "Main Hall",
    "{{AUDITION_LINK}}": "Review audition details",
  };
}

export function renderCommunicationMarkdownPreview(
  value: string,
  replacements: Readonly<Record<string, string>> = {},
): string {
  const populatedValue = Object.entries(replacements).reduce((message, [tag, replacement]) => {
    const scalarTag = /^\{([^{}]+)\}$/.exec(tag)?.[1];
    return (scalarTag ? message.split(`{{${scalarTag}}}`).join(replacement) : message)
      .split(tag)
      .join(replacement);
  }, value);
  return populatedValue
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("### ")) return `<h5>${renderInline(trimmed.slice(4))}</h5>`;
      if (trimmed.startsWith("## ")) return `<h4>${renderInline(trimmed.slice(3))}</h4>`;
      if (trimmed.startsWith("# ")) return `<h3>${renderInline(trimmed.slice(2))}</h3>`;
      if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        return `<li>${renderInline(trimmed.slice(2))}</li>`;
      }
      return trimmed ? `<p>${renderInline(trimmed)}</p>` : "<br />";
    })
    .join("")
    .replace(/(<li>.*?<\/li>)+/g, (list) => `<ul>${list}</ul>`);
}
