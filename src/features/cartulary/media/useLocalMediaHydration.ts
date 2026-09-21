import { useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { CartulariaLocalVault, LocalBinaryRecord } from '../../../persistence/localVault';
import { PRIVATE_SESSION_LOCK_EVENT } from '../../../security/privateSessionEvents';
import type { Asset } from '../../../types';
import { formatFileSize } from '../../../utils/formatting';
import type { ConditionAttachment, ConditionEntry } from '../state/cartularyStateTypes';

interface LocalMediaHydrationOptions {
  vault: CartulariaLocalVault | null;
  mediaAssets: Asset[];
  conditionEntries: ConditionEntry[];
  setMediaAssets: Dispatch<SetStateAction<Asset[]>>;
  setConditionEntries: Dispatch<SetStateAction<ConditionEntry[]>>;
  refreshVersion: number;
  placeholderUrl: string;
  /** Keep locally owned previews alive while an undoable deletion can restore their references. */
  preserveUnreferenced?: boolean;
}

type OwnedUrls = Map<string, 'pending' | 'adopted'>;
type HydratedOriginal = { record: LocalBinaryRecord; url: string } | undefined;
type HydratedReference = { id: string; binaryId: string; original: HydratedOriginal } & (
  { section: 'media' } | { section: 'condition'; entryId: string }
);

const attachmentIdentity = (attachment: ConditionAttachment) => attachment.id ?? attachment.binaryId ?? '';
const referencedUrls = (assets: Asset[], entries: ConditionEntry[]) => new Set([
  ...assets.flatMap((asset) => [asset.url, asset.thumbnailUrl, asset.posterUrl]),
  ...entries.flatMap((entry) => entry.attachments.map((attachment) => attachment.url)),
]);
const releaseUrls = (owned: OwnedUrls, urls: Iterable<string>) => {
  for (const url of urls) {
    if (!owned.delete(url)) continue;
    URL.revokeObjectURL(url);
  }
};

/** Hydrates local originals without owning imported or remote preview URLs. */
export const useLocalMediaHydration = (options: LocalMediaHydrationOptions): void => {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const ownedRef = useRef<OwnedUrls>(new Map());
  const scopeActiveRef = useRef(false);
  const { vault, refreshVersion, mediaAssets, conditionEntries, preserveUnreferenced = false } = options;

  // A refresh is not a session change: still-rendered previews survive it.
  useEffect(() => {
    const owned = ownedRef.current;
    scopeActiveRef.current = Boolean(vault?.isAccessible);
    const close = () => {
      scopeActiveRef.current = false;
      releaseUrls(owned, [...owned.keys()]);
    };
    window.addEventListener(PRIVATE_SESSION_LOCK_EVENT, close);
    return () => {
      window.removeEventListener(PRIVATE_SESSION_LOCK_EVENT, close);
      close();
    };
  }, [vault]);

  useEffect(() => {
    if (preserveUnreferenced) return;
    const owned = ownedRef.current;
    const used = referencedUrls(mediaAssets, conditionEntries);
    releaseUrls(owned, [...owned].filter(([url, status]) => status === 'adopted' && !used.has(url)).map(([url]) => url));
  }, [mediaAssets, conditionEntries, preserveUnreferenced]);

  useEffect(() => {
    if (!vault || !scopeActiveRef.current) return;
    const snapshot = optionsRef.current;
    const owned = ownedRef.current;
    const allocated = new Set<string>();
    let active = true;
    const isActive = () => active && scopeActiveRef.current && optionsRef.current.vault === vault && vault.isAccessible;
    const releasePending = () => releaseUrls(owned, [...allocated].filter((url) => owned.get(url) === 'pending'));
    const hydrate = async (binaryId: string): Promise<HydratedOriginal> => {
      const record = await vault.getBinary(binaryId);
      if (!isActive() || !record?.blob || record.deleted) return undefined;
      const url = URL.createObjectURL(record.blob);
      owned.set(url, 'pending');
      allocated.add(url);
      return { record, url };
    };
    const tasks: Array<Promise<HydratedReference>> = [];
    for (const asset of snapshot.mediaAssets) {
      if (!asset.binaryId || (asset.url && asset.url !== snapshot.placeholderUrl)) continue;
      const binaryId = asset.binaryId;
      tasks.push(hydrate(binaryId).then((original) => ({ section: 'media', id: asset.id, binaryId, original })));
    }
    for (const entry of snapshot.conditionEntries) {
      for (const attachment of entry.attachments) {
        if (!attachment.binaryId || attachment.url) continue;
        const binaryId = attachment.binaryId;
        tasks.push(hydrate(binaryId).then((original) => ({ section: 'condition', entryId: entry.id,
          id: attachmentIdentity(attachment), binaryId, original })));
      }
    }
    const adopt = (results: HydratedReference[], used: Set<string | undefined>) => {
      for (const result of results) {
        const url = result.original?.url;
        if (!url || !owned.has(url)) continue;
        if (used.has(url)) owned.set(url, 'adopted');
        else releaseUrls(owned, [url]);
      }
    };
    void Promise.allSettled(tasks).then((settled) => {
      // A rejection must not abandon a sibling which allocates its URL later.
      if (!isActive() || settled.some((result) => result.status === 'rejected')) {
        releasePending();
        return;
      }
      const results = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
      const media = results.filter((result) => result.section === 'media');
      const conditions = results.filter((result) => result.section === 'condition');
      if (media.length > 0) snapshot.setMediaAssets((current) => {
        if (!isActive()) { releasePending(); return current; }
        const byId = new Map(media.map((result) => [result.id, result]));
        const merged = current.map((asset) => {
          const candidate = byId.get(asset.id);
          if (!candidate || candidate.binaryId !== asset.binaryId || (asset.url && asset.url !== snapshot.placeholderUrl)) return asset;
          const original = candidate.original;
          if (original && !owned.has(original.url)) return asset;
          return { ...asset, url: original?.url ?? '', hash: asset.hash || original?.record.sha256 || '',
            mimeType: asset.mimeType || original?.record.mimeType,
            fileSize: asset.fileSize || (original ? formatFileSize(original.record.size) : undefined),
            localAvailability: original ? 'available' as const : 'missing' as const };
        });
        adopt(media, referencedUrls(merged, []));
        return merged;
      });
      if (conditions.length > 0) snapshot.setConditionEntries((current) => {
        if (!isActive()) { releasePending(); return current; }
        const merged = current.map((entry) => ({ ...entry, attachments: entry.attachments.map((attachment) => {
          const candidate = conditions.find((item) => item.entryId === entry.id && item.id === attachmentIdentity(attachment)
            && item.binaryId === attachment.binaryId);
          const url = candidate?.original?.url;
          return !attachment.url && url && owned.has(url) ? { ...attachment, url } : attachment;
        }) }));
        adopt(conditions, referencedUrls([], merged));
        return merged;
      });
    });
    return () => {
      active = false;
      releasePending();
    };
    // Preview adoption and ordinary edits must not restart a round of reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault, refreshVersion]);
};
