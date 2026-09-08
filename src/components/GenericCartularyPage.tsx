import { useEffect, useState } from 'react';
import { isRegistryReturnPath } from '../features/registry/registryCatalog.ts';
import { GenericCartularyView } from './GenericCartularyView';
import { useAuthoritativeCartulary } from '../features/cartulary/state/useAuthoritativeCartulary.ts';
import { loadScopedRegistryItems } from '../services/projections';
import { observeRegistryFollowUpsFromItems } from '../services/followUp';
import type { RegistryItemProjection } from '../domain/projections';
import type { RegistryFollowUpItem } from '../domain/followUp';

export const GenericCartularyPage = () => {
  const parameters = new URLSearchParams(window.location.search);
  const cartularyId = parameters.get('cartularyId');
  const returnToParameter = parameters.get('returnTo');
  const returnTo = isRegistryReturnPath(returnToParameter) ? returnToParameter : '/registry';
  const cartulary = useAuthoritativeCartulary(cartularyId);
  const { status, snapshot, schema } = cartulary;
  const [registryItem, setRegistryItem] = useState<RegistryItemProjection | null>(null);
  const [todos, setTodos] = useState<RegistryFollowUpItem[]>([]);
  const [followUpAttempt, setFollowUpAttempt] = useState(0);
  const [followUpState, setFollowUpState] = useState<'loading' | 'ready' | 'error' | 'missing'>('loading');

  useEffect(() => {
    if (!snapshot) { setRegistryItem(null); setTodos([]); return undefined; }
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
    return <>{cartulary.refreshError && <div role="alert"><p>La publication a été traitée mais les données du Cartulaire n’ont pas pu être actualisées. Réessayez avant de poursuivre les modifications.</p><button type="button" onClick={cartulary.refresh}>Actualiser le Cartulaire</button></div>}<GenericCartularyView snapshot={snapshot} schema={schema} returnHref={returnTo} collectionName={cartulary.collectionName} assets={cartulary.assets} mediaError={cartulary.mediaError} registryItem={registryItem} todos={todos} followUpState={followUpState} onRetryFollowUp={() => setFollowUpAttempt((value) => value + 1)} canManage={cartulary.canManage && !cartulary.refreshError} canPublish={cartulary.canPublish} onPublicationChanged={cartulary.refresh}
      onUploadMedia={cartulary.uploadMedia}
      onRetryMedia={cartulary.reloadAssets}
      onSaveMedia={cartulary.saveMedia}
      onSave={cartulary.saveFields} /></>;
  }

  return (
    <main className="generic-cartulary-state">
      <h1>{status === 'loading' ? 'Chargement du Cartulaire' : status === 'denied' ? 'Accès refusé' : status === 'error' ? 'Cartulaire momentanément indisponible' : status === 'signed-out' ? 'Connexion requise' : 'Cartulaire introuvable'}</h1>
      <p>{status === 'denied'
        ? 'La session ne possède pas la portée nécessaire.'
        : status === 'error' ? 'La lecture n’a pas abouti. Vérifiez votre connexion puis réessayez.' : 'Utilisez une session authentifiée et un identifiant de Cartulaire autorisé.'}</p>
      {status === 'error' && <button type="button" onClick={cartulary.retry}>Réessayer</button>}
      {status === 'signed-out' && <a href={`/account/sign-in?returnTo=${encodeURIComponent(window.location.pathname + window.location.search + window.location.hash)}`}>Se connecter pour ouvrir ce Cartulaire</a>}
      <a href={returnTo}>Retour au Registre</a>
    </main>
  );
};
