import { createContext, useContext, type RefCallback } from "react";

export interface PortalContainerContextValue {
  readonly container: HTMLElement | null;
  readonly isScoped: boolean;
  readonly setContainer: RefCallback<HTMLElement | null>;
}

export const PortalContainerContext = createContext<PortalContainerContextValue | null>(null);

export function usePortalContainer(): PortalContainerContextValue {
  const context = useContext(PortalContainerContext);
  if (!context) {
    return {
      container: null,
      isScoped: false,
      setContainer: () => undefined,
    };
  }
  const isAttached = Boolean(context.container?.isConnected);
  return {
    container: isAttached ? context.container : null,
    isScoped: true,
    setContainer: context.setContainer,
  };
}
