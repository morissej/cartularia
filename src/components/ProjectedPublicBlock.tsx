import type { PreviewBlockProjection, PreviewDerivativeProjection } from '../domain/websiteDraft';
import { PrivateMediaImage } from './PrivateMediaImage.tsx';
import { MediaDownloadLink } from './MediaDownloadLink.tsx';
import { useRef, useState } from 'react';
import type { Asset } from '../types';
import { MediaVideo } from './MediaVideo';
import { MediaCarousel } from './MediaCarousel';
import { SpinSequence } from './SpinSequence.tsx';
import { MediaViewerModal } from '../features/cartulary/modals/CartularyModals';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { validPublicMediaPath } from '../utils/publicMediaReference';

interface ProjectedPublicBlockProps {
  /** Projection publiée (PublicBlockProjection, assignable : `localPreview` optionnel) ou aperçu local (websiteDraftPreview). */
  block: PreviewBlockProjection;
  language?: 'FR' | 'EN';
  preview?: boolean;
}

const textList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const recordList = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    : [];

export const ProjectedPublicBlock = ({ block, language = 'FR', preview = false }: ProjectedPublicBlockProps) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(Boolean(selectedId), dialogRef, () => setSelectedId(null));
  const payload = block.payload || {};
  const eyebrow = preview ? (language === 'FR' ? 'Aperçu local · non publié' : 'Local preview · not published') : typeof payload.eyebrow === 'string' ? payload.eyebrow : (language === 'FR' ? 'Contenu publié' : 'Published content');
  const heading = typeof payload.heading === 'string' ? payload.heading : block.title;
  const paragraphs = textList(payload.paragraphs);
  const facts = recordList(payload.facts);
  const groups = recordList(payload.groups);
  const mediaLabels = textList(payload.mediaLabels);
  // Aperçu local (V4 point 1) : la source privée d'un média téléversé n'est lue que sous `preview` ; la page publiée l'ignore.
  // PrivateMediaImage la résout par ses variantes de présentation (rôles thumbnail/stage), jamais par l'original.
  const localSourceOf = (asset: PreviewDerivativeProjection) => (preview ? asset.localPreview : undefined);
  const resolvable = (asset: PreviewDerivativeProjection) => Boolean(asset.downloadUrl || validPublicMediaPath(asset.storagePath) || localSourceOf(asset));
  const assets: Asset[] = [...new Map(block.assets.flatMap((asset, index) => resolvable(asset) ? [{
    id: `${asset.assetId}:${asset.derivativeId}`, name: mediaLabels[index] || `${block.title} · ${index + 1}`,
    type: asset.mediaKind === 'video' ? 'video' as const : asset.mediaKind === 'document' ? 'document' as const : 'image' as const,
    url: asset.downloadUrl || '', publicStoragePath: validPublicMediaPath(asset.storagePath) ? asset.storagePath : undefined, publicContentHash: asset.contentHash,
    binaryId: localSourceOf(asset)?.binaryId, cartularyId: localSourceOf(asset)?.cartularyId, privatePresentation: localSourceOf(asset)?.privatePresentation,
    mimeType: asset.mimeType, tags: [], status: 'Archived' as const, visibility: 'Tous' as const, hash: asset.contentHash,
  }] : []).map((asset) => [asset.id, asset])).values()];
  // Aperçu d'un binaire privé (V4 G1) : la copie publique n'existe pas encore ; l'original du propriétaire n'est jamais
  // offert à sa place — ni lien de téléchargement, ni visionneuse, ni lecteur vidéo : une phrase d'état.
  const privateInPreview = (asset: Asset) => preview && Boolean(asset.binaryId);
  const downloadLink = (asset: Asset, showName = false) => privateInPreview(asset) ? null : <MediaDownloadLink media={asset} language={language} compact showName={showName} />;
  const previewNote = language === 'FR' ? 'Téléchargement et lecture disponibles sur la page publiée, depuis la copie vérifiée par le serveur.' : 'Download and playback available on the published page, from the server-verified copy.';
  const downloadableAssets = assets.filter((asset) => !privateInPreview(asset));
  const heroAsset = assets.find((asset) => asset.type === 'image');
  const selected = assets.find((asset) => asset.id === selectedId);
  const selectedIndex = selected ? assets.indexOf(selected) : 0;
  const isInteractive = ['media-motion', 'media-spin', 'media-slideshow', 'media-library'].includes(block.blockId);

  return (
    <section className={`projected-public-block${isInteractive ? ' projected-public-block--interactive' : ''}`} data-public-block={block.blockId}>
      {!isInteractive && heroAsset && (
        <figure className="projected-public-block__media">
          <PrivateMediaImage asset={heroAsset} alt={heading} language={language} sizes="(max-width: 720px) 100vw, 50vw" loading="lazy" decoding="async" role="stage" />
          <figcaption>{downloadLink(heroAsset)}</figcaption>
        </figure>
      )}
      <div className="projected-public-block__content">
        <span className="eyebrow">{eyebrow}</span>
        <h2>{heading}</h2>
        {block.blockId === 'media-motion' && assets.filter((asset) => asset.type === 'video' && !privateInPreview(asset)).map((asset) => <div key={asset.id}><MediaVideo asset={asset} language={language} />{downloadLink(asset)}</div>)}
        {block.blockId === 'media-spin' && assets.some((asset) => asset.type === 'image') && <SpinSequence images={assets.filter((asset) => asset.type === 'image')} language={language} />}
        {block.blockId === 'media-slideshow' && <MediaCarousel assets={assets} language={language} downloads={!preview} onOpen={(asset) => { if (!privateInPreview(asset)) setSelectedId(asset.id); }} />}
        {block.blockId === 'media-library' && <div className="media-library public-media-library">{assets.map((asset) => <article key={asset.id}><button type="button" disabled={privateInPreview(asset)} title={privateInPreview(asset) ? previewNote : undefined} onClick={() => setSelectedId(asset.id)}>{asset.type === 'image' && <PrivateMediaImage asset={asset} language={language} alt="" sizes="240px" role="thumbnail" />}<strong>{asset.name}</strong><small>{asset.mimeType || asset.type}</small></button>{downloadLink(asset)}</article>)}</div>}
        {block.blockId === 'media-spin' && downloadableAssets.length > 0 && <details className="public-media-downloads"><summary>{language === 'FR' ? `Télécharger les vues (${downloadableAssets.length})` : `Download views (${downloadableAssets.length})`}</summary>{downloadableAssets.map((asset, index) => <div key={asset.id} className="spin-downloads__row"><span>{language === 'FR' ? 'Vue' : 'View'} {index + 1}/{downloadableAssets.length}</span>{downloadLink(asset, true)}</div>)}</details>}
        {assets.some(privateInPreview) && <p role="status" className="media-load-prompt">{previewNote}</p>}
        {block.assets.some((asset) => !resolvable(asset)) && <p role="status">{preview
          ? (language === 'FR' ? 'Un média sélectionné n’est pas encore enregistré dans le dossier : le serveur refusera la publication tant qu’il ne l’est pas.' : 'A selected media is not yet saved in the record: the server will refuse publication until it is.')
          : (language === 'FR' ? 'Une référence de copie publique est absente. Les originaux restent privés ; le propriétaire doit vérifier cette publication.' : 'A public copy reference is missing. Originals remain private; the owner needs to check this publication.')}</p>}
        {paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        {recordList(payload.resources).filter((item) => typeof item.url === 'string' && /^https?:\/\//i.test(item.url)).map((item, index) => <p key={`resource-${index}`}><a href={String(item.url)} target="_blank" rel="noreferrer">{String(item.name || 'Ressource')}</a></p>)}
        {facts.length > 0 && (
          <dl className="projected-public-block__facts">
            {facts.map((fact, index) => (
              <div key={index}>
                <dt>{String(fact.label ?? '')}</dt>
                <dd>{String(fact.value ?? '')}</dd>
              </div>
            ))}
          </dl>
        )}
        {groups.map((group, groupIndex) => (
          <article className="projected-public-block__group" key={groupIndex}>
            <h3>{String(group.title ?? '')}</h3>
            <dl>
              {recordList(group.items).map((item, itemIndex) => (
                <div key={itemIndex}>
                  <dt>{String(item.label ?? '')}</dt>
                  <dd>{String(item.value ?? '')}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
      {selected && <MediaViewerModal asset={selected} assetCount={assets.length} position={selectedIndex} audience="Tous" language={language} mediaTags={[]} dialogRef={dialogRef} onClose={() => setSelectedId(null)} onMove={(direction) => setSelectedId(assets[(selectedIndex + direction + assets.length) % assets.length].id)} onToggleTag={() => undefined} onDelete={() => undefined} readOnly originalOnDemand={!preview} />}
    </section>
  );
};
