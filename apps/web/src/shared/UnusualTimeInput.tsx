import { isUnusualTime } from "@choir/domain";
import { ConfirmDialog } from "@choir/ui";
import { useEffect, useRef, useState, type ComponentProps } from "react";

type Props = ComponentProps<"input">;

/** Shared advisory confirmation for manually edited Organization-local clock values. */
export function UnusualTimeInput({ onChange, onBlur, onFocus, ...props }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const baseline = useRef(String(props.value ?? ""));
  const accepted = useRef<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const edited = useRef(false);
  const pendingRef = useRef<string | null>(null);
  useEffect(() => {
    const guard = (event: Event) => {
      const element = input.current;
      const target = event.target;
      if (!element || !(target instanceof Element)) return;
      if (target.closest(".dialog--confirmation")) return;
      if (event.type === "click" && !target.closest("button, input[type=submit]")) return;
      if (event.type === "submit" && target !== element.form) return;
      const value = element.value;
      if (
        pendingRef.current !== null ||
        (edited.current &&
          value !== baseline.current &&
          value !== accepted.current &&
          isUnusualTime(value))
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        pendingRef.current = value;
        setPending(value);
      }
    };
    document.addEventListener("click", guard, true);
    document.addEventListener("submit", guard, true);
    return () => {
      document.removeEventListener("click", guard, true);
      document.removeEventListener("submit", guard, true);
    };
  }, []);
  const returnFocus = () => {
    pendingRef.current = null;
    setPending(null);
    input.current?.focus();
  };
  return (
    <>
      <input
        {...props}
        ref={input}
        onFocus={(event) => {
          onFocus?.(event);
        }}
        onChange={(event) => {
          edited.current = true;
          if (accepted.current !== event.currentTarget.value) accepted.current = null;
          onChange?.(event);
        }}
        onBlur={(event) => {
          const value = event.currentTarget.value;
          if (
            edited.current &&
            value !== baseline.current &&
            value !== accepted.current &&
            isUnusualTime(value)
          ) {
            pendingRef.current = value;
            setPending(value);
          }
          onBlur?.(event);
        }}
      />
      <ConfirmDialog
        open={pending !== null}
        title="Check this time"
        description={`You entered ${formatClock(pending)}, outside the usual noon–10 PM range. Keep this time?`}
        confirmLabel="Keep time"
        cancelLabel="Change time"
        onCancel={returnFocus}
        onConfirm={() => {
          accepted.current = input.current?.value === pending ? pending : null;
          pendingRef.current = null;
          setPending(null);
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          input.current?.focus();
        }}
      />
    </>
  );
}

function formatClock(value: string | null): string {
  const clock = value?.split("T").at(-1);
  if (!clock) return "";
  const [hours, minutes] = clock.split(":");
  const hour = Number(hours);
  return `${String(hour % 12 || 12)}:${minutes ?? "00"} ${hour < 12 ? "AM" : "PM"}`;
}
