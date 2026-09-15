import { useEffect, useMemo, useState } from 'react';
import { FileText, Filter, Globe2, Layers3 } from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase.ts';
import { buildCartularyHref } from '../features/registry/registryCatalog.ts';
import {
  collectionLabelFromIdentifier,
  collectionWebsiteIsPublished,
  type CollectionWebsiteItemProjection,
  type CollectionWebsitePublication,
  type RegistryCollectionDocument,
} from '../domain/collections.ts';
import { registryItemCollectionIds, type RegistryItemProjection } from '../domain/projections.ts';
import { websiteHasPublishedContent } from '../domain/publication.ts';
import { loadCollectionWebsitePublication, loadRegistryCollections } from '../services/collections.ts';
import { loadRegistryItems, loadPublicPublicationSummaries } from '../services/projections.ts';
import { BrandLogo } from './BrandLogo.tsx';
import { registryCollectionsHref, signedOutRegistryLinks } from '../features/registry/registryReturn.ts';

type CollectionWebsiteState = 'auth-loading' | 'signed-out' | 'loading' | 'ready' | 'not-published' | 'denied' | 'invalid' | 'error';

const safeIdentifier = (value: string) => /^[A-Za-z0-9_-]{1,160}$/.test(value) ? value : null;

const parseCollectionWebsiteSelection = (search: string) => {
  const parameters = new URLSearchParams(search);
  const publicationId = safeIdentifier(parameters.get('publicationId') || '');
  const registryId = safeIdentifier(parameters.get('registryId') || '');
  const collectionIds = [...new Set((parameters.get('collectionIds') || '')
    .split(',')
    .map((value) => safeIdentifier(value.trim()))
    .filter((value): value is string => Boolean(value)))];
  // Une adresse publique (publicationId) ignore tout paramètre d'aperçu : aucun lien d'aperçu ni
  // « Ouvrir le Cartulaire » n'est obtenable par forgeage d'URL (V4, P-C6).
  const isPublicAddress = Boolean(publicationId);
  return {
    publicationId,
    preview: !isPublicAddress && parameters.get('preview') === 'local',
    registryId,
    collectionIds,
    previewCartularyId: isPublicAddress ? null : safeIdentifier(parameters.get('cartularyId') || ''),
    cartularyUrl: (() => {
      if (isPublicAddress) return null;
      const value = parameters.get('cartularyUrl');
      return value?.startsWith('/watch-website?') ? value : null;
    })(),
  };
};

const assetTypeLabel = (assetType: string) => assetType === 'watch'
  ? 'Montres'
  : assetType === 'car'
    ? 'Automobiles'
    : assetType || 'Autres objets';

/**
 * Statuts de lien par code public : un objet n'est lié que si sa publication est confirmée et porte au
 * moins un bloc admis pour le Web (même critère que le rendu de /watch-website). `unknown` si la lecture
 * a échoué : la Collection reste servie, aucun lien, jamais un faux état.
 */
