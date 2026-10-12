import type { Locator } from "@playwright/test";

export type EventEditorSection = "basics" | "schedule" | "rsvp" | "tickets" | "public";

const SECTION_TAB_NAMES: Record<EventEditorSection, RegExp> = {
  basics: /Basics/,
  schedule: /Schedule & venue/,
  rsvp: /RSVPs & reminders/,
  tickets: /Ticket sales/,
  public: /Public content/,
};

export async function selectEventEditorSection(
  dialog: Locator,
  section: EventEditorSection,
  tabName?: RegExp | string,
): Promise<void> {
  const tab = dialog.getByRole("tab", { name: tabName ?? SECTION_TAB_NAMES[section] });
  if (await tab.isVisible().catch(() => false)) {
    await tab.click();
  } else {
    await dialog.locator("#event-editor-section-select").selectOption(section);
  }
}
