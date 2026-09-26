import { useEffect, useState } from 'react';
import type { Asset } from '../types';
import { usableMediaUrl } from './useMediaSource';
import { createLocalVideoPoster } from '../media/videoPoster.ts';

/** Extract a frame only from an original already held in this browser. Never downloads a private video. */
export function useVideoPoster(asset: Pick<Asset, 'url' | 'posterUrl' | 'thumbnailUrl'>) {
  const supplied = usableMediaUrl(asset.posterUrl) || usableMediaUrl(asset.thumbnailUrl);
  const localUrl = asset.url.startsWith('blob:') ? asset.url : undefined;
  const [generated, setGenerated] = useState<{ source: string; poster: string } | null>(null);

  useEffect(() => {
    if (supplied || !localUrl) return;
    const controller = new AbortController();
    void createLocalVideoPoster(localUrl, controller.signal).then((poster) => {
      if (poster && !controller.signal.aborted) setGenerated({ source: localUrl, poster });
    });
    return () => controller.abort();
  }, [localUrl, supplied]);

  return supplied || (generated?.source === localUrl ? generated?.poster : undefined);
}