const loadWebsiteLinkStatuses = async (codes: string[]) => {
  try {
    const summaries = await loadPublicPublicationSummaries(codes);
    return {
      statuses: Object.fromEntries(Object.entries(summaries)
        .map(([code, summary]): [string, boolean] => [code, summary.published && websiteHasPublishedContent(summary.blockIds)])),
      unknown: false,
    };
  } catch {
    return { statuses: {} as Record<string, boolean>, unknown: true };
  }
};

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
  const [publicStatuses, setPublicStatuses] = useState<Record<string, boolean>>({});
  const [publicStatusesUnknown, setPublicStatusesUnknown] = useState(false);

  useEffect(() => {
    if (selection.publicationId) {
      setState('loading');
      void loadCollectionWebsitePublication(selection.publicationId)
        .then(async (result) => {
          if (!result) {
            setState('not-published');
            return;
          }
          setPublication(result.publication);
          setPublicationItems(result.items);
          const { statuses, unknown } = await loadWebsiteLinkStatuses(result.items.flatMap((item) => item.publicCode ? [item.publicCode] : []));
          setPublicStatuses(statuses);
          setPublicStatusesUnknown(unknown);
          setState('ready');
        })
        .catch((error: { code?: string }) => setState(error.code === 'permission-denied' ? 'not-published' : 'error'));
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
      ]).then(async ([loadedCollections, loadedItems]) => {
        const activeItems = loadedItems.filter((entry) => entry.projectionStatus === 'active');
        setCollections(loadedCollections.filter((entry) => selection.collectionIds.includes(entry.id)));
        setItems(activeItems);
        // L'aperçu propriétaire lit les mêmes statuts publics que la page publique (G1), limités aux
        // objets qui seront affichés (Collections sélectionnées et objet courant), jamais tout le Registre.
        const codes = activeItems
          .filter((entry) => entry.cartularyId === selection.previewCartularyId
            || registryItemCollectionIds(entry).some((collectionId) => selection.collectionIds.includes(collectionId)))
          .flatMap((entry) => entry.objectCode ? [entry.objectCode] : []);
        const { statuses, unknown } = await loadWebsiteLinkStatuses(codes);
        setPublicStatuses(statuses);
        setPublicStatusesUnknown(unknown);
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
        : state === 'error' ? 'Chargement temporairement indisponible'
          : 'Chargement des Collections';
    return (
      <main className="catalog-site-state">
        <BrandLogo href="/" />
        <h1>{heading}</h1>
        <p>Ce mini-site lit uniquement une projection de publication dédiée et ne donne jamais accès aux Cartulaires maîtres ni aux données privées du Registre.</p>
        {state === 'signed-out' ? <>
          <a className="button button--primary" href={`/account/sign-in?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`}>Se connecter pour voir l’aperçu</a>
          {signedOutRegistryLinks(selection.registryId).map((link) => <a className="button button--quiet" href={link.href} key={link.kind}>{link.label}</a>)}
        </> : selection.preview && selection.registryId
          ? <a className="button button--quiet" href={registryCollectionsHref(selection.registryId)}>Retour au Registre</a>
          : <a className="button button--quiet" href="/">Retour à l’accueil</a>}
        {state === 'error' && <button type="button" onClick={() => window.location.reload()}>Réessayer</button>}
      </main>
    );
  }

  const activeRegistryId = selection.registryId
    || publication?.registryId
    || (selection.publicationId ? selection.publicationId.split('--')[0] : null)
    || '';
  // Aperçu propriétaire : l'en-tête dit l'état réel des Collections sélectionnées (statut, consentement, objets en ligne),
  // lu dans leurs documents ; le public ne voit que la projection des objets sélectionnés d'une Collection publiée.
  const previewStatus = (() => {
    if (!selection.preview) return null;
    const published = collections.filter((entry) => selection.collectionIds.includes(entry.id) && collectionWebsiteIsPublished(entry));
    if (published.length === 0) return selection.collectionIds.length > 1 ? 'Collections non publiées' : 'Collection non publiée';
    const online = new Set(published.flatMap((entry) => entry.publishedCartularyIds ?? [])).size;
    const label = published.length < selection.collectionIds.length
      ? `${published.length} Collection${published.length > 1 ? 's' : ''} publiée${published.length > 1 ? 's' : ''} sur ${selection.collectionIds.length}`
      : published.length > 1 ? `${published.length} Collections publiées` : 'Collection publiée';
    return `${label} (${online} objet${online > 1 ? 's' : ''} en ligne)`;
  })();

  return (
    <div className="catalog-site">
      <header className="catalog-site__header">
        <BrandLogo href={selection.preview ? `/registry/${encodeURIComponent(activeRegistryId)}/collections` : '/'} />
        <div>
          <span className="eyebrow">{previewStatus ? `Aperçu local · ${previewStatus}` : 'Mini-site de Collection'}</span>
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
                  const rawPublicCode = 'publicCode' in item ? item.publicCode : item.objectCode;
                  const effectivePublicCode = rawPublicCode
                    || '';
                  const isLocalPreview = selection.preview && item.cartularyId === selection.previewCartularyId && selection.cartularyUrl;
                  const watchWebsiteHref = isLocalPreview
                    ? selection.cartularyUrl!
                    : `/watch-website?publicCode=${encodeURIComponent(effectivePublicCode)}`;
                  const hasPublicWebsite = Boolean(isLocalPreview || publicStatuses[effectivePublicCode]);
                  const returnTo = selection.preview && selection.registryId
                    ? `/registry/${encodeURIComponent(selection.registryId)}/collections`
                    : window.location.pathname + window.location.search;
                  const cartularyHref = buildCartularyHref(item.cartularyId, returnTo, item.assetType);

                  return (
                    <article key={item.cartularyId}>
                      <span>{assetTypeLabel(item.assetType)}</span>
                      <h3>{hasPublicWebsite ? <a href={watchWebsiteHref} target="_blank" rel="noreferrer">{item.displayTitle}</a> : item.displayTitle}</h3>
                      <p>{item.makerName} · {item.modelName}</p>
                      <dl><div><dt>Référence</dt><dd>{item.referenceCode || '—'}</dd></div><div><dt>Année</dt><dd>{item.manufactureYear || '—'}</dd></div></dl>
                      <footer>
                        {hasPublicWebsite ? <a className="is-primary" href={watchWebsiteHref} target="_blank" rel="noreferrer">
                          <Globe2 size={13} aria-hidden="true" />
                          Voir le mini-site
                        </a> : <span>{publicStatusesUnknown ? 'État du mini-site indisponible' : 'Mini-site de l’objet non publié'}</span>}
                        {selection.preview && <a href={cartularyHref}>
                          <FileText size={13} aria-hidden="true" />
                          Ouvrir le Cartulaire
                        </a>}
                      </footer>
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
