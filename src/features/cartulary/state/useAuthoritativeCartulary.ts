import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../../../firebase';
import { PRIVATE_SESSION_LOCK_EVENT, requestPrivateSessionLock } from '../../../security/privateSessionEvents';
import { loadPrivateCartulary, type PrivateCartularySnapshot } from '../../../services/cartularies.ts';
import { loadVerticalSchema } from '../../../services/schemaCatalog.ts';
import type { VerticalSchema } from '../../../schema/schemaTypes.ts';
import {
  canEditGenericCartulary,
  canPublishGenericCartulary,
  confirmCartularyReview,
  loadGenericCartularyAssets,
  saveGenericCartularyFields,
  saveGenericCartularyMedia,
  uploadGenericCartularyMedia,
  type GenericMediaMutation,
} from '../../../services/genericCartulary';
import type { CartularyReviewLevel } from '../../../../scripts/lib/cartulary-review-policy.mjs';
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
  /** Revue du propriétaire (V5 point 4, lot B) : même motif que `saveFields`, l'enveloppe relue porte le nouvel état. */
  confirmReview: (level: CartularyReviewLevel) => Promise<void>;
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

  // A generation identifies one admission, including A → sign-out → A and unmounts.
  const generation = useRef(0);
  const admission = useRef<{ user: User; generation: number; cartularyId: string } | null>(null);
  const clearPrivateState = useCallback((nextStatus: AuthoritativeCartularyStatus) => {
    admission.current = null;
    setSnapshot(null); setSchema(null); setAssets([]);
    setCanManage(false); setCanPublish(false);
    setMediaError(false); setRefreshError(false); setCollectionName('Collection privée');
    setStatus(nextStatus);
  }, []);
  const permissionDenied = (error: unknown) => /permission-denied|unauthorized/.test(String((error as { code?: string })?.code || ''));

  useEffect(() => {
    let active = true;
    if (!enabled || !cartularyId) {
      generation.current += 1;
      clearPrivateState(enabled ? 'empty' : 'idle');
      return () => { active = false; generation.current += 1; admission.current = null; };
    }
    clearPrivateState('loading');
    let locked = false;
    const lock = () => { locked = true; generation.current += 1; clearPrivateState('signed-out'); };
    window.addEventListener(PRIVATE_SESSION_LOCK_EVENT, lock);
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (locked) return;
      const epoch = ++generation.current;
      clearPrivateState(user ? 'loading' : 'signed-out');
      if (!user) return;
      const current = () => active && generation.current === epoch && auth.currentUser === user;
      const fail = (error: unknown) => {
        if (!current()) return;
        if (permissionDenied(error)) { generation.current += 1; requestPrivateSessionLock(); }
        clearPrivateState(permissionDenied(error) ? 'denied' : 'error');
      };
      void (async () => {
        const loaded = await loadPrivateCartulary(cartularyId);
        if (!current()) return;
        if (!loaded) { clearPrivateState('empty'); return; }
        const loadedSchema = await loadVerticalSchema(loaded.envelope.schemaId, loaded.envelope.schemaVersion);
        if (!current()) return;
        if (!loadedSchema) { clearPrivateState('empty'); return; }
        admission.current = { user, generation: epoch, cartularyId };
        setSnapshot(loaded); setSchema(loadedSchema); setStatus('ready');
        const envelope = loaded.envelope;
        const rightsFailure = (error: unknown, reset: () => void) => {
          if (!current()) return;
          if (permissionDenied(error)) fail(error);
          else reset();
        };
        void canEditGenericCartulary(envelope).then((allowed) => { if (current()) setCanManage(allowed); }).catch((error) => rightsFailure(error, () => setCanManage(false)));
        void canPublishGenericCartulary(envelope).then((allowed) => { if (current()) setCanPublish(allowed); }).catch((error) => rightsFailure(error, () => setCanPublish(false)));
        void loadGenericCartularyAssets(envelope.id).then((media) => { if (current()) { setAssets(media); setMediaError(false); } }).catch((error) => rightsFailure(error, () => setMediaError(true)));
        void loadRegistryCollections(envelope.registryId).then((collections) => { if (current()) setCollectionName(collections.find((entry) => entry.id === envelope.collectionId)?.name || 'Collection privée'); }).catch(() => { /* A dossier-scoped guest may not list the surrounding Registry's Collections. */ });
      })().catch(fail);
    }, (error) => {
      if (!active) return;
      generation.current += 1;
      if (permissionDenied(error)) requestPrivateSessionLock();
      clearPrivateState(permissionDenied(error) ? 'denied' : 'error');
    });
    return () => {
      active = false;
      generation.current += 1;
      admission.current = null;
      unsubscribe();
      window.removeEventListener(PRIVATE_SESSION_LOCK_EVENT, lock);
    };
  }, [cartularyId, attempt, enabled, clearPrivateState]);

  const captureAdmission = useCallback(() => {
    const captured = admission.current;
    const current = () => Boolean(captured && admission.current === captured
      && generation.current === captured.generation && auth.currentUser === captured.user);
    const assertCurrent = () => { if (!current()) throw new Error(SESSION_CHANGED); };
    assertCurrent();
    return { current, assertCurrent };
  }, []);
  const handleOperationError = useCallback((error: unknown, current: () => boolean) => {
    if (current() && permissionDenied(error)) {
      generation.current += 1;
      requestPrivateSessionLock();
      clearPrivateState('denied');
    }
  }, [clearPrivateState]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  const reloadAssets = useCallback(() => {
    if (!snapshot || !admission.current) return;
    const session = captureAdmission();
    void loadGenericCartularyAssets(snapshot.envelope.id)
      .then((media) => { if (session.current()) { setAssets(media); setMediaError(false); } })
      .catch((error) => {
        handleOperationError(error, session.current);
        if (session.current()) setMediaError(true);
      });
  }, [snapshot, captureAdmission, handleOperationError]);

  const refresh = useCallback(() => {
    if (!snapshot || !admission.current) return;
    const session = captureAdmission();
    void Promise.all([loadPrivateCartulary(snapshot.envelope.id), loadGenericCartularyAssets(snapshot.envelope.id)]).then(([reloaded, media]) => {
      if (!session.current()) return;
      if (!reloaded) { generation.current += 1; clearPrivateState('empty'); return; }
      setSnapshot(reloaded); setAssets(media); setMediaError(false); setRefreshError(false);
    }).catch((error) => {
      handleOperationError(error, session.current);
      if (session.current()) setRefreshError(true);
    });
  }, [snapshot, captureAdmission, clearPrivateState, handleOperationError]);

  const saveFields = useCallback(async (edits: GenericFieldEdit[]) => {
    if (!snapshot) throw new Error('Le Cartulaire n’est pas chargé.');
    const session = captureAdmission();
    try {
      await saveGenericCartularyFields(snapshot.envelope, edits);
      session.assertCurrent();
      const reloaded = await loadPrivateCartulary(snapshot.envelope.id);
      session.assertCurrent();
      if (!reloaded) { generation.current += 1; clearPrivateState('empty'); throw new Error('La sauvegarde a été traitée, mais la relecture est indisponible. Rechargez le Cartulaire.'); }
      setSnapshot(reloaded);
    } catch (error) { handleOperationError(error, session.current); throw error; }
  }, [snapshot, captureAdmission, clearPrivateState, handleOperationError]);

  const confirmReview = useCallback(async (level: CartularyReviewLevel) => {
    if (!snapshot) throw new Error('Le Cartulaire n’est pas chargé.');
    const session = captureAdmission();
    try {
      await confirmCartularyReview(snapshot.envelope, { level });
      session.assertCurrent();
      const reloaded = await loadPrivateCartulary(snapshot.envelope.id);
      session.assertCurrent();
      if (!reloaded) { generation.current += 1; clearPrivateState('empty'); throw new Error('La revue a été traitée, mais la relecture est indisponible. Rechargez le Cartulaire.'); }
      setSnapshot(reloaded);
    } catch (error) { handleOperationError(error, session.current); throw error; }
  }, [snapshot, captureAdmission, clearPrivateState, handleOperationError]);

  const saveMedia = useCallback(async (mutation: GenericMediaMutation) => {
    if (!snapshot) throw new Error('Le Cartulaire n’est pas chargé.');
    const session = captureAdmission();
    try {
      await saveGenericCartularyMedia(snapshot.envelope, mutation);
      session.assertCurrent();
      const [reloaded, media] = await Promise.all([loadPrivateCartulary(snapshot.envelope.id), loadGenericCartularyAssets(snapshot.envelope.id)]);
      session.assertCurrent();
      if (!reloaded) { generation.current += 1; clearPrivateState('empty'); throw new Error('Le média a été traité, mais sa relecture est indisponible. Rechargez le Cartulaire avant une nouvelle modification.'); }
      setSnapshot(reloaded); setAssets(media); setMediaError(false);
    } catch (error) { handleOperationError(error, session.current); throw error; }
  }, [snapshot, captureAdmission, clearPrivateState, handleOperationError]);

  const uploadMedia = useCallback(async (file: File, progress: (message: string) => void) => {
    if (!snapshot) throw new Error('Le Cartulaire n’est pas chargé.');
    const session = captureAdmission();
    try {
      const media = await uploadGenericCartularyMedia(snapshot.envelope, file, (message) => { if (session.current()) progress(message); });
      session.assertCurrent();
      return media;
    } catch (error) { handleOperationError(error, session.current); throw error; }
  }, [snapshot, captureAdmission, handleOperationError]);

  return { status, snapshot, schema, assets, mediaError, refreshError, canManage, canPublish, collectionName, retry, refresh, reloadAssets, saveFields, confirmReview, saveMedia, uploadMedia };
}
