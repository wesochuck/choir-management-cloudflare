import { MusicCatalogView } from "./view";
import { useMusicCatalogController } from "./hooks";

export function MusicCatalog({
  enabled,
  navigate,
}: {
  readonly enabled: boolean;
  readonly navigate: (href: string) => void;
}) {
  return <MusicCatalogView model={useMusicCatalogController({ enabled })} navigate={navigate} />;
}
