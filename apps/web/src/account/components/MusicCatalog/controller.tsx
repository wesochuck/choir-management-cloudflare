import { MusicCatalogView } from "./view";
import { useMusicCatalogController } from "./hooks";

export function MusicCatalog({
  enabled,
  initialPieceId,
  navigate,
  returnTo,
  view = "catalog",
}: {
  readonly enabled: boolean;
  readonly initialPieceId?: string | null | undefined;
  readonly navigate: (href: string) => void;
  readonly returnTo?: string | null | undefined;
  readonly view?: "catalog" | "credits";
}) {
  return (
    <MusicCatalogView
      model={useMusicCatalogController({ enabled, initialPieceId })}
      navigate={navigate}
      returnTo={returnTo}
      view={view}
    />
  );
}
