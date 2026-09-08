import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../../firebase';
import { loadPrivateCartulary, type PrivateCartularySnapshot } from '../../../services/cartularies.ts';
import { loadVerticalSchema } from '../../../services/schemaCatalog.ts';
import type { VerticalSchema } from '../../../schema/schemaTypes.ts';
import {
  canEditGenericCartulary,
  canPublishGenericCartulary,
  loadGenericCartularyAssets,
  saveGenericCartularyFields,
  saveGenericCartularyMedia,
  uploadGenericCartularyMedia,
  type GenericMediaMutation,
} from '../../../services/genericCartulary';
import { loadRegistryCollections } from '../../../services/collections';
import type { Asset } from '../../../types';
import type { GenericFieldEdit } from './useGenericSectionEdits.ts';

export type AuthoritativeCartularyStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'denied' | 'signed-out' | 'error';

export interface AuthoritativeCartularyState {
  status: AuthoritativeCartularyStatus;
  snapshot: PrivateCartularySnapshot | null;
  schema: VerticalSchema | null;
  assets: Asset[];
  mediaError: boolean;
  refreshError: boolean;
  canManage: boolean;
  canPublish: boolean;
  collectionName: string;
  /** Relance le chargement complet (après une erreur ou un changement de session). */
  retry: () => void;
  /** Relit l'enveloppe, les sections et les médias sans repasser par l'état de chargement. */
  refresh: () => void;
  reloadAssets: () => void;
  saveFields: (edits: GenericFieldEdit[]) => Promise<void>;
  saveMedia: (mutation: GenericMediaMutation) => Promise<void>;
  uploadMedia: (file: File, progress: (message: string) => void) => Promise<Asset>;
}

const SESSION_CHANGED = 'La session a changé. Rouvrez le Cartulaire avec le compte autorisé pour vérifier le résultat.';

/**
 * Source de vérité unique d'un Cartulaire pour tous les lecteurs : enveloppe et sections
 * `cartularies/{id}`, schéma épinglé par l'enveloppe, médias projetés, droits du compte courant.
 * Les lecteurs ne lisent plus Firestore directement ; ils consomment cet état.
 */
