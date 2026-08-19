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
  SlidersHorizontal,
  X,
  ZoomIn,
} from 'lucide-react';
import type { RegistryGalleryEntry } from '../../domain/gallery.ts';
import type { RegistryDocument } from '../../domain/foundations.ts';
import {
  loadRegistryGallery,
  observeRegistryGallery,
  resolveRegistryGallerySlide,
  revokeRegistryGalleryObjectUrls,
} from '../../services/registryGallery.ts';
import { buildCartularyHref } from './registryCatalog.ts';
import {
  DEFAULT_REGISTRY_GALLERY_FILTERS,
  filterRegistryGallery,
  gallerySlidesForCategory,
} from './registryGallery.ts';
import { ASSET_TYPE_LABELS, labelFromIdentifier } from './registryPresentation.ts';
import { useDialogFocus } from '../../hooks/useDialogFocus.ts';

type GalleryLoadState = 'loading' | 'ready' | 'error';

const optionValues = (
  entries: RegistryGalleryEntry[],
  getter: (entry: RegistryGalleryEntry) => string[],
) => [...new Set(entries.flatMap(getter).filter(Boolean))]
  .sort((left, right) => left.localeCompare(right, 'fr', { sensitivity: 'base' }));

const formatDate = (value: string | null) => value
  ? new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(value))
  : 'Date non renseignée';

