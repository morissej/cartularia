import React, { useState, useEffect, useRef } from 'react';
import type { Asset } from '../types';
import { RotateCw, Play, Pause, ChevronLeft, ChevronRight } from 'lucide-react';
import { alternatingFrameOrder, runBoundedPreloadQueue } from '../utils/boundedPreloadQueue.ts';

const MAXIMUM_CONCURRENT_SPIN_PRELOADS = 2;

const spinPresentationUrl = (source: string) => {
  const path = source.split(/[?#]/, 1)[0];
  if (!path.startsWith('/assets/IWC/') || !path.toLowerCase().endsWith('.jpg')) return source;
  try {
    const filename = decodeURIComponent(path.slice('/assets/IWC/'.length));
    return `/assets/IWC/derivatives/${encodeURIComponent(filename.slice(0, -4))}.768.webp`;
  } catch {
    return source;
  }
};

const preloadFrame = (url: string, signal?: AbortSignal): Promise<void> => new Promise((resolve) => {
  if (signal?.aborted) {
    resolve();
    return;
  }
  const image = new Image();
  const finish = () => {
    image.onload = null;
    image.onerror = null;
    signal?.removeEventListener('abort', abort);
    resolve();
  };
  const abort = () => {
    image.src = '';
    finish();
  };
  image.onload = finish;
  image.onerror = finish;
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
    if (images.length === 0) {
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
      load: (frameIndex, _queueIndex, signal) => preloadFrame(spinPresentationUrl(images[frameIndex].url), signal),
      onSettled: (frameIndex) => {
        setLoadedImages((previous) => previous[frameIndex]
          ? previous
          : { ...previous, [frameIndex]: true });
      },
    }).then(() => {
      if (!controller.signal.aborted) setIsPreloading(false);
    });

    return () => controller.abort();
  }, [images]);

  // Gestion de la lecture automatique (sauf si "mouvement réduit" activé)
  useEffect(() => {
    if (isPlaying && !prefersReducedMotion) {
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
  }, [isPlaying, images.length, prefersReducedMotion]);

  // Arrêter l'autoplay si l'utilisateur interagit
  const stopAutoPlay = () => {
    setIsPlaying(false);
  };

  // Interactions souris & tactile (Glisser-déposer / Balayage)
  const handleMouseDown = (e: React.MouseEvent) => {
    stopAutoPlay();
    setDragStart(e.clientX);
    setDragIndexStart(currentIndex);
    e.preventDefault();
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (dragStart === null) return;
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
    stopAutoPlay();
    if (e.touches.length > 0) {
      setDragStart(e.touches[0].clientX);
      setDragIndexStart(currentIndex);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (dragStart === null || e.touches.length === 0) return;
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
          src={spinPresentationUrl(isPreloading && !loadedImages[currentIndex]
            ? posterImageUrl
            : images[currentIndex]?.url || posterImageUrl)}
          alt={language === 'FR' ? `Rendu 3D de l’objet sous un angle de ${Math.round(currentIndex * (360 / images.length))}°` : `3D object rendering at ${Math.round(currentIndex * (360 / images.length))}° angle`}
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            userSelect: 'none',
            // Saturation 0.72 / Contraste 1.04 requis par le design system (C07)
            filter: 'saturation(0.72) contrast(1.04)',
          }}
        />

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
          {Math.round(currentIndex * (360 / images.length))}°
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
            {images.length} {language === 'FR' ? 'images · incrément ~25°' : 'images · ~25° increment'}
          </span>
        </div>

        {/* Boutons d'action (C05: min 44px sur mobile, design simple contour) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
          {/* Bouton Gauche */}
          <button
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
