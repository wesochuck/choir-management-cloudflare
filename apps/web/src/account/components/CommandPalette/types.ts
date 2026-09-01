import type { SearchCategory } from "@choir/contracts";

export interface CommandPaletteAction {
  readonly actionId?: string | undefined;
  readonly badge?: string | undefined;
  readonly category: SearchCategory;
  readonly href?: string | undefined;
  readonly icon?: string | undefined;
  readonly id: string;
  readonly onSelect?: (() => void) | undefined;
  readonly ownerOnly?: boolean | undefined;
  readonly requiredModule?: string | undefined;
  readonly subtitle?: string | undefined;
  readonly title: string;
}

export interface RecentItem {
  readonly actionId?: string | undefined;
  readonly badge?: string | undefined;
  readonly category: SearchCategory;
  readonly href?: string | undefined;
  readonly id: string;
  readonly subtitle?: string | undefined;
  readonly timestamp: number;
  readonly title: string;
}

export type PrefixKeyword =
  "action" | "actions" | "event" | "events" | "music" | "poll" | "polls" | "roster" | "settings";

export interface CommandPaletteProps {
  readonly isOwner: boolean;
  readonly modules: readonly string[];
  readonly onClose: () => void;
  readonly onNavigate: (path: string) => void;
  readonly onToggleTheme: () => void;
  readonly open: boolean;
}
