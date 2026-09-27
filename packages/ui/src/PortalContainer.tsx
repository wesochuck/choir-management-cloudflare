import { useCallback, useMemo, useState, type ReactNode, type RefCallback } from "react";

import {
  PortalContainerContext,
  usePortalContainer,
  type PortalContainerContextValue,
} from "./usePortalContainer";

export interface PortalContainerProviderProps {
  readonly children: ReactNode;
  readonly container?: HTMLElement | null;
}

export function PortalContainerProvider({
  children,
  container: explicitContainer,
}: PortalContainerProviderProps) {
  const [internalContainer, setInternalContainer] = useState<HTMLElement | null>(null);

  const setContainer = useCallback<RefCallback<HTMLElement | null>>((node) => {
    setInternalContainer((current) => (current === node ? current : node));
  }, []);

  const value = useMemo<PortalContainerContextValue>(() => {
    const candidate = explicitContainer !== undefined ? explicitContainer : internalContainer;
    const isAttached = Boolean(candidate?.isConnected);
    return {
      container: isAttached ? candidate : null,
      isScoped: true,
      setContainer,
    };
  }, [explicitContainer, internalContainer, setContainer]);

  return (
    <PortalContainerContext.Provider value={value}>{children}</PortalContainerContext.Provider>
  );
}

export function PortalContainerHost({
  className,
  id,
}: {
  readonly className?: string;
  readonly id?: string;
}) {
  const { setContainer } = usePortalContainer();
  return <div className={className} id={id} ref={setContainer} />;
}