export function RegistryGallery({ registry, canReadCartularies }: {
  registry: RegistryDocument;
  canReadCartularies: boolean;
}) {
  const [entries, setEntries] = useState<RegistryGalleryEntry[]>([]);
  const [loadState, setLoadState] = useState<GalleryLoadState>('loading');
  const [query, setQuery] = useState(DEFAULT_REGISTRY_GALLERY_FILTERS.query);
  const [assetType, setAssetType] = useState(DEFAULT_REGISTRY_GALLERY_FILTERS.assetType);
  const [collectionId, setCollectionId] = useState(DEFAULT_REGISTRY_GALLERY_FILTERS.collectionId);
  const [makerName, setMakerName] = useState(DEFAULT_REGISTRY_GALLERY_FILTERS.makerName);
  const [category, setCategory] = useState(DEFAULT_REGISTRY_GALLERY_FILTERS.category);
  const [selectedCartularyId, setSelectedCartularyId] = useState<string | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [loadingSlideId, setLoadingSlideId] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const lightboxRef = useRef<HTMLDivElement>(null);
  const entriesRef = useRef<RegistryGalleryEntry[]>([]);

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

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => () => revokeRegistryGalleryObjectUrls(entriesRef.current), []);

  useEffect(() => {
    const unresolvedCovers = entries.flatMap((entry) => {
      const slides = gallerySlidesForCategory(entry, 'all');
      const cover = slides.find((slide) => slide.assetId === entry.primaryAssetId) || slides[0];
      return cover && cover.source !== 'error' && !cover.url && cover.storagePath ? [cover] : [];
    });
    if (unresolvedCovers.length === 0) return undefined;
    let active = true;
    void Promise.all(unresolvedCovers.map(resolveRegistryGallerySlide))
      .then((resolvedCovers) => {
        if (!active) return;
        const resolvedById = new Map(resolvedCovers.map((slide) => [`${slide.cartularyId}:${slide.assetId}`, slide]));
        setEntries((current) => current.map((entry) => ({
          ...entry,
          slides: entry.slides.map((slide) => resolvedById.get(`${slide.cartularyId}:${slide.assetId}`) ?? slide),
        })));
      });
    return () => {
      active = false;
    };
  }, [entries]);

  const filteredEntries = useMemo(() => filterRegistryGallery(entries, {
    query,
    assetType,
    collectionId,
    makerName,
    category,
  }), [assetType, category, collectionId, entries, makerName, query]);
  const selectedEntry = useMemo(() => filteredEntries.find(
    (entry) => entry.item.cartularyId === selectedCartularyId,
  ) || null, [filteredEntries, selectedCartularyId]);
  const selectedSlides = useMemo(() => selectedEntry
    ? gallerySlidesForCategory(selectedEntry, category)
    : [], [category, selectedEntry]);
  const selectedSlide = selectedSlides[slideIndex] || selectedSlides[0] || null;
  const assetTypes = useMemo(() => optionValues(entries, (entry) => [entry.item.assetType]), [entries]);
  const collections = useMemo(() => optionValues(entries, (entry) => [entry.item.collectionId]), [entries]);
  const makers = useMemo(() => optionValues(entries, (entry) => [entry.item.makerName]), [entries]);
  const categories = useMemo(() => optionValues(entries, (entry) => entry.slides.map((slide) => slide.category)), [entries]);
  const activeFilterCount = [query.trim(), assetType !== 'all', collectionId !== 'all', makerName !== 'all', category !== 'all']
    .filter(Boolean).length;

  const closeLightbox = useCallback(() => {
    setSelectedCartularyId(null);
    setSlideIndex(0);
  }, []);

  useDialogFocus(Boolean(selectedEntry && selectedSlide), lightboxRef, closeLightbox);

  useEffect(() => {
    if (!selectedSlide || selectedSlide.source === 'error' || selectedSlide.url || !selectedSlide.storagePath) return undefined;
    let active = true;
    setLoadingSlideId(selectedSlide.assetId);
    void resolveRegistryGallerySlide(selectedSlide)
      .then((resolved) => {
        if (!active) return;
        setEntries((current) => current.map((entry) => entry.item.cartularyId === resolved.cartularyId
          ? { ...entry, slides: entry.slides.map((slide) => slide.assetId === resolved.assetId ? resolved : slide) }
          : entry));
      })
      .finally(() => {
        if (active) setLoadingSlideId(null);
      });
    return () => {
      active = false;
    };
  }, [selectedSlide]);

  const moveSlide = useCallback((direction: number) => {
    setSlideIndex((current) => selectedSlides.length
      ? (current + direction + selectedSlides.length) % selectedSlides.length
      : 0);
  }, [selectedSlides.length]);

  useEffect(() => {
    if (!selectedCartularyId) return undefined;
    if (!selectedEntry || selectedSlides.length === 0) {
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
  }, [closeLightbox, moveSlide, selectedCartularyId, selectedEntry, selectedSlides.length]);

  const resetFilters = () => {
    setQuery('');
    setAssetType('all');
    setCollectionId('all');
    setMakerName('all');
    setCategory('all');
  };

  useEffect(() => {
    setSlideIndex(0);
  }, [category]);

  if (!canReadCartularies) {
    return (
      <section className="registry-gallery registry-gallery--denied">
        <LockKeyhole aria-hidden="true" />
        <p className="registry-kicker">Galerie privée</p>
        <h1>Accès aux médias non attribué</h1>
        <p>La Galerie lit les références autorisées dans chaque Cartulaire. Votre rôle ne possède pas le droit nécessaire.</p>
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
          <p>Une image principale par Cartulaire. La visionneuse lit ensuite son diaporama autorisé, sans recopier les actifs média dans le Registre.</p>
        </div>
        <div className="registry-gallery__security"><ShieldCheck aria-hidden="true" /><span>Références Cartulaire</span></div>
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

      <div className="registry-gallery-filters" aria-label="Filtres de la Galerie">
        <div className="registry-filter-title"><SlidersHorizontal aria-hidden="true" /><span>Personnaliser</span>{activeFilterCount > 0 && <strong>{activeFilterCount}</strong>}</div>
        <label><span>Type d’actif</span><select value={assetType} onChange={(event) => setAssetType(event.target.value)}><option value="all">Tous les types</option>{assetTypes.map((value) => <option value={value} key={value}>{ASSET_TYPE_LABELS[value] || labelFromIdentifier(value)}</option>)}</select></label>
        <label><span>Collection</span><select value={collectionId} onChange={(event) => setCollectionId(event.target.value)}><option value="all">Toutes les collections</option>{collections.map((value) => <option value={value} key={value}>{labelFromIdentifier(value)}</option>)}</select></label>
        <label><span>Maison / marque</span><select value={makerName} onChange={(event) => setMakerName(event.target.value)}><option value="all">Toutes les maisons</option>{makers.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
        <label><span>Vue du diaporama</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">Toutes les vues</option>{categories.map((value) => <option value={value} key={value}>{labelFromIdentifier(value)}</option>)}</select></label>
        {activeFilterCount > 0 && <button type="button" className="registry-filter-reset" onClick={resetFilters}>Effacer</button>}
      </div>

      <div className="registry-gallery-results" aria-live="polite"><strong>{filteredEntries.length}</strong><span> Cartulaire{filteredEntries.length > 1 ? 's' : ''} affiché{filteredEntries.length > 1 ? 's' : ''}</span></div>

      {loadState === 'loading' && <div className="registry-gallery-state" role="status"><LoaderCircle className="registry-spinner" aria-hidden="true" /><h2>Chargement de la Galerie</h2><p>Lecture des images de présentation autorisées…</p></div>}
      {loadState === 'error' && <div className="registry-gallery-state registry-gallery-state--error" role="alert"><ImageOff aria-hidden="true" /><h2>Galerie indisponible</h2><p>Les références média des Cartulaires n’ont pas pu être chargées.</p><button type="button" onClick={() => void reload()}>Réessayer</button></div>}
      {loadState === 'ready' && filteredEntries.length === 0 && <div className="registry-gallery-state"><Images aria-hidden="true" /><h2>{entries.length === 0 ? 'Aucune image de présentation disponible' : 'Aucun résultat'}</h2><p>{entries.length === 0 ? 'Les médias restent dans les Cartulaires. Une dérivée autorisée est nécessaire pour apparaître ici.' : 'Modifiez les filtres pour afficher d’autres Cartulaires.'}</p>{entries.length > 0 && <button type="button" onClick={resetFilters}>Afficher toute la Galerie</button>}</div>}

      {loadState === 'ready' && filteredEntries.length > 0 && (
        <div className="registry-gallery-grid">
          {filteredEntries.map((entry) => {
            const slides = gallerySlidesForCategory(entry, category);
            const cover = slides.find((slide) => slide.assetId === entry.primaryAssetId) || slides[0];
            const cartularyHref = buildCartularyHref(entry.item.cartularyId, window.location.pathname + window.location.search, entry.item.assetType);
            return (
              <article className="registry-gallery-card" key={entry.item.cartularyId}>
                {cover ? (
                  <button type="button" className="registry-gallery-card__visual" onClick={() => { setSelectedCartularyId(entry.item.cartularyId); setSlideIndex(0); }} aria-label={`Ouvrir le diaporama de ${entry.item.displayTitle}`}>
                    {cover.thumbnailUrl
                      ? <img src={cover.thumbnailUrl} alt={`Vue principale — ${entry.item.displayTitle}`} loading="lazy" decoding="async" />
                      : cover.source === 'error'
                        ? <span className="registry-gallery-card__pending"><ImageOff aria-hidden="true" /><span>Aperçu privé non accessible</span></span>
                      : <span className="registry-gallery-card__pending"><LoaderCircle className="registry-spinner" aria-hidden="true" /><span>Aperçu à charger</span></span>}
                    <span className="registry-gallery-card__zoom"><ZoomIn aria-hidden="true" />Ouvrir</span>
                    <span className="registry-gallery-card__count"><Images aria-hidden="true" />{slides.length} photo{slides.length > 1 ? 's' : ''}</span>
                  </button>
                ) : (
                  <div className="registry-gallery-card__visual registry-gallery-card__visual--empty">
                    <ImageOff aria-hidden="true" />
                    <span>Image indisponible</span>
                  </div>
                )}
                <div className="registry-gallery-card__body">
                  <span>{ASSET_TYPE_LABELS[entry.item.assetType] || labelFromIdentifier(entry.item.assetType)} · {labelFromIdentifier(entry.item.collectionId)}</span>
                  <h2>{entry.item.displayTitle}</h2>
                  <p>{entry.item.makerName} · {entry.item.modelName}</p>
                  {cover?.source === 'prototype_bundle' && <small>Aperçu intégré du Cartulaire pilote</small>}
                  {cover?.source === 'firebase_storage' && <small>Original privé lu depuis Firebase Storage</small>}
                  {cover?.source === 'error' && <small>Aperçu protégé : ouvrez le Cartulaire avec le compte propriétaire ou ajoutez une dérivée autorisée.</small>}
                  {!cover && <small>Le Cartulaire reste accessible même si son aperçu média ne l’est pas.</small>}
                  <a className="registry-gallery-card__link" href={cartularyHref}>Ouvrir le Cartulaire <ExternalLink aria-hidden="true" /></a>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {selectedEntry && selectedSlide && (
        <div ref={lightboxRef} className="registry-lightbox" role="dialog" aria-modal="true" aria-labelledby="registry-lightbox-title" data-focus-layer="true" tabIndex={-1}>
          <div className="registry-lightbox__panel">
            <header>
              <div><span>{selectedEntry.item.makerName}</span><h2 id="registry-lightbox-title">{selectedEntry.item.displayTitle}</h2></div>
              <div><span>{slideIndex + 1} / {selectedSlides.length}</span><button ref={closeButtonRef} type="button" onClick={closeLightbox} aria-label="Fermer la visionneuse"><X aria-hidden="true" /></button></div>
            </header>
            <div className="registry-lightbox__stage">
              {selectedSlides.length > 1 && <button type="button" className="registry-lightbox__arrow registry-lightbox__arrow--previous" onClick={() => moveSlide(-1)} aria-label="Photo précédente"><ChevronLeft aria-hidden="true" /></button>}
              <figure>{selectedSlide.url
                ? <img src={selectedSlide.url} alt={`${selectedSlide.displayName} — ${selectedEntry.item.displayTitle}`} decoding="async" />
                : selectedSlide.source === 'error'
                  ? <span className="registry-lightbox__loading"><ImageOff aria-hidden="true" /><strong>Photo privée non accessible avec ce compte</strong></span>
                : <span className="registry-lightbox__loading"><LoaderCircle className="registry-spinner" aria-hidden="true" /><strong>{loadingSlideId === selectedSlide.assetId ? 'Chargement de la photo…' : 'Photo à charger'}</strong></span>}<figcaption><strong>{selectedSlide.displayName}</strong><span>{labelFromIdentifier(selectedSlide.category)} · {formatDate(selectedSlide.capturedAt)}</span></figcaption></figure>
              {selectedSlides.length > 1 && <button type="button" className="registry-lightbox__arrow registry-lightbox__arrow--next" onClick={() => moveSlide(1)} aria-label="Photo suivante"><ChevronRight aria-hidden="true" /></button>}
            </div>
            {selectedSlides.length > 1 && <div className="registry-lightbox__thumbnails" aria-label="Photos du diaporama">{selectedSlides.map((slide, index) => <button type="button" aria-current={index === slideIndex ? 'true' : undefined} onClick={() => setSlideIndex(index)} key={slide.assetId}>{slide.thumbnailUrl ? <img src={slide.thumbnailUrl} alt="" loading="lazy" decoding="async" /> : <ImageOff aria-hidden="true" />}<span>{index + 1}</span></button>)}</div>}
            <footer><span><ShieldCheck aria-hidden="true" />Média lu depuis le Cartulaire</span><a href={buildCartularyHref(selectedEntry.item.cartularyId, window.location.pathname + window.location.search, selectedEntry.item.assetType)}>Ouvrir le Cartulaire <ExternalLink aria-hidden="true" /></a></footer>
          </div>
        </div>
      )}
    </section>
  );
}
