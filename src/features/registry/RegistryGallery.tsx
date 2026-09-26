import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ImageOff,
  Images,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
  ZoomIn,
} from 'lucide-react';
import { PrivateMediaImage } from '../../components/PrivateMediaImage.tsx';
import type { RegistryGalleryEntry, RegistryGallerySlide } from '../../domain/gallery.ts';
import type { RegistryDocument } from '../../domain/foundations.ts';
import { registryItemCollectionIds } from '../../domain/projections.ts';
import { REGISTRY_THUMBNAIL_STATE_LABELS } from '../../domain/registryThumbnail.ts';
import type { Asset } from '../../types';
import {
  loadRegistryGallery,
  loadRegistryGallerySlides,
  observeRegistryGallery,
} from '../../services/registryGallery.ts';
import { buildCartularyHref } from './registryCatalog.ts';
import { DEFAULT_REGISTRY_GALLERY_FILTERS, filterRegistryGallery } from './registryGallery.ts';
import { ASSET_TYPE_LABELS, labelFromIdentifier } from './registryPresentation.ts';
import { useDialogFocus } from '../../hooks/useDialogFocus.ts';
import { RegistryFilterPanel } from './RegistryFilterPanel.tsx';
import { useRegistryCollections } from './useRegistryCollections.ts';

type GalleryLoadState = 'loading' | 'ready' | 'error';
type LightboxStatus = 'loading' | 'ready' | 'error';
interface LightboxState { cartularyId: string; status: LightboxStatus; slides: RegistryGallerySlide[] }

const THUMBNAIL_STATE_HINTS: Record<'pending' | 'failed' | 'unavailable' | 'none', string> = {
  pending: 'La vignette sera produite après vérification de la photo de couverture.',
  failed: 'La copie de présentation de la couverture n’a pas pu être produite ; l’original reste consultable dans le Cartulaire.',
  unavailable: 'La couverture de ce Cartulaire n’a pas de vignette de présentation.',
  none: 'Le Cartulaire reste accessible même sans photo de couverture.',
};

const optionValues = (
  entries: RegistryGalleryEntry[],
  getter: (entry: RegistryGalleryEntry) => string[],
) => [...new Set(entries.flatMap(getter).filter(Boolean))]
  .sort((left, right) => left.localeCompare(right, 'fr', { sensitivity: 'base' }));

const formatDate = (value: string | null) => value
  ? new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(value))
  : 'Date non renseignée';

/** Asset minimal pour PrivateMediaImage : variantes privées (rôle stage/thumbnail), jamais l'original. */
const slideAsset = (slide: RegistryGallerySlide): Asset => ({
  id: slide.assetId,
  cartularyId: slide.cartularyId,
  name: slide.displayName,
  url: '',
  type: 'image',
  hash: '',
  status: 'Archived',
  visibility: 'Secret',
  tags: [],
  binaryId: slide.binaryId ?? undefined,
  privatePresentation: slide.privatePresentation ?? undefined,
});

function LightboxStage({ slide, title }: { slide: RegistryGallerySlide; title: string }) {
  const alt = `${slide.displayName} — ${title}`;
  if (slide.access === 'bundle' && slide.url) return <img src={slide.url} alt={alt} decoding="async" />;
  if (slide.access === 'owner') return <PrivateMediaImage asset={slideAsset(slide)} alt={alt} role="stage" eager sizes="(max-width: 720px) 100vw, 1120px" />;
  if (slide.access === 'restricted') return <span className="registry-lightbox__loading" data-slide-access="restricted"><LockKeyhole aria-hidden="true" /><strong>Photos privées non accessibles avec ce compte</strong><small>Les copies de présentation restent réservées au propriétaire du Cartulaire.</small></span>;
  return <span className="registry-lightbox__loading" data-slide-access="unavailable"><ImageOff aria-hidden="true" /><strong>Aucun aperçu disponible pour cette photo</strong></span>;
}

function LightboxThumbnail({ slide }: { slide: RegistryGallerySlide }) {
  if (slide.access === 'bundle' && slide.thumbnailUrl) return <img src={slide.thumbnailUrl} alt="" loading="lazy" decoding="async" />;
  if (slide.access === 'owner') return <PrivateMediaImage asset={slideAsset(slide)} alt="" role="thumbnail" sizes="58px" />;
  return <ImageOff aria-hidden="true" />;
}

