import { useState } from 'react';
import { FileText, Video } from 'lucide-react';
import type { Asset } from '../types';
import { PrivateMediaImage } from './PrivateMediaImage';

/**
 * Image imprimée d'un rapport (tour 4, point 3, compatible K4) : la scène est demandée par ses variantes ; si aucune
 * copie de présentation n'existe ('derivative-pending' / 'derivative-failed'), l'ORIGINAL est chargé — pendant la
 * préparation explicite du rapport seulement (ce composant n'est monté que sous `reportPreparation.active`, jamais dans
 * une page de lecture) — afin que le rapport reste imprimable comme avant V3. Toute autre panne reste une erreur honnête.
 */
export function ReportPrintImage({ asset, alt, sizes, language = 'FR' }: { asset: Asset; alt: string; sizes?: string; language?: 'FR' | 'EN' }) {
  // Décision mémorisée PAR BINAIRE : un changement d'actif repart de la scène sans jamais demander l'original du nouveau.
  const [originalFor, setOriginalFor] = useState<string | null>(null);
  const original = Boolean(asset.binaryId) && originalFor === asset.binaryId;
  return <PrivateMediaImage asset={asset} alt={alt} sizes={sizes} eager language={language} role={original ? 'original' : 'stage'} onDerivativeUnavailable={() => { setOriginalFor(asset.binaryId ?? null); return true; }} />;
}

/**
 * A report reproduces images, but only indexes files it cannot print. Mounted for printing only
 * (`forPrint`), never behind a hidden gallery: its eager loading would otherwise download every
 * slideshow image twice on the media page.
 */
export function ReportMediaItem({ asset, language = 'FR' }: { asset: Asset; language?: 'FR' | 'EN' }) {
  const video = asset.type === 'video';
  return <figure className="report-slideshow-gallery__item">
    {asset.type === 'image'
      ? <ReportPrintImage asset={asset} alt={asset.name} sizes="(max-width: 720px) 100vw, 450px" language={language} />
      : <div className="report-media-notice">
        {video ? <Video size={28} aria-hidden="true" /> : <FileText size={28} aria-hidden="true" />}
        <p>{language === 'FR'
          ? video ? 'Vidéo jointe — séquence non reproduite dans le rapport imprimé.' : 'Document joint — contenu non reproduit dans cette synthèse. Consultez le fichier dans le Cartulaire.'
          : video ? 'Attached video — sequence not reproduced in the printed report.' : 'Attached document — content not reproduced in this summary. Open the file in the record.'}</p>
      </div>}
    <figcaption className="report-slideshow-gallery__label">{asset.name}</figcaption>
  </figure>;
}
