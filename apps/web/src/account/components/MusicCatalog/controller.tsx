import { MusicCatalogView } from "./view";
import { useMusicCatalogController } from "./hooks";

export function MusicCatalog({ enabled }: { readonly enabled: boolean }) {
  return <MusicCatalogView model={useMusicCatalogController({ enabled })} />;
}
