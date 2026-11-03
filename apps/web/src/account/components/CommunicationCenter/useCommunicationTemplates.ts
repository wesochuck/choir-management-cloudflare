import type { CommunicationChannel, CommunicationTemplate } from "@choir/contracts";
import { useCallback, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  deleteOrganizationCommunicationTemplate,
  saveOrganizationCommunicationTemplate,
} from "../../../auth/api";
import { failureMessage } from "./utils";

export function useCommunicationTemplates({
  channel,
  confirm,
  contentMarkdown,
  setBusy,
  setError,
  setSuccessNotice,
  subject,
}: {
  readonly channel: CommunicationChannel;
  readonly confirm: (options: {
    readonly confirmLabel: string;
    readonly description: string;
    readonly destructive?: boolean;
    readonly title: string;
  }) => Promise<boolean>;
  readonly contentMarkdown: string;
  readonly setBusy: Dispatch<SetStateAction<boolean>>;
  readonly setError: Dispatch<SetStateAction<string | null>>;
  readonly setSuccessNotice: Dispatch<SetStateAction<string | null>>;
  readonly subject: string;
}) {
  const [templates, setTemplates] = useState<readonly CommunicationTemplate[]>([]);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [saveTemplateTitle, setSaveTemplateTitle] = useState("");

  const saveTemplateAction = useCallback(
    async (title: string) => {
      setSaveTemplateTitle(title);
      setBusy(true);
      setError(null);
      try {
        const saved = await saveOrganizationCommunicationTemplate({
          channel,
          contentMarkdown,
          subject,
          title,
        });
        setTemplates((current) => [saved, ...current.filter((t) => t.id !== saved.id)]);
        setSaveTemplateOpen(false);
        setSuccessNotice(`Template "${title}" saved.`);
      } catch (err: unknown) {
        setError(failureMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [channel, contentMarkdown, setBusy, setError, setSuccessNotice, subject],
  );

  const deleteTemplateAction = useCallback(
    async (templateId: string) => {
      const ok = await confirm({
        confirmLabel: "Delete template",
        description: "Delete this communication template permanently?",
        destructive: true,
        title: "Delete template",
      });
      if (!ok) return;
      setBusy(true);
      setError(null);
      try {
        await deleteOrganizationCommunicationTemplate(templateId);
        setTemplates((current) => current.filter((t) => t.id !== templateId));
        setSuccessNotice("Template deleted.");
      } catch (err: unknown) {
        setError(failureMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [confirm, setBusy, setError, setSuccessNotice],
  );

  return {
    deleteTemplateAction,
    saveTemplateAction,
    saveTemplateOpen,
    saveTemplateTitle,
    setSaveTemplateOpen,
    setTemplates,
    templates,
  };
}
