import type { OrganizationRosterConfiguration } from "@choir/contracts";

function trackDescription(key: string, configuration: OrganizationRosterConfiguration): string {
  if (key === "tutti") return "Full mix";
  return (
    configuration.sections.find(({ code }) => code === key)?.name ??
    configuration.voiceParts.find(({ label }) => label === key)?.fullName ??
    "Custom learning track"
  );
}

function safeLearningTrackNamePart(value: string): string {
  let sanitized = "";
  for (const character of value) {
    const codePoint = character.charCodeAt(0);
    sanitized += codePoint <= 31 || codePoint === 127 ? " " : character;
  }
  return sanitized.replace(/[\\/]/g, " - ").replace(/\s+/g, " ").trim();
}

export function learningTrackFileName(
  title: string,
  key: string,
  configuration: OrganizationRosterConfiguration,
): string {
  const base = [
    safeLearningTrackNamePart(title),
    safeLearningTrackNamePart(trackDescription(key, configuration)),
  ]
    .filter(Boolean)
    .join(" - ");
  return `${(base || "learning-track").slice(0, 251).trim()}.mp3`;
}
