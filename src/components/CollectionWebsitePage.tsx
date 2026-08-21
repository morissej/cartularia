import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Filter, Layers3 } from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase.ts';
import {
  collectionLabelFromIdentifier,
  type CollectionWebsiteItemProjection,
  type CollectionWebsitePublication,
  type RegistryCollectionDocument,
} from '../domain/collections.ts';
import { registryItemCollectionIds, type RegistryItemProjection } from '../domain/projections.ts';
import { loadCollectionWebsitePublication, loadRegistryCollections } from '../services/collections.ts';
import { loadRegistryItems } from '../services/projections.ts';
import { BrandLogo } from './BrandLogo.tsx';

type CollectionWebsiteState = 'auth-loading' | 'signed-out' | 'loading' | 'ready' | 'not-published' | 'denied' | 'invalid';

const safeIdentifier = (value: string) => /^[A-Za-z0-9_-]{1,160}$/.test(value) ? value : null;

const parseCollectionWebsiteSelection = (search: string) => {
  const parameters = new URLSearchParams(search);
  const publicationId = safeIdentifier(parameters.get('publicationId') || '');
  const registryId = safeIdentifier(parameters.get('registryId') || '');
  const collectionIds = [...new Set((parameters.get('collectionIds') || '')
    .split(',')
    .map((value) => safeIdentifier(value.trim()))
    .filter((value): value is string => Boolean(value)))];
  return {
    publicationId,
    preview: parameters.get('preview') === 'local',
    registryId,
    collectionIds,
    previewCartularyId: safeIdentifier(parameters.get('cartularyId') || ''),
    cartularyUrl: parameters.get('cartularyUrl') || null,
  };
};

const assetTypeLabel = (assetType: string) => assetType === 'watch'
  ? 'Montres'
  : assetType === 'car'
    ? 'Automobiles'
    : assetType || 'Autres objets';

