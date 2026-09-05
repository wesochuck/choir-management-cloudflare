import {
  createContext,
  useContext,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";

interface TabsContextValue {
  readonly baseId: string;
  readonly onValueChange: (value: string) => void;
  readonly orientation: "horizontal" | "vertical";
  readonly value: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

export interface TabsProps<T extends string = string> {
  readonly children: ReactNode;
  readonly className?: string;
  readonly onValueChange: (value: T) => void;
  readonly orientation?: "horizontal" | "vertical";
  readonly value: T;
}

function isTabValue<T extends string>(value: string, target?: T): value is T {
  return typeof value === "string" && typeof target === "string";
}

export function Tabs<T extends string = string>({
  children,
  className,
  onValueChange,
  orientation = "horizontal",
  value,
}: TabsProps<T>) {
  const baseId = useId();
  return (
    <TabsContext.Provider
      value={{
        baseId,
        onValueChange: (next: string) => {
          if (isTabValue(next, value)) {
            onValueChange(next);
          }
        },
        orientation,
        value,
      }}
    >
      <div className={className} data-orientation={orientation}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export interface TabsListProps {
  readonly "aria-label"?: string;
  readonly "aria-labelledby"?: string;
  readonly as?: "div" | "nav";
  readonly children: ReactNode;
  readonly className?: string;
}

export function TabsList({
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  as: Component = "div",
  children,
  className,
}: TabsListProps) {
  const context = useContext(TabsContext);
  const listRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!listRef.current) return;
    const tabs = Array.from(
      listRef.current.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'),
    );
    if (tabs.length === 0) return;

    const currentIndex = tabs.findIndex((tab) => tab === document.activeElement);
    if (currentIndex === -1) return;

    let targetIndex: number | null = null;
    const isHorizontal = context?.orientation !== "vertical";
    const nextKey = isHorizontal ? "ArrowRight" : "ArrowDown";
    const prevKey = isHorizontal ? "ArrowLeft" : "ArrowUp";

    if (event.key === nextKey) {
      targetIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === prevKey) {
      targetIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      targetIndex = 0;
    } else if (event.key === "End") {
      targetIndex = tabs.length - 1;
    }

    if (targetIndex !== null) {
      event.preventDefault();
      const targetTab = tabs[targetIndex];
      if (targetTab) {
        targetTab.focus();
        targetTab.click();
      }
    }
  };

  return (
    <Component
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-orientation={context?.orientation}
      className={className}
      onKeyDown={handleKeyDown}
      ref={listRef}
      role="tablist"
    >
      {children}
    </Component>
  );
}

export interface TabsTriggerProps {
  readonly "aria-controls"?: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly value: string;
}

export function TabsTrigger({
  "aria-controls": customControls,
  children,
  className,
  disabled,
  id: customId,
  value,
}: TabsTriggerProps) {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error("TabsTrigger must be used within a Tabs component");
  }

  const isSelected = context.value === value;
  const tabId = customId ?? `${context.baseId}-tab-${value}`;
  const panelId = customControls ?? `${context.baseId}-panel-${value}`;

  const classNames =
    [className, isSelected ? "is-active" : ""].filter(Boolean).join(" ") || undefined;

  return (
    <button
      aria-controls={panelId}
      aria-selected={isSelected}
      className={classNames}
      data-state={isSelected ? "active" : "inactive"}
      disabled={disabled}
      id={tabId}
      onClick={() => {
        if (!disabled) {
          context.onValueChange(value);
        }
      }}
      role="tab"
      tabIndex={isSelected ? 0 : -1}
      type="button"
    >
      {children}
    </button>
  );
}

export interface TabsContentProps {
  readonly "aria-labelledby"?: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly forceMount?: boolean;
  readonly id?: string;
  readonly tabIndex?: number;
  readonly value: string;
}

export function TabsContent({
  "aria-labelledby": customLabelledBy,
  children,
  className,
  forceMount = false,
  id: customId,
  tabIndex = 0,
  value,
}: TabsContentProps) {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error("TabsContent must be used within a Tabs component");
  }

  const isSelected = context.value === value;
  if (!isSelected && !forceMount) {
    return null;
  }

  const tabId = customLabelledBy ?? `${context.baseId}-tab-${value}`;
  const panelId = customId ?? `${context.baseId}-panel-${value}`;

  return (
    <div
      aria-labelledby={tabId}
      className={className}
      data-state={isSelected ? "active" : "inactive"}
      hidden={!isSelected}
      id={panelId}
      role="tabpanel"
      tabIndex={tabIndex}
    >
      {children}
    </div>
  );
}
