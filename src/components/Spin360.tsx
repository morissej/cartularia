import React, { useState, useEffect, useRef } from 'react';
import type { Asset } from '../types';
import { RotateCw, Play, Pause, ChevronLeft, ChevronRight } from 'lucide-react';
import { alternatingFrameOrder, runBoundedPreloadQueue } from '../utils/boundedPreloadQueue.ts';
import { useMediaSource, usableMediaUrl } from '../hooks/useMediaSource';
import { presentationDerivativeUrl } from '../media/presentationDerivatives';
import { mediaFailureMessage } from '../utils/mediaFailure';

const MAXIMUM_CONCURRENT_SPIN_PRELOADS = 2;

const spinPresentationUrl = (source: string) => presentationDerivativeUrl(source, 768) || source;

const preloadFrame = (url: string, signal?: AbortSignal): Promise<boolean> => new Promise((resolve) => {
  if (signal?.aborted) {
    resolve(false);
    return;
  }
  const image = new Image();
  const finish = (loaded: boolean) => {
    image.onload = null;
    image.onerror = null;
    signal?.removeEventListener('abort', abort);
    resolve(loaded);
  };
  const abort = () => {
    image.src = '';
    finish(false);
  };
  image.onload = () => finish(true);
  image.onerror = () => finish(false);
  signal?.addEventListener('abort', abort, { once: true });
  image.src = url;
});

interface Spin360Props {
  images: Asset[];
  posterImageUrl: string;
  language: 'FR' | 'EN';
}