export function RegistryGallery({ registry, canReadCartularies }: {
  registry: RegistryDocument;
  canReadCartularies: boolean;
}) {
  const { collectionName } = useRegistryCollections(registry.id);
  const [entries, setEntries] = useState<RegistryGalleryEntry[]>([]);
  const [loadState, setLoadState] = useState<GalleryLoadState>('loading');
  const [query, setQuery] = useState(DEFAULT_REGISTRY_GALLERY_FILTERS.query);
  const [assetType, setAssetType] = useState(DEFAULT_REGISTRY_GALLERY_FILTERS.assetType);
  const [collectionId, setCollectionId] = useState(DEFAULT_REGISTRY_GALLERY_FILTERS.collectionId);
  const [makerName, setMakerName] = useState(DEFAULT_REGISTRY_GALLERY_FILTERS.makerName);
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const lightboxRef = useRef<HTMLDivElement>(null);
  const lightboxGeneration = useRef(0);

  const reload = useCallback(async () => {
    if (!canReadCartularies) return;
    setLoadState('loading');
    try {
      setEntries(await loadRegistryGallery(registry.id));
      setLoadState('ready');
    } catch {
      setEntries([]);
      setLoadState('error');
    }
  }, [canReadCartularies, registry.id]);

  useEffect(() => {
    if (!canReadCartularies) return undefined;
    setLoadState('loading');
    return observeRegistryGallery(registry.id, (nextEntries) => {
      setEntries(nextEntries);
      setLoadState('ready');
    }, () => {
      setEntries([]);
      setLoadState('error');
    });
  }, [canReadCartularies, registry.id]);

  const filteredEntries = useMemo(() => filterRegistryGallery(entries, {
    query,
    assetType,
    collectionId,
    makerName,
  }), [assetType, collectionId, entries, makerName, query]);
  const selectedEntry = useMemo(() => (lightbox
    ? filteredEntries.find((entry) => entry.item.cartularyId === lightbox.cartularyId) || null
    : null), [filteredEntries, lightbox]);
  const selectedSlides = lightbox?.status === 'ready' ? lightbox.slides : [];
  const selectedSlide = selectedSlides[slideIndex] || selectedSlides[0] || null;
  const assetTypes = useMemo(() => optionValues(entries, (entry) => [entry.item.assetType]), [entries]);
  const collections = useMemo(() => optionValues(entries, (entry) => registryItemCollectionIds(entry.item)), [entries]);
  const makers = useMemo(() => optionValues(entries, (entry) => [entry.item.makerName]), [entries]);
  const activeFilterCount = [query.trim(), assetType !== 'all', collectionId !== 'all', makerName !== 'all']
    .filter(Boolean).length;

  const closeLightbox = useCallback(() => {
    lightboxGeneration.current += 1;
    setLightbox(null);
    setSlideIndex(0);
  }, []);

  // Les diapositives (assets) ne sont lues qu'ici, à l'ouverture : les cartes n'ont déclenché aucune lecture.
  const openLightbox = useCallback((entry: RegistryGalleryEntry) => {
    const generation = ++lightboxGeneration.current;
    setLightbox({ cartularyId: entry.item.cartularyId, status: 'loading', slides: [] });
    setSlideIndex(0);
    void loadRegistryGallerySlides({ cartularyId: entry.item.cartularyId, primaryAssetId: entry.primaryAssetId })
      .then((slides) => {
        if (generation === lightboxGeneration.current) setLightbox({ cartularyId: entry.item.cartularyId, status: 'ready', slides });
      })
      .catch(() => {
        if (generation === lightboxGeneration.current) setLightbox({ cartularyId: entry.item.cartularyId, status: 'error', slides: [] });
      });
  }, []);

  useDialogFocus(Boolean(lightbox && selectedEntry), lightboxRef, closeLightbox);

  const moveSlide = useCallback((direction: number) => {
    setSlideIndex((current) => selectedSlides.length
      ? (current + direction + selectedSlides.length) % selectedSlides.length
      : 0);
  }, [selectedSlides.length]);

  useEffect(() => {
    if (!lightbox) return undefined;
    if (!selectedEntry) {
      closeLightbox();
      return undefined;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') moveSlide(-1);
      if (event.key === 'ArrowRight') moveSlide(1);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeLightbox, lightbox, moveSlide, selectedEntry]);

  const resetFilters = () => {
    setQuery('');
    setAssetType('all');
    setCollectionId('all');
    setMakerName('all');
  };

  if (!canReadCartularies) {
    return (
      <section className="registry-gallery registry-gallery--denied">
        <LockKeyhole aria-hidden="true" />
        <p className="registry-kicker">Galerie privée</p>
        <h1>Accès aux médias non attribué</h1>
        <p>La Galerie lit les vignettes de présentation de chaque Cartulaire. Votre rôle ne possède pas le droit nécessaire.</p>
        <a href={`/registry/${encodeURIComponent(registry.id)}/overview`}>Retour à la vue d’ensemble</a>
      </section>
    );
  }

  return (
    <section className="registry-gallery" aria-labelledby="registry-gallery-title">
      <header className="registry-page-heading registry-gallery__heading">
        <div>
          <p className="registry-kicker">Vue visuelle du Registre</p>
          <h1 id="registry-gallery-title">Galerie des Cartulaires</h1>
        </div>
      </header>

      <div className="registry-gallery-toolbar">
        <label className="registry-search">
          <span className="sr-only">Rechercher dans la Galerie</span>
          <Search aria-hidden="true" />
          <input type="search" placeholder="Rechercher une marque, un modèle, une référence…" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button type="button" className="registry-refresh" onClick={() => void reload()} disabled={loadState === 'loading'}>
          <RefreshCw className={loadState === 'loading' ? 'registry-spinner' : undefined} aria-hidden="true" />
          <span>Actualiser</span>
        </button>
      </div>

      <RegistryFilterPanel className="registry-gallery-filters" label="Filtres de la Galerie" activeFilterCount={activeFilterCount}>
        <label><span>Type d’actif</span><select value={assetType} onChange={(event) => setAssetType(event.target.value)}><option value="all">Tous les types</option>{assetTypes.map((value) => <option value={value} key={value}>{ASSET_TYPE_LABELS[value] || labelFromIdentifier(value)}</option>)}</select></label>
        <label><span>Collection</span><select value={collectionId} onChange={(event) => setCollectionId(event.target.value)}><option value="all">Toutes les collections</option>{collections.map((value) => <option value={value} key={value}>{collectionName(value)}</option>)}</select></label>
        <label><span>Maison / marque</span><select value={makerName} onChange={(event) => setMakerName(event.target.value)}><option value="all">Toutes les maisons</option>{makers.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
        {activeFilterCount > 0 && <button type="button" className="registry-filter-reset" onClick={resetFilters}>Effacer</button>}
      </RegistryFilterPanel>

      <div className="registry-gallery-results" aria-live="polite"><strong>{filteredEntries.length}</strong><span> Cartulaire{filteredEntries.length > 1 ? 's' : ''} affiché{filteredEntries.length > 1 ? 's' : ''}</span></div>

      {loadState === 'loading' && <div className="registry-gallery-state" role="status"><LoaderCircle className="registry-spinner" aria-hidden="true" /><h2>Chargement de la Galerie</h2><p>Lecture des vignettes de présentation du Registre…</p></div>}
      {loadState === 'error' && <div className="registry-gallery-state registry-gallery-state--error" role="alert"><ImageOff aria-hidden="true" /><h2>Galerie indisponible</h2><p>Les Cartulaires du Registre n’ont pas pu être chargés.</p><button type="button" onClick={() => void reload()}>Réessayer</button></div>}
      {loadState === 'ready' && filteredEntries.length === 0 && <div className="registry-gallery-state"><Images aria-hidden="true" /><h2>{entries.length === 0 ? 'Aucun Cartulaire dans ce Registre' : 'Aucun résultat'}</h2><p>{entries.length === 0 ? 'La Galerie se remplira lorsque des Cartulaires seront projetés dans ce Registre.' : 'Modifiez les filtres pour afficher d’autres Cartulaires.'}</p>{entries.length > 0 && <button type="button" onClick={resetFilters}>Afficher toute la Galerie</button>}</div>}

      {loadState === 'ready' && filteredEntries.length > 0 && (
        <div className="registry-gallery-grid">
          {filteredEntries.map((entry) => {
            const cartularyHref = buildCartularyHref(entry.item.cartularyId, window.location.pathname + window.location.search, entry.item.assetType);
            const { thumbnail, thumbnailSrc, thumbnailState } = entry;
            return (
              <article className="registry-gallery-card" key={entry.item.cartularyId} data-thumbnail-state={thumbnailState}>
                <button type="button" className="registry-gallery-card__visual" onClick={() => openLightbox(entry)} aria-label={`Ouvrir les photos de ${entry.item.displayTitle}`}>
                  {thumbnailSrc && thumbnail
                    ? <img src={thumbnailSrc} alt={`Vue principale — ${entry.item.displayTitle}`} width={thumbnail.width} height={thumbnail.height} loading="lazy" decoding="async" />
                    : thumbnailState !== 'ready' && <span className="registry-gallery-card__pending"><Images aria-hidden="true" /><span>{REGISTRY_THUMBNAIL_STATE_LABELS[thumbnailState]}</span></span>}
                  <span className="registry-gallery-card__zoom"><ZoomIn aria-hidden="true" />Ouvrir</span>
                </button>
                <div className="registry-gallery-card__body">
                  <span>{ASSET_TYPE_LABELS[entry.item.assetType] || labelFromIdentifier(entry.item.assetType)} · {collectionName(entry.item.collectionId)}</span>
                  <h2>{entry.item.displayTitle}</h2>
                  <p>{entry.item.makerName} · {entry.item.modelName}</p>
                  {thumbnailState !== 'ready' && <small>{THUMBNAIL_STATE_HINTS[thumbnailState]}</small>}
                  <a className="registry-gallery-card__link" href={cartularyHref}>Ouvrir le Cartulaire <ExternalLink aria-hidden="true" /></a>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {lightbox && selectedEntry && (
        <div ref={lightboxRef} className="registry-lightbox" role="dialog" aria-modal="true" aria-labelledby="registry-lightbox-title" data-focus-layer="true" data-lightbox-status={lightbox.status} tabIndex={-1}>
          <div className="registry-lightbox__panel">
            <header>
              <div><span>{selectedEntry.item.makerName}</span><h2 id="registry-lightbox-title">{selectedEntry.item.displayTitle}</h2></div>
              <div><span>{selectedSlides.length > 0 ? `${slideIndex + 1} / ${selectedSlides.length}` : ''}</span><button ref={closeButtonRef} type="button" onClick={closeLightbox} aria-label="Fermer la visionneuse"><X aria-hidden="true" /></button></div>
            </header>
            <div className="registry-lightbox__stage">
              {selectedSlides.length > 1 && <button type="button" className="registry-lightbox__arrow registry-lightbox__arrow--previous" onClick={() => moveSlide(-1)} aria-label="Photo précédente"><ChevronLeft aria-hidden="true" /></button>}
              {lightbox.status === 'loading' && <span className="registry-lightbox__loading" role="status"><LoaderCircle className="registry-spinner" aria-hidden="true" /><strong>Lecture des photos du Cartulaire…</strong></span>}
              {lightbox.status === 'error' && <span className="registry-lightbox__loading" role="alert"><ImageOff aria-hidden="true" /><strong>Photos non accessibles avec ce compte</strong><button type="button" onClick={() => openLightbox(selectedEntry)}>Réessayer</button></span>}
              {lightbox.status === 'ready' && !selectedSlide && <span className="registry-lightbox__loading"><ImageOff aria-hidden="true" /><strong>Aucune photo de présentation dans ce Cartulaire</strong></span>}
              {selectedSlide && (
                <figure>
                  <LightboxStage slide={selectedSlide} title={selectedEntry.item.displayTitle} />
                  <figcaption><strong>{selectedSlide.displayName}</strong><span>{labelFromIdentifier(selectedSlide.category)} · {formatDate(selectedSlide.capturedAt)}</span></figcaption>
                </figure>
              )}
              {selectedSlides.length > 1 && <button type="button" className="registry-lightbox__arrow registry-lightbox__arrow--next" onClick={() => moveSlide(1)} aria-label="Photo suivante"><ChevronRight aria-hidden="true" /></button>}
            </div>
            {selectedSlides.length > 1 && <div className="registry-lightbox__thumbnails" aria-label="Photos du diaporama">{selectedSlides.map((slide, index) => <button type="button" aria-current={index === slideIndex ? 'true' : undefined} onClick={() => setSlideIndex(index)} key={slide.assetId}><LightboxThumbnail slide={slide} /><span>{index + 1}</span></button>)}</div>}
            <footer><span><ShieldCheck aria-hidden="true" />{selectedSlide?.access === 'restricted' ? 'Photos privées du propriétaire' : 'Copie de présentation lue depuis le Cartulaire'}</span><a href={buildCartularyHref(selectedEntry.item.cartularyId, window.location.pathname + window.location.search, selectedEntry.item.assetType)}>Ouvrir le Cartulaire <ExternalLink aria-hidden="true" /></a></footer>
          </div>
        </div>
      )}
    </section>
  );
}
