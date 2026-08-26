import type { OrganizationAuditionSettings } from "@choir/contracts";

export function formatTime12h(timeStr: string): string {
  if (!timeStr) return "";
  const [hoursStr, minutesStr] = timeStr.split(":");
  const hours = parseInt(hoursStr ?? "0", 10);
  const minutes = parseInt(minutesStr ?? "0", 10);
  if (Number.isNaN(hours)) return timeStr;
  const period = hours >= 12 ? "PM" : "AM";
  const formattedHours = String(hours % 12 === 0 ? 12 : hours % 12);
  const formattedMinutes = minutes < 10 ? `0${String(minutes)}` : String(minutes);
  return `${formattedHours}:${formattedMinutes} ${period}`;
}

export function capitalizeDay(day: string): string {
  if (!day) return "";
  return day.charAt(0).toUpperCase() + day.slice(1);
}

export function auditionSettingsKey(settings: OrganizationAuditionSettings): string {
  return JSON.stringify(settings);
}
