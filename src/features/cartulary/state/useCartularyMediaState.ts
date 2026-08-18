import type { Asset, MediaTag } from '../../../types';
import { usePersistentCartularyState } from './usePersistentCartularyState';

interface MediaStateOptions {
  loadAssets: () => Asset[];
}

export const useCartularyMediaState = ({ loadAssets }: MediaStateOptions) => {
  const assets = usePersistentCartularyState({
    key: 'cartularia-media-assets-v3',
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
    reloadMediaState: assets.reloadIfPresent,
    commands: {
      replaceAssets: assets.replace,
      appendAssets: (items: Asset[]) => assets.replace((current) => [...current, ...items]),
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
