import { lazy, Suspense, useState } from 'react';
import { RotateCw } from 'lucide-react';
import type { Asset } from '../types';
import { PrivateMediaImage } from './PrivateMediaImage.tsx';

// Frontière dynamique : le visualiseur (et son préchargement des vues) n'est chargé qu'à l'ouverture.
const Spin360 = lazy(() => import('./Spin360.tsx').then((module) => ({ default: module.Spin360 })));

interface SpinSequenceProps {
  images: Asset[];
  language: 'FR' | 'EN';
  eyebrow?: string;
}

/**
 * Séquence 360° en place : fermée, seule l'affiche (première vue, variante de présentation) est
 * rendue ; ouverte, le visualiseur charge les autres vues. Aucune vue n'est téléchargée avant le
 * clic (décision V3, G1). Indexée par contenu, jamais par objet ni par marque (ADR-026/028).
 */
export function SpinSequence({ images, language, eyebrow }: SpinSequenceProps) {
  const [opened, setOpened] = useState(false);
  const poster = images[0];
  if (!poster) return null;
  const tx = (french: string, english: string) => (language === 'FR' ? french : english);
  if (opened) {
    return (
      <div className="spin-sequence" data-spin-sequence="open">
        <Suspense fallback={<div className="media-empty" role="status">{tx('Chargement de la séquence 360°…', 'Loading 360° sequence…')}</div>}>
          <Spin360 images={images} posterImageUrl={poster.url} language={language} />
        </Suspense>
      </div>
    );
  }
  return (
    <button
      type="button"
      className="spin-callout"
      data-spin-sequence="closed"
      onClick={() => setOpened(true)}
      aria-label={tx(`Ouvrir la séquence 360° (${images.length} vues)`, `Open the 360° sequence (${images.length} views)`)}
    >
      <PrivateMediaImage asset={poster} alt={tx('Aperçu de la séquence 360°', '360° sequence preview')} sizes="(max-width: 720px) 100vw, 1200px" role="stage" language={language} />
      <span className="spin-callout__icon"><RotateCw size={23} /></span>
      <span>
        {eyebrow && <span className="eyebrow">{eyebrow} · </span>}
        <strong>{images.length} {tx('vues ordonnées', 'ordered views')}</strong> · {tx('Ouvrir la séquence', 'Open the sequence')}
      </span>
    </button>
  );
}
