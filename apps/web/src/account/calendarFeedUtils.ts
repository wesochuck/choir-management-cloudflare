export function maskCalendarUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.searchParams.has("token")) {
      parsed.searchParams.set("token", "••••••••");
      return parsed.toString();
    }
    return rawUrl;
  } catch {
    return rawUrl.replace(/([?&]token=)[^&]+/, "$1••••••••");
  }
}
