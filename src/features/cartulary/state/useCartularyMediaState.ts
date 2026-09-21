import type { Asset, MediaTag } from '../../../types';
import { usePersistentCartularyState } from './usePersistentCartularyState';
import type { CartulariaLocalVault } from '../../../persistence/localVault';
import type { PreparedImport } from '../media/importMediaFiles';

interface MediaStateOptions {
  loadAssets: () => Asset[];
}

export const useCartularyMediaState = ({ loadAssets }: MediaStateOptions) => {
  const assets = usePersistentCartularyState({
    key: 'cartularia-media-assets-v3',
    protectImports: true,
    load: loadAssets,
    serialize: (items: Asset[]) => items.map((asset) => ({
      ...asset,
      url: asset.binaryId ? '' : asset.url,
      thumbnailUrl: asset.thumbnailUrl?.startsWith('blob:') ? undefined : asset.thumbnailUrl,
      posterUrl: asset.posterUrl?.startsWith('blob:') ? undefined : asset.posterUrl,
    })),
  });

  return {
    mediaAssets: assets.value,
    persistenceError: assets.persistenceError,
    reloadMediaState: assets.reloadIfPresent,
    commands: {
      replaceAssets: assets.replace,
      appendAssets: (items: Asset[]) => assets.replace((current) => [...current, ...items]),
      importAssets: (vault: CartulariaLocalVault, prepared: PreparedImport<Asset>) => assets.commitImport(
        vault, prepared.binaries,
        (current) => [...current, ...prepared.items],
        (committed, current) => {
          const previews = new Map([...current, ...prepared.items].map((asset) => [asset.id, asset]));
          return committed.map((asset) => {
            const preview = previews.get(asset.id);
            return preview && preview.binaryId === asset.binaryId
              ? { ...asset, url: asset.url || preview.url,
                thumbnailUrl: asset.thumbnailUrl ?? (preview.thumbnailUrl?.startsWith('blob:') ? preview.thumbnailUrl : undefined),
                posterUrl: asset.posterUrl ?? (preview.posterUrl?.startsWith('blob:') ? preview.posterUrl : undefined) }
              : asset;
          });
        },
      ),
      updateAsset: (id: string, patch: Partial<Asset>) => assets.replace((current) => current.map((asset) => (
        asset.id === id ? { ...asset, ...patch } : asset
      ))),
      toggleAssetTag: (id: string, tag: MediaTag) => assets.replace((current) => current.map((asset) => (
        asset.id !== id
          ? asset
          : { ...asset, tags: asset.tags.includes(tag) ? asset.tags.filter((item) => item !== tag) : [...asset.tags, tag] }
      ))),
    },
  };
};