export function useAuthoritativeCartulary(cartularyId: string | null, { enabled = true }: { enabled?: boolean } = {}): AuthoritativeCartularyState {
  const [snapshot, setSnapshot] = useState<PrivateCartularySnapshot | null>(null);
  const [schema, setSchema] = useState<VerticalSchema | null>(null);
  const [status, setStatus] = useState<AuthoritativeCartularyStatus>(enabled ? 'loading' : 'idle');
  const [attempt, setAttempt] = useState(0);
  const [canManage, setCanManage] = useState(false);
  const [canPublish, setCanPublish] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [mediaError, setMediaError] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [collectionName, setCollectionName] = useState('Collection privée');

  useEffect(() => {
    if (!enabled) return undefined;
    let previousUid: string | null | undefined;
    return onAuthStateChanged(auth, (user) => {
      const nextUid = user?.uid || null;
      if (previousUid !== undefined && previousUid !== nextUid) {
        setSnapshot(null); setSchema(null); setCanManage(false); setCanPublish(false); setAssets([]);
        setAttempt((value) => value + 1);
      }
      previousUid = nextUid;
    });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) { setStatus('idle'); return undefined; }
    if (!cartularyId) { setStatus('empty'); return undefined; }
    let active = true;
    setStatus('loading');
    auth.authStateReady().then(async () => {
      if (!auth.currentUser) { if (active) setStatus('signed-out'); return undefined; }
      return loadPrivateCartulary(cartularyId);
    })
      .then(async (loadedSnapshot) => {
        if (loadedSnapshot === undefined) return undefined;
        if (!loadedSnapshot) return null;
        const loadedSchema = await loadVerticalSchema(loadedSnapshot.envelope.schemaId, loadedSnapshot.envelope.schemaVersion);
        return loadedSchema ? { loadedSnapshot, loadedSchema } : null;
      })
      .then((loaded) => {
        if (!active || loaded === undefined) return;
        if (!loaded) { setStatus('empty'); return; }
        setSnapshot(loaded.loadedSnapshot);
        setSchema(loaded.loadedSchema);
        setStatus('ready');
        const envelope = loaded.loadedSnapshot.envelope;
        void canEditGenericCartulary(envelope).then((allowed) => active && setCanManage(allowed)).catch(() => active && setCanManage(false));
        void canPublishGenericCartulary(envelope).then((allowed) => active && setCanPublish(allowed)).catch(() => active && setCanPublish(false));
        void loadGenericCartularyAssets(envelope.id).then((media) => { if (active) { setAssets(media); setMediaError(false); } }).catch(() => active && setMediaError(true));
        void loadRegistryCollections(envelope.registryId).then((collections) => active && setCollectionName(collections.find((entry) => entry.id === envelope.collectionId)?.name || 'Collection privée')).catch(() => {});
      })
      .catch((error: { code?: string }) => {
        if (active) setStatus(error?.code === 'permission-denied' ? 'denied' : 'error');
      });
    return () => { active = false; };
  }, [cartularyId, attempt, enabled]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  const reloadAssets = useCallback(() => {
    if (!snapshot) return;
    const uid = auth.currentUser?.uid;
    void loadGenericCartularyAssets(snapshot.envelope.id)
      .then((media) => { if (uid === auth.currentUser?.uid) { setAssets(media); setMediaError(false); } })
      .catch(() => { if (uid === auth.currentUser?.uid) setMediaError(true); });
  }, [snapshot]);

  const refresh = useCallback(() => {
    if (!snapshot) return;
    const uid = auth.currentUser?.uid;
    void Promise.all([loadPrivateCartulary(snapshot.envelope.id), loadGenericCartularyAssets(snapshot.envelope.id)]).then(([reloaded, media]) => {
      if (uid !== auth.currentUser?.uid) return;
      if (!reloaded) throw new Error('Relecture indisponible');
      setSnapshot(reloaded); setAssets(media); setMediaError(false); setRefreshError(false);
    }).catch(() => { if (uid === auth.currentUser?.uid) setRefreshError(true); });
  }, [snapshot]);

  const saveFields = useCallback(async (edits: GenericFieldEdit[]) => {
    if (!snapshot) throw new Error('Le Cartulaire n’est pas chargé.');
    const uid = auth.currentUser?.uid;
    await saveGenericCartularyFields(snapshot.envelope, edits);
    const reloaded = await loadPrivateCartulary(snapshot.envelope.id);
    if (uid !== auth.currentUser?.uid) throw new Error(SESSION_CHANGED);
    if (!reloaded) throw new Error('La sauvegarde a été traitée, mais la relecture est indisponible. Rechargez le Cartulaire.');
    setSnapshot(reloaded);
  }, [snapshot]);

  const saveMedia = useCallback(async (mutation: GenericMediaMutation) => {
    if (!snapshot) throw new Error('Le Cartulaire n’est pas chargé.');
    const uid = auth.currentUser?.uid;
    await saveGenericCartularyMedia(snapshot.envelope, mutation);
    const [reloaded, media] = await Promise.all([loadPrivateCartulary(snapshot.envelope.id), loadGenericCartularyAssets(snapshot.envelope.id)]);
    if (uid !== auth.currentUser?.uid) throw new Error(SESSION_CHANGED);
    if (!reloaded) throw new Error('Le média a été traité, mais sa relecture est indisponible. Rechargez le Cartulaire avant une nouvelle modification.');
    setSnapshot(reloaded); setAssets(media); setMediaError(false);
  }, [snapshot]);

  const uploadMedia = useCallback(async (file: File, progress: (message: string) => void) => {
    if (!snapshot) throw new Error('Le Cartulaire n’est pas chargé.');
    return uploadGenericCartularyMedia(snapshot.envelope, file, progress);
  }, [snapshot]);

  return { status, snapshot, schema, assets, mediaError, refreshError, canManage, canPublish, collectionName, retry, refresh, reloadAssets, saveFields, saveMedia, uploadMedia };
}
