export interface SetListDurationItem {
  readonly duration?: string | undefined;
}

function parseColonDuration(value: string): number | null {
  const parts = value.split(":");
  if ((parts.length !== 2 && parts.length !== 3) || parts.some((part) => !/^\d+$/.test(part))) {
    return null;
  }
  const numbers = parts.map(Number);
  const seconds = numbers.at(-1) ?? 0;
  const minutes = numbers.at(-2) ?? 0;
  const hours = parts.length === 3 ? (numbers[0] ?? 0) : 0;
  return minutes < 60 && seconds < 60 ? hours * 3_600 + minutes * 60 + seconds : null;
}

function parseNamedDuration(value: string): number | null {
  const pattern =
    /^(?=.*\d)\s*(?:(\d+)\s*(?:h|hr|hrs|hours?)\s*)?(?:(\d+)\s*(?:m|min|mins|minutes?)\s*)?(?:(\d+)\s*(?:s|sec|secs|seconds?)\s*)?$/;
  const match = pattern.exec(value);
  if (!match || (!match[1] && !match[2] && !match[3])) return null;
  return Number(match[1] ?? 0) * 3_600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

export function parseSetListDuration(value: string | undefined): number | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return 0;
  if (/^\d+$/.test(normalized)) return Number(normalized) * 60;
  return normalized.includes(":") ? parseColonDuration(normalized) : parseNamedDuration(normalized);
}

export function formatSetListDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3_600);
  const minutes = Math.floor((safeSeconds % 3_600) / 60);
  const seconds = safeSeconds % 60;
  const trailing = String(seconds).padStart(2, "0");
  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, "0")}:${trailing}`
    : `${String(minutes)}:${trailing}`;
}

export function normalizeSetListDuration(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const parsed = parseSetListDuration(trimmed);
  return parsed === null ? trimmed : formatSetListDuration(parsed);
}

export function calculateSetListDuration(items: readonly SetListDurationItem[]): number {
  return items.reduce((total, item) => total + (parseSetListDuration(item.duration) ?? 0), 0);
}

export function hasSetListPiece(
  items: readonly { readonly pieceId?: string | undefined }[],
  pieceId: string,
): boolean {
  return items.some((item) => item.pieceId === pieceId);
}

export function moveSetListItem<T>(
  items: readonly T[],
  index: number,
  direction: -1 | 1,
): readonly T[] {
  const target = index + direction;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items;
  const reordered = [...items];
  reordered.splice(target, 0, ...reordered.splice(index, 1));
  return reordered;
}

export interface SetListTimingItem {
  readonly duration?: string | undefined;
  readonly durationSeconds?: number | undefined;
  readonly type?: string | undefined;
}

export interface SetListTimingBreakdown {
  readonly defaultTransitionCount: number;
  readonly defaultTransitionDuration: number;
  readonly estimatedRuntime: number;
  readonly intermissionsDuration: number;
  readonly missingDurationCustomCount: number;
  readonly songsDuration: number;
}

export function isSetListSongItem(item: { readonly type?: string | undefined }): boolean {
  return item.type !== "intermission";
}

export function calculateSetListTransitionCount(
  items: readonly { readonly type?: string | undefined }[],
): number {
  let transitionCount = 0;
  for (let index = 0; index < items.length - 1; index += 1) {
    const current = items[index];
    const next = items[index + 1];
    if (current && next && isSetListSongItem(current) && isSetListSongItem(next)) {
      transitionCount += 1;
    }
  }
  return transitionCount;
}

export function calculateSetListTiming<T extends SetListTimingItem>(
  items: readonly T[],
  defaultTransitionSeconds = 0,
  resolveDurationSeconds?: (item: T) => number,
): SetListTimingBreakdown {
  let songsDuration = 0;
  let intermissionsDuration = 0;
  let missingDurationCustomCount = 0;

  for (const item of items) {
    const seconds = resolveDurationSeconds
      ? resolveDurationSeconds(item)
      : (item.durationSeconds ?? parseSetListDuration(item.duration) ?? 0);

    if (isSetListSongItem(item)) {
      songsDuration += seconds;
    } else {
      intermissionsDuration += seconds;
      if (seconds <= 0) {
        missingDurationCustomCount += 1;
      }
    }
  }

  const defaultTransitionCount = calculateSetListTransitionCount(items);
  const safeDefaultSeconds = Math.max(0, Math.floor(defaultTransitionSeconds));
  const defaultTransitionDuration = defaultTransitionCount * safeDefaultSeconds;
  const estimatedRuntime = songsDuration + intermissionsDuration + defaultTransitionDuration;

  return {
    defaultTransitionCount,
    defaultTransitionDuration,
    estimatedRuntime,
    intermissionsDuration,
    missingDurationCustomCount,
    songsDuration,
  };
}
