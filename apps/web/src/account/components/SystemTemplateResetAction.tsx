import type { CommunicationTemplate } from "@choir/contracts";
import { useConfirmation } from "@choir/ui";
import { useState } from "react";
import { resetOrganizationCommunicationTemplateToSystemDefault } from "../../api";

export function SystemTemplateResetAction({
  disabled = false,
  onReset,
  template,
}: {
  readonly disabled?: boolean;
  readonly onReset: (template: CommunicationTemplate) => void;
  readonly template: CommunicationTemplate;
}) {
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmationDialog } = useConfirmation();

  if (!template.isSystem) return null;

  async function handleReset() {
    const confirmed = await confirm({
      confirmLabel: "Reset to system default",
      description:
        "This will replace this Organization's customized subject and message with the current system default. This cannot be undone automatically.",
      destructive: true,
      title: "Reset template to system default?",
    });
    if (!confirmed) return;

    setResetting(true);
    setError(null);
    try {
      const updated = await resetOrganizationCommunicationTemplateToSystemDefault(template.id);
      onReset(updated);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "The template could not be reset.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="system-template-reset-action">
      <button
        aria-busy={resetting}
        className="button button--danger button--sm"
        disabled={disabled || resetting}
        onClick={() => void handleReset()}
        type="button"
      >
        {resetting ? "Resetting…" : "Reset to system default"}
      </button>
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {confirmationDialog}
    </div>
  );
}
