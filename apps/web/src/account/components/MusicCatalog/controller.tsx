import { MusicCatalogView } from "./view";
import { useMusicCatalogController } from "./hooks";
import type { MusicCreditFilter } from "./utils";

export function MusicCatalog({
  creditFilter,
  enabled,
  initialPieceId,
  navigate,
  onClearCreditFilter,
  returnTo,
  view = "catalog",
}: {
  readonly creditFilter?: MusicCreditFilter | null | undefined;
  readonly enabled: boolean;
  readonly initialPieceId?: string | null | undefined;
  readonly navigate: (href: string) => void;
  readonly onClearCreditFilter?: (() => void) | undefined;
  readonly returnTo?: string | null | undefined;
  readonly view?: "catalog" | "credits";
}) {
  return (
    <MusicCatalogView
      model={useMusicCatalogController({
        creditFilter,
        enabled,
        initialPieceId,
        navigate,
        onClearCreditFilter,
      })}
      navigate={navigate}
      returnTo={returnTo}
      view={view}
    />
  );
}