export const CollectionWebsitePage = () => {
  const selection = useMemo(() => parseCollectionWebsiteSelection(window.location.search), []);
  const [state, setState] = useState<CollectionWebsiteState>(() => selection.publicationId
    ? 'loading'
    : selection.preview && selection.registryId && selection.collectionIds.length > 0 ? 'auth-loading' : 'invalid');
  const [publication, setPublication] = useState<CollectionWebsitePublication | null>(null);
  const [publicationItems, setPublicationItems] = useState<CollectionWebsiteItemProjection[]>([]);
  const [collections, setCollections] = useState<RegistryCollectionDocument[]>([]);
  const [items, setItems] = useState<RegistryItemProjection[]>([]);
  const [assetType, setAssetType] = useState('all');

  useEffect(() => {
    if (selection.publicationId) {
      setState('loading');
      void loadCollectionWebsitePublication(selection.publicationId)
        .then((result) => {
          if (!result) {
            setState('not-published');
            return;
          }
          setPublication(result.publication);
          setPublicationItems(result.items);
          setState('ready');
        })
        .catch(() => setState('not-published'));
      return undefined;
    }
    const registryId = selection.registryId;
    if (!selection.preview || !registryId || selection.collectionIds.length === 0) return undefined;
    return onAuthStateChanged(auth, (user) => {
      if (!user) {
        setState('signed-out');
        return;
      }
      setState('loading');
      Promise.all([
        loadRegistryCollections(registryId),
        loadRegistryItems(registryId),
      ]).then(([loadedCollections, loadedItems]) => {
        setCollections(loadedCollections.filter((entry) => selection.collectionIds.includes(entry.id)));
        setItems(loadedItems.filter((entry) => entry.projectionStatus === 'active'));
        setState('ready');
      }).catch(() => setState('denied'));
    });
  }, [selection]);

  const selectedCollections = publication ? [{
    id: publication.collectionId,
    name: publication.websiteTitle,
    websiteTitle: publication.websiteTitle,
    description: publication.description,
  }] : selection.collectionIds.map((collectionId) => (
    collections.find((entry) => entry.id === collectionId) || {
      id: collectionId,
      name: collectionLabelFromIdentifier(collectionId),
      websiteTitle: collectionLabelFromIdentifier(collectionId),
      description: '',
    }
  ));
  const sourceItems: Array<RegistryItemProjection | CollectionWebsiteItemProjection> = publication
    ? publicationItems
    : items;
  const itemCollectionIds = (item: RegistryItemProjection | CollectionWebsiteItemProjection) => (
    'registryId' in item ? registryItemCollectionIds(item) : [item.collectionId]
  );
  const visibleItems = sourceItems.filter((item) => (
    (assetType === 'all' || item.assetType === assetType)
    && (itemCollectionIds(item).some((collectionId) => selectedCollections.some((entry) => entry.id === collectionId))
      || item.cartularyId === selection.previewCartularyId)
  ));
  const assetTypes = [...new Set(sourceItems.map((item) => item.assetType).filter(Boolean))].sort();

  if (state !== 'ready') {
    const heading = state === 'invalid'
        ? 'Adresse de Collection incomplète'
      : state === 'signed-out'
        ? 'Connexion requise'
        : state === 'not-published'
          ? 'Mini-site non publié'
        : state === 'denied'
          ? 'Accès aux Collections refusé'
          : 'Chargement des Collections';
    return (
      <main className="catalog-site-state">
        <BrandLogo />
        <h1>{heading}</h1>
        <p>Ce mini-site lit uniquement une projection de publication dédiée et ne donne jamais accès aux Cartulaires maîtres ni aux données privées du Registre.</p>
        <a className="button button--quiet" href={selection.preview && selection.registryId ? `/registry/${encodeURIComponent(selection.registryId)}/collections` : '/'}>{selection.preview ? 'Retour au Registre' : 'Retour à Cartularia'}</a>
      </main>
    );
  }

  return (
    <div className="catalog-site">
      <header className="catalog-site__header">
        <a href={selection.preview && selection.registryId ? `/registry/${encodeURIComponent(selection.registryId)}/collections` : '/'} aria-label={selection.preview ? 'Ouvrir les Collections du Registre' : 'Ouvrir Cartularia'}><BrandLogo /></a>
        <div>
          <span className="eyebrow">Mini-site de Collection</span>
          <h1>{selectedCollections.map((entry) => entry.websiteTitle || entry.name).join(' · ')}</h1>
          <p>{selectedCollections.length > 1 ? `${selectedCollections.length} Collections sélectionnées` : selectedCollections[0]?.description || 'Une sélection d’objets publiée depuis Cartularia.'}</p>
        </div>
      </header>

      <main className="catalog-site__main">
        <section className="catalog-site__filters" aria-label="Filtrer par type d’objet">
          <Filter aria-hidden="true" />
          <button type="button" className={assetType === 'all' ? 'is-active' : undefined} onClick={() => setAssetType('all')}>Tous les objets</button>
          {assetTypes.map((type) => <button type="button" className={assetType === type ? 'is-active' : undefined} onClick={() => setAssetType(type)} key={type}>{assetTypeLabel(type)}</button>)}
        </section>

        {selectedCollections.map((collectionEntry) => {
          const collectionItems = visibleItems.filter((item) => (
            itemCollectionIds(item).includes(collectionEntry.id)
            || (item.cartularyId === selection.previewCartularyId && selection.collectionIds.includes(collectionEntry.id))
          ));
          return (
            <section className="catalog-site__collection" key={collectionEntry.id}>
              <header><Layers3 aria-hidden="true" /><div><span>Collection</span><h2>{collectionEntry.websiteTitle || collectionEntry.name}</h2></div><strong>{collectionItems.length}</strong></header>
              {collectionItems.length > 0 ? <div className="catalog-site__grid">
                {collectionItems.map((item) => {
                  const publicCode = 'publicCode' in item ? item.publicCode : item.objectCode || null;
                  const isLocalPreview = selection.preview && item.cartularyId === selection.previewCartularyId && selection.cartularyUrl;
                  const href = isLocalPreview
                    ? selection.cartularyUrl!
                    : publicCode
                      ? `/watch-website?publicCode=${encodeURIComponent(publicCode)}`
                      : null;
                  return (
                    <article key={item.cartularyId}>
                      <span>{assetTypeLabel(item.assetType)}</span>
                      <h3>{item.displayTitle}</h3>
                      <p>{item.makerName} · {item.modelName}</p>
                      <dl><div><dt>Référence</dt><dd>{item.referenceCode || '—'}</dd></div><div><dt>Année</dt><dd>{item.manufactureYear || '—'}</dd></div></dl>
                      {href && <a href={href} target="_blank" rel="noreferrer">Voir le mini-site de l’objet <ExternalLink aria-hidden="true" /></a>}
                    </article>
                  );
                })}
              </div> : <p className="catalog-site__empty">Aucun objet publié de ce type dans cette Collection.</p>}
            </section>
          );
        })}
      </main>
    </div>
  );
};
