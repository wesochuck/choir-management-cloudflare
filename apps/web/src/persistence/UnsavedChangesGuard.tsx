import { useCallback } from "react";
import { useOptionalSaveCoordinator, requestGlobalLeave } from "./SaveCoordinator";
import type { LeaveOptions } from "./types";

export function useNavigationGuard() {
  const coordinator = useOptionalSaveCoordinator();

  const guard = useCallback(
    async (options: LeaveOptions): Promise<boolean> => {
      if (coordinator) {
        return coordinator.requestLeave(options);
      }
      return requestGlobalLeave(options);
    },
    [coordinator],
  );

  return { guard };
}
