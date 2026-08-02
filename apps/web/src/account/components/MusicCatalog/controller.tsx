import { MusicCatalogView } from "./view";
import { useMusicCatalogController } from "./hooks";

export function MusicCatalog({
  enabled,
  initialPieceId,
  navigate,
}: {
  readonly enabled: boolean;
  readonly initialPieceId?: string | null | undefined;
  readonly navigate: (href: string) => void;
}) {
  return (
    <MusicCatalogView
      model={useMusicCatalogController({ enabled, initialPieceId })}
      navigate={navigate}
    />
  );
}
