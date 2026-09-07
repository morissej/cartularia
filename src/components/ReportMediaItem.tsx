import { FileText, Video } from 'lucide-react';
import type { Asset } from '../types';
import { PrivateMediaImage } from './PrivateMediaImage';

/** A report reproduces images, but only indexes files it cannot print. */
export function ReportMediaItem({ asset, language = 'FR' }: { asset: Asset; language?: 'FR' | 'EN' }) {
  const video = asset.type === 'video';
  return <figure className="report-slideshow-gallery__item">
    {asset.type === 'image'
      ? <PrivateMediaImage asset={asset} alt={asset.name} sizes="(max-width: 720px) 100vw, 450px" eager language={language} />
      : <div className="report-media-notice">
        {video ? <Video size={28} aria-hidden="true" /> : <FileText size={28} aria-hidden="true" />}
        <p>{language === 'FR'
          ? video ? 'Vidéo jointe — séquence non reproduite dans le rapport imprimé.' : 'Document joint — contenu non reproduit dans cette synthèse. Consultez le fichier dans le Cartulaire.'
          : video ? 'Attached video — sequence not reproduced in the printed report.' : 'Attached document — content not reproduced in this summary. Open the file in the record.'}</p>
      </div>}
    <figcaption className="report-slideshow-gallery__label">{asset.name}</figcaption>
  </figure>;
}
