import { lastNameSortKey } from "./name";

export type EventRsvpStatus = "No" | "Pending" | "Yes";
export type EventRsvpExportSort = "lastName" | "section";

interface EventRsvpExportSinger {
  readonly displayName: string;
  readonly isSectionLeader: boolean;
  readonly rsvp: EventRsvpStatus;
  readonly voicePart: string;
}

interface EventRsvpExportConfiguration {
  readonly sections: readonly { readonly code: string; readonly name: string }[];
  readonly voiceParts: readonly { readonly label: string; readonly sectionCode: string }[];
}

interface RenderEventRsvpCsvInput extends EventRsvpExportConfiguration {
  readonly eventTitle: string;
  readonly singers: readonly EventRsvpExportSinger[];
  readonly sort: EventRsvpExportSort;
}

function quoteCsvValue(value: string): string {
  let safeValue = value.replaceAll('"', '""');
  if (/^[=+\-@]/.test(safeValue)) safeValue = `'${safeValue}`;
  return `"${safeValue}"`;
}

function fallbackSectionCode(voicePart: string): string {
  const clean = voicePart.trim();
  if (/^(soprano|s)(\s*\d+)?$/i.test(clean)) return "S";
  if (/^(alto|a)(\s*\d+)?$/i.test(clean)) return "A";
  if (/^(tenor|t)(\s*\d+)?$/i.test(clean)) return "T";
  if (/^(bass|b|baritone|bar)(\s*\d+)?$/i.test(clean)) return "B";
  return "Other";
}

function singerSectionCode(
  voicePart: string,
  voiceParts: RenderEventRsvpCsvInput["voiceParts"],
): string {
  return (
    voiceParts.find(({ label }) => label === voicePart)?.sectionCode ??
    fallbackSectionCode(voicePart)
  );
}

function groupLabel(status: EventRsvpStatus): string {
  if (status === "Yes") return "Attending (Yes)";
  if (status === "No") return "Declined (No)";
  return "No Response (Pending)";
}

function renderSinger(singer: EventRsvpExportSinger, input: RenderEventRsvpCsvInput): string {
  const sectionCode = singer.voicePart ? singerSectionCode(singer.voicePart, input.voiceParts) : "";
  const sectionName = singer.voicePart
    ? (input.sections.find(({ code }) => code === sectionCode)?.name ?? sectionCode)
    : "Unassigned";
  return [
    quoteCsvValue(singer.displayName),
    quoteCsvValue(sectionName),
    quoteCsvValue(singer.voicePart || "Not sure"),
    quoteCsvValue(input.eventTitle || "Event"),
    quoteCsvValue(singer.rsvp),
  ].join(",");
}

function sortSingers(
  singers: readonly EventRsvpExportSinger[],
  input: RenderEventRsvpCsvInput,
): readonly EventRsvpExportSinger[] {
  return [...singers].sort((left, right) => {
    if (input.sort === "section") {
      const leftCode = singerSectionCode(left.voicePart, input.voiceParts);
      const rightCode = singerSectionCode(right.voicePart, input.voiceParts);
      const leftIndex = input.sections.findIndex(({ code }) => code === leftCode);
      const rightIndex = input.sections.findIndex(({ code }) => code === rightCode);
      const normalizedLeft = leftIndex === -1 ? 999 : leftIndex;
      const normalizedRight = rightIndex === -1 ? 999 : rightIndex;
      if (normalizedLeft !== normalizedRight) return normalizedLeft - normalizedRight;
    }
    const comparison = lastNameSortKey(left.displayName).localeCompare(
      lastNameSortKey(right.displayName),
    );
    return comparison === 0 ? left.displayName.localeCompare(right.displayName) : comparison;
  });
}

export function eventRsvpExportFilename(eventTitle: string, eventType: string): string {
  const name = (eventTitle || eventType || "event").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return `${name}_rsvp_export.csv`;
}

export function renderEventRsvpCsv(input: RenderEventRsvpCsvInput): string {
  const header = "Name,Section,Voice Part,Event Title,RSVP Status";
  const lines = [header];
  let firstGroup = true;
  for (const status of ["Yes", "No", "Pending"] as const) {
    const singers = input.singers.filter((singer) => singer.rsvp === status);
    if (singers.length === 0) continue;
    if (!firstGroup) lines.push("");
    firstGroup = false;
    lines.push(`${quoteCsvValue(groupLabel(status))},,,,`);
    lines.push(...sortSingers(singers, input).map((singer) => renderSinger(singer, input)));
  }
  const leaders = input.singers.filter(({ isSectionLeader }) => isSectionLeader);
  if (leaders.length > 0) {
    lines.push("", "Section Leaders", header);
    lines.push(...sortSingers(leaders, input).map((singer) => renderSinger(singer, input)));
  }
  return lines.join("\n");
}
