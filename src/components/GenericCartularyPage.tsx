import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { loadPrivateCartulary, type PrivateCartularySnapshot } from '../services/cartularies.ts';
import { loadVerticalSchema } from '../services/schemaCatalog.ts';
import type { VerticalSchema } from '../schema/schemaTypes.ts';
import { isRegistryReturnPath } from '../features/registry/registryCatalog.ts';
import { GenericCartularyView } from './GenericCartularyView';
import { auth } from '../firebase';
import { canEditGenericCartulary, canPublishGenericCartulary, loadGenericCartularyAssets, saveGenericCartularyFields, saveGenericCartularyMedia, uploadGenericCartularyMedia } from '../services/genericCartulary';
import { loadRegistryCollections } from '../services/collections';
import { loadScopedRegistryItems } from '../services/projections';
import { observeRegistryFollowUpsFromItems } from '../services/followUp';
import type { Asset } from '../types';
import type { RegistryItemProjection } from '../domain/projections';
import type { RegistryFollowUpItem } from '../domain/followUp';

export const GenericCartularyPage = () => {
  const parameters = new URLSearchParams(window.location.search);
  const cartularyId = parameters.get('cartularyId');
  const returnToParameter = parameters.get('returnTo');
  const returnTo = isRegistryReturnPath(returnToParameter) ? returnToParameter : '/registry';
  const [snapshot, setSnapshot] = useState<PrivateCartularySnapshot | null>(null);
  const [schema, setSchema] = useState<VerticalSchema | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'denied' | 'signed-out' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [canManage, setCanManage] = useState(false);
  const [canPublish, setCanPublish] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [mediaError, setMediaError] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [registryItem, setRegistryItem] = useState<RegistryItemProjection | null>(null);
  const [todos, setTodos] = useState<RegistryFollowUpItem[]>([]);
  const [followUpAttempt, setFollowUpAttempt] = useState(0);
  const [followUpState, setFollowUpState] = useState<'loading' | 'ready' | 'error' | 'missing'>('loading');
  const [collectionName, setCollectionName] = useState('Collection privée');
  useEffect(() => {
    let previousUid: string | null | undefined;
    return onAuthStateChanged(auth, (user) => {
      const nextUid = user?.uid || null;
      if (previousUid !== undefined && previousUid !== nextUid) {
        setSnapshot(null); setSchema(null); setCanManage(false); setCanPublish(false); setAssets([]); setRegistryItem(null); setTodos([]);
        setAttempt((value) => value + 1);
      }
      previousUid = nextUid;
    });
  }, []);

  useEffect(() => {
    if (!cartularyId) {
      setStatus('empty');
      return;
    }
    let active = true;
    setStatus('loading');
    auth.authStateReady().then(async () => {
      if (!auth.currentUser) { if (active) setStatus('signed-out'); return undefined; }
      return loadPrivateCartulary(cartularyId);
    })
      .then(async (loadedSnapshot) => {
        if (loadedSnapshot === undefined) return undefined;
        if (!loadedSnapshot) return null;
        const loadedSchema = await loadVerticalSchema(
          loadedSnapshot.envelope.schemaId,
          loadedSnapshot.envelope.schemaVersion,
        );
        return loadedSchema ? { loadedSnapshot, loadedSchema } : null;
      })
      .then((loaded) => {
        if (!active) return;
        if (loaded === undefined) return;
        if (!loaded) {
          setStatus('empty');
          return;
        }
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
    return () => {
      active = false;
    };
  }, [cartularyId, attempt]);
  useEffect(() => {
    if (!snapshot) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    setFollowUpState('loading');
    const envelope = snapshot.envelope;
    void loadScopedRegistryItems(envelope.registryId, { registry: false, collectionIds: [], cartularyIds: [envelope.id] }).then((items) => {
      if (!active) return;
      const item = items.find((entry) => entry.cartularyId === envelope.id);
      if (!item) { setFollowUpState('missing'); return; }
      setRegistryItem(item);
      unsubscribe = observeRegistryFollowUpsFromItems([item], (loaded) => {
        if (active) { setTodos(loaded); setFollowUpState('ready'); }
      }, () => { if (active) setFollowUpState('error'); });
    }).catch(() => { if (active) setFollowUpState('error'); });
    return () => { active = false; unsubscribe?.(); };
  }, [snapshot, followUpAttempt]);

  if (status === 'ready' && snapshot && schema) {
    const refreshAfterPublication = () => {
      const uid = auth.currentUser?.uid;
      void Promise.all([loadPrivateCartulary(snapshot.envelope.id), loadGenericCartularyAssets(snapshot.envelope.id)]).then(([reloaded, media]) => {
        if (uid !== auth.currentUser?.uid) return;
        if (!reloaded) throw new Error('Relecture indisponible');
        setSnapshot(reloaded); setAssets(media); setMediaError(false); setRefreshError(false);
      }).catch(() => { if (uid === auth.currentUser?.uid) setRefreshError(true); });
    };
    return <>{refreshError && <div role="alert"><p>La publication a été traitée mais les données du Cartulaire n’ont pas pu être actualisées. Réessayez avant de poursuivre les modifications.</p><button type="button" onClick={refreshAfterPublication}>Actualiser le Cartulaire</button></div>}<GenericCartularyView snapshot={snapshot} schema={schema} returnHref={returnTo} collectionName={collectionName} assets={assets} mediaError={mediaError} registryItem={registryItem} todos={todos} followUpState={followUpState} onRetryFollowUp={() => setFollowUpAttempt((value) => value + 1)} canManage={canManage && !refreshError} canPublish={canPublish} onPublicationChanged={refreshAfterPublication}
      onUploadMedia={(file, progress) => uploadGenericCartularyMedia(snapshot.envelope, file, progress)}
      onRetryMedia={() => { const uid = auth.currentUser?.uid; void loadGenericCartularyAssets(snapshot.envelope.id).then((media) => { if (uid === auth.currentUser?.uid) { setAssets(media); setMediaError(false); } }).catch(() => { if (uid === auth.currentUser?.uid) setMediaError(true); }); }}
      onSaveMedia={async (mutation) => {
        const uid = auth.currentUser?.uid;
        await saveGenericCartularyMedia(snapshot.envelope, mutation);
        const [reloaded, media] = await Promise.all([loadPrivateCartulary(snapshot.envelope.id), loadGenericCartularyAssets(snapshot.envelope.id)]);
        if (uid !== auth.currentUser?.uid) throw new Error('La session a changé. Rouvrez le Cartulaire avec le compte autorisé pour vérifier le résultat.');
        if (!reloaded) throw new Error('Le média a été traité, mais sa relecture est indisponible. Rechargez le Cartulaire avant une nouvelle modification.');
        setSnapshot(reloaded); setAssets(media); setMediaError(false);
      }} onSave={async (edits) => {
      const uid = auth.currentUser?.uid;
      await saveGenericCartularyFields(snapshot.envelope, edits);
      const reloaded = await loadPrivateCartulary(snapshot.envelope.id);
      if (uid !== auth.currentUser?.uid) throw new Error('La session a changé. Rouvrez le Cartulaire avec le compte autorisé pour vérifier le résultat.');
      if (!reloaded) throw new Error('La sauvegarde a été traitée, mais la relecture est indisponible. Rechargez le Cartulaire.');
      setSnapshot(reloaded);
    }} /></>;
  }

  return (
    <main className="generic-cartulary-state">
      <h1>{status === 'loading' ? 'Chargement du Cartulaire' : status === 'denied' ? 'Accès refusé' : status === 'error' ? 'Cartulaire momentanément indisponible' : status === 'signed-out' ? 'Connexion requise' : 'Cartulaire introuvable'}</h1>
      <p>{status === 'denied'
        ? 'La session ne possède pas la portée nécessaire.'
        : status === 'error' ? 'La lecture n’a pas abouti. Vérifiez votre connexion puis réessayez.' : 'Utilisez une session authentifiée et un identifiant de Cartulaire autorisé.'}</p>
      {status === 'error' && <button type="button" onClick={() => setAttempt((value) => value + 1)}>Réessayer</button>}
      {status === 'signed-out' && <a href={`/account/sign-in?returnTo=${encodeURIComponent(window.location.pathname + window.location.search + window.location.hash)}`}>Se connecter pour ouvrir ce Cartulaire</a>}
      <a href={returnTo}>Retour au Registre</a>
    </main>
  );
};