export const Spin360: React.FC<Spin360Props> = ({
  images,
  posterImageUrl,
  language
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loadedImages, setLoadedImages] = useState<Record<number, boolean>>({});
  const [isPreloading, setIsPreloading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragIndexStart, setDragIndexStart] = useState<number>(0);
  const [attempt, setAttempt] = useState(0);
  const [decoded, setDecoded] = useState<{ key: string; status: 'ready' | 'error' }>({ key: '', status: 'ready' });
  const boundedIndex = Math.min(currentIndex, Math.max(0, images.length - 1));
  const currentImage = images[boundedIndex];
  const source = useMediaSource(currentImage || { url: posterImageUrl });
  const imageSignature = images.map((asset) => `${asset.id}:${asset.cartularyId || ''}:${asset.binaryId || ''}:${asset.publicStoragePath || ''}:${asset.publicContentHash || ''}:${asset.url}`).join('|');
  const frameKey = `${imageSignature}:${boundedIndex}:${source.url || ''}:${attempt}`;
  const currentFrame = useRef(frameKey); currentFrame.current = frameKey;
  const decodeFailed = decoded.key === frameKey && decoded.status === 'error';
  const frameReady = decoded.key === frameKey && decoded.status === 'ready';
  const frameLabel = `${language === 'FR' ? 'Vue' : 'View'} ${images.length ? boundedIndex + 1 : 0}/${images.length}${currentImage?.name ? ` · ${currentImage.name}` : ''}`;

  const containerRef = useRef<HTMLDivElement>(null);
  const autoPlayRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Détecter la préférence système de réduction de mouvement
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // Charge l'affiche et les angles adjacents en priorité, avec une concurrence
  // bornée pour préserver la bande passante du reste de la page.
  useEffect(() => {
    setLoadedImages({});
    if (images.length === 0 || images.every((asset) => asset.publicStoragePath && !usableMediaUrl(asset.url))) {
      setIsPreloading(false);
      return undefined;
    }

    setIsPreloading(true);
    const controller = new AbortController();
    const preloadOrder = alternatingFrameOrder(images.length);
    void runBoundedPreloadQueue({
      items: preloadOrder,
      concurrency: MAXIMUM_CONCURRENT_SPIN_PRELOADS,
      signal: controller.signal,
      load: async (frameIndex, _queueIndex, signal) => {
        const asset = images[frameIndex];
        const direct = usableMediaUrl(asset.url);
        let loaded = false;
        try {
          if (direct) loaded = await preloadFrame(spinPresentationUrl(direct), signal);
          else if (asset.binaryId) {
            const { acquirePrivateMediaObjectUrl } = await import('../services/privateMedia.ts');
            const lease = await acquirePrivateMediaObjectUrl(asset.binaryId, asset.cartularyId);
            try { loaded = await preloadFrame(lease.url, signal); } finally { lease.release(); }
          }
        } catch { /* The displayed frame exposes its own retriable resolution error. */ }
        if (loaded && !signal?.aborted) setLoadedImages((previous) => ({ ...previous, [frameIndex]: true }));
      },
    }).then(() => {
      if (!controller.signal.aborted) setIsPreloading(false);
    });

    return () => controller.abort();
  // Content identity avoids restarting downloads on unrelated parent renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageSignature]);

  // Gestion de la lecture automatique (sauf si "mouvement réduit" activé)
  useEffect(() => {
    if (isPlaying && !prefersReducedMotion && images.length > 1 && !source.loading && frameReady) {
      autoPlayRef.current = setInterval(() => {
        setCurrentIndex((prev) => (prev + 1) % images.length);
      }, 150); // 150ms par image
    } else {
      if (autoPlayRef.current) {
        clearInterval(autoPlayRef.current);
      }
    }

    return () => {
      if (autoPlayRef.current) clearInterval(autoPlayRef.current);
    };
  }, [isPlaying, images.length, prefersReducedMotion, source.loading, frameReady]);

  // Arrêter l'autoplay si l'utilisateur interagit
  const stopAutoPlay = () => {
    setIsPlaying(false);
  };

  // Interactions souris & tactile (Glisser-déposer / Balayage)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (images.length <= 1) return;
    stopAutoPlay();
    setDragStart(e.clientX);
    setDragIndexStart(boundedIndex);
    e.preventDefault();
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (images.length <= 1 || dragStart === null) return;
    const diffX = e.clientX - dragStart;
    // Un pas de rotation tous les 15px de déplacement horizontal
    const sensitivity = 15;
    const step = Math.floor(diffX / sensitivity);

    // Calculer le nouvel index (inverser la direction pour une sensation naturelle)
    let nextIndex = (dragIndexStart - step) % images.length;
    if (nextIndex < 0) nextIndex += images.length;

    setCurrentIndex(nextIndex);
  };

  const handleMouseUpOrLeave = () => {
    setDragStart(null);
  };

  // Tactile
  const handleTouchStart = (e: React.TouchEvent) => {
    if (images.length <= 1) return;
    stopAutoPlay();
    if (e.touches.length > 0) {
      setDragStart(e.touches[0].clientX);
      setDragIndexStart(boundedIndex);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (images.length <= 1 || dragStart === null || e.touches.length === 0) return;
    const diffX = e.touches[0].clientX - dragStart;
    const sensitivity = 12; // Plus sensible sur mobile
    const step = Math.floor(diffX / sensitivity);

    let nextIndex = (dragIndexStart - step) % images.length;
    if (nextIndex < 0) nextIndex += images.length;

    setCurrentIndex(nextIndex);
  };

  const handleTouchEnd = () => {
    setDragStart(null);
  };

  // Interaction clavier (Accessibilité flèches gauche/droite)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (images.length <= 1) return;
    stopAutoPlay();
    if (e.key === 'ArrowLeft') {
      setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      setCurrentIndex((prev) => (prev + 1) % images.length);
      e.preventDefault();
    }
  };

  // Calcul du pourcentage de chargement
  const loadPercentage = Math.round(
    (Object.keys(loadedImages).length / (images.length || 1)) * 100
  );

  return (
    <div
      ref={containerRef}
      onKeyDown={handleKeyDown}
      tabIndex={0} // Rendre focusable pour le clavier
      aria-label={language === 'FR' ? "Visualiseur 3D de l’objet" : "Object 3D viewer"}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
        backgroundColor: 'var(--sheet)',
        border: '1px solid var(--rule)',
        padding: 'var(--s4)',
        outline: 'none',
      }}
    >
      {/* Zone de visualisation d'image */}
      <div
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUpOrLeave}
        onMouseLeave={handleMouseUpOrLeave}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          width: '100%',
          maxWidth: '450px',
          aspectRatio: '4/5',
          position: 'relative',
          cursor: dragStart !== null ? 'grabbing' : 'grab',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: '#FFFFFF',
          overflow: 'hidden'
        }}
      >
        {/* Affiche de repli ou image actuelle */}
        <img
          key={frameKey}
          src={source.url ? spinPresentationUrl(source.url) : undefined}
          alt={frameLabel}
          onLoad={() => { if (currentFrame.current === frameKey) setDecoded({ key: frameKey, status: 'ready' }); }}
          onError={() => { if (currentFrame.current === frameKey) { setDecoded({ key: frameKey, status: 'error' }); setIsPlaying(false); } }}
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            userSelect: 'none',
            // Saturation 0.72 / Contraste 1.04 requis par le design system (C07)
            filter: 'none',
          }}
        />

        {!source.error && !decodeFailed && (source.loading || (source.url && !frameReady)) && <p role="status" className="spin-current-loading">{language === 'FR' ? 'Chargement de cette vue…' : 'Loading this view…'}</p>}
        {(source.error || decodeFailed) && <div role="status" className="media-load-error"><p>{source.errorKind ? mediaFailureMessage(source.errorKind, language) : language === 'FR' ? 'Cette image ne peut pas être affichée. Réessayez cette vue ou choisissez une autre vue.' : 'This image cannot be displayed. Retry this view or choose another view.'}</p><button type="button" onClick={() => { setAttempt((value) => value + 1); source.retry(); }}>{language === 'FR' ? 'Réessayer cette vue' : 'Retry this view'}</button></div>}
        {/* Overlay d'aide temporaire au survol */}
        <div style={{
          position: 'absolute',
          bottom: '10px',
          right: '10px',
          backgroundColor: 'rgba(26, 24, 21, 0.75)',
          color: 'var(--paper)',
          padding: '4px 8px',
          fontFamily: 'var(--font-mono)',
          fontSize: '9px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          pointerEvents: 'none'
        }}>
          <RotateCw size={10} />
          <span>{language === 'FR' ? 'GLISSER POUR TOURNER' : 'DRAG TO ROTATE'}</span>
        </div>

        {/* Indicateur d'angle */}
        <div style={{
          position: 'absolute',
          top: '10px',
          left: '10px',
          backgroundColor: 'rgba(244, 242, 237, 0.85)',
          border: '1px solid var(--rule)',
          color: 'var(--ink)',
          padding: '4px 8px',
          fontFamily: 'var(--font-mono)',
          fontSize: '10px',
          fontWeight: 600
        }}>
          {language === 'FR' ? 'Vue' : 'View'} {images.length ? boundedIndex + 1 : 0}/{images.length}
        </div>

        {/* Indicateur de chargement progressif */}
        {isPreloading && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '4px',
            backgroundColor: 'var(--fill)',
          }}>
            <div style={{
              width: `${loadPercentage}%`,
              height: '100%',
              backgroundColor: 'var(--mark)',
              transition: 'width 200ms ease'
            }} />
          </div>
        )}
      </div>

      {/* Barre d'outils et de contrôles (C05 / Accessibilité) */}
      <div style={{
        width: '100%',
        marginTop: 'var(--s3)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 'var(--s2)',
        borderTop: '1px solid var(--rule)',
        paddingTop: 'var(--s3)',
      }}>
        {/* Légende & Statut */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            fontWeight: 700,
            textTransform: 'uppercase',
            color: 'var(--ink)'
          }}>
            {language === 'FR' ? 'PLATEAU TOURNANT 3D' : '3D SPINSET'}
          </span>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '9px',
            color: 'var(--muted)'
          }}>
            {images.length} {language === 'FR' ? 'vues · espacement des angles non renseigné' : 'views · angle spacing not specified'}
          </span>
        </div>

        {/* Boutons d'action (C05: min 44px sur mobile, design simple contour) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
          {/* Bouton Gauche */}
          <button
            type="button"
            disabled={images.length <= 1}
            onClick={() => {
              stopAutoPlay();
              setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
            }}
            aria-label={language === 'FR' ? "Angle précédent" : "Previous angle"}
            style={{
              width: '44px',
              height: '44px',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              border: '1px solid var(--rule)',
              cursor: 'pointer',
              color: 'var(--ink)',
              backgroundColor: 'transparent',
              transition: 'var(--transition)'
            }}
            onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--ink)'}
            onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--rule)'}
          >
            <ChevronLeft size={16} />
          </button>

          {/* Bouton Play/Pause (Désactivé si reduced motion) */}
          {!prefersReducedMotion && (
            <button
              type="button"
              disabled={images.length <= 1}
              onClick={() => setIsPlaying(!isPlaying)}
              aria-label={isPlaying ? (language === 'FR' ? "Pause rotation automatique" : "Pause auto-rotation") : (language === 'FR' ? "Lancer rotation automatique" : "Start auto-rotation")}
              style={{
                width: '44px',
                height: '44px',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                border: '1px solid var(--rule)',
                cursor: 'pointer',
                color: 'var(--ink)',
                backgroundColor: 'transparent',
                transition: 'var(--transition)'
              }}
              onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--ink)'}
              onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--rule)'}
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
            </button>
          )}

          {/* Bouton Droite */}
          <button
            type="button"
            disabled={images.length <= 1}
            onClick={() => {
              stopAutoPlay();
              setCurrentIndex((prev) => (prev + 1) % images.length);
            }}
            aria-label={language === 'FR' ? "Angle suivant" : "Next angle"}
            style={{
              width: '44px',
              height: '44px',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              border: '1px solid var(--rule)',
              cursor: 'pointer',
              color: 'var(--ink)',
              backgroundColor: 'transparent',
              transition: 'var(--transition)'
            }}
            onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--ink)'}
            onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--rule)'}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};
