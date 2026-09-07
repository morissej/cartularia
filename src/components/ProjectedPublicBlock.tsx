import type { PublicBlockProjection } from '../domain/projections';
import { PrivateMediaImage } from './PrivateMediaImage.tsx';
import { MediaDownloadLink } from './MediaDownloadLink.tsx';
import { lazy, Suspense, useRef, useState } from 'react';
import type { Asset } from '../types';
import { MediaVideo } from './MediaVideo';
import { MediaCarousel } from './MediaCarousel';
import { MediaViewerModal } from '../features/cartulary/modals/CartularyModals';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { validPublicMediaPath } from '../utils/publicMediaReference';

const Spin360 = lazy(() => import('./Spin360').then((module) => ({ default: module.Spin360 })));

interface ProjectedPublicBlockProps {
  block: PublicBlockProjection;
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
  const assets: Asset[] = [...new Map(block.assets.flatMap((asset, index) => asset.downloadUrl || validPublicMediaPath(asset.storagePath) ? [{
    id: `${asset.assetId}:${asset.derivativeId}`, name: mediaLabels[index] || `${block.title} · ${index + 1}`,
    type: asset.mediaKind === 'video' ? 'video' as const : asset.mediaKind === 'document' ? 'document' as const : 'image' as const,
    url: asset.downloadUrl || '', publicStoragePath: validPublicMediaPath(asset.storagePath) ? asset.storagePath : undefined, publicContentHash: asset.contentHash,
    mimeType: asset.mimeType, tags: [], status: 'Archived' as const, visibility: 'Tous' as const, hash: asset.contentHash,
  }] : []).map((asset) => [asset.id, asset])).values()];
  const heroAsset = assets.find((asset) => asset.type === 'image');
  const selected = assets.find((asset) => asset.id === selectedId);
  const selectedIndex = selected ? assets.indexOf(selected) : 0;
  const isInteractive = ['media-motion', 'media-spin', 'media-slideshow', 'media-library'].includes(block.blockId);

  return (
    <section className={`projected-public-block${isInteractive ? ' projected-public-block--interactive' : ''}`} data-public-block={block.blockId}>
      {!isInteractive && heroAsset && (
        <figure className="projected-public-block__media">
          <PrivateMediaImage asset={heroAsset} alt={heading} language={language} sizes="(max-width: 720px) 100vw, 50vw" loading="lazy" decoding="async" />
          <figcaption><MediaDownloadLink media={heroAsset} language={language} compact /></figcaption>
        </figure>
      )}
      <div className="projected-public-block__content">
        <span className="eyebrow">{eyebrow}</span>
        <h2>{heading}</h2>
        {block.blockId === 'media-motion' && assets.filter((asset) => asset.type === 'video').map((asset) => <div key={asset.id}><MediaVideo asset={asset} language={language} /><MediaDownloadLink media={asset} language={language} compact /></div>)}
        {block.blockId === 'media-spin' && assets.some((asset) => asset.type === 'image') && <Suspense fallback={<p role="status">Chargement des vues…</p>}><Spin360 images={assets.filter((asset) => asset.type === 'image')} posterImageUrl={assets[0].url} language={language} /></Suspense>}
        {block.blockId === 'media-slideshow' && <MediaCarousel assets={assets} language={language} onOpen={(asset) => setSelectedId(asset.id)} />}
        {block.blockId === 'media-library' && <div className="media-library public-media-library">{assets.map((asset) => <article key={asset.id}><button type="button" onClick={() => setSelectedId(asset.id)}>{asset.type === 'image' && <PrivateMediaImage asset={asset} language={language} alt="" sizes="240px" />}<strong>{asset.name}</strong><small>{asset.mimeType || asset.type}</small></button><MediaDownloadLink media={asset} language={language} compact /></article>)}</div>}
        {block.blockId === 'media-spin' && assets.length > 0 && <details className="public-media-downloads"><summary>{language === 'FR' ? `Télécharger les vues (${assets.length})` : `Download views (${assets.length})`}</summary>{assets.map((asset, index) => <div key={asset.id} className="spin-downloads__row"><span>{language === 'FR' ? 'Vue' : 'View'} {index + 1}/{assets.length}</span><MediaDownloadLink media={asset} language={language} compact showName /></div>)}</details>}
        {block.assets.some((asset) => !asset.downloadUrl && !validPublicMediaPath(asset.storagePath)) && <p role="status">{language === 'FR' ? 'Une référence de copie publique est absente. Les originaux restent privés ; le propriétaire doit vérifier cette publication.' : 'A public copy reference is missing. Originals remain private; the owner needs to check this publication.'}</p>}
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
      {selected && <MediaViewerModal asset={selected} assetCount={assets.length} position={selectedIndex} audience="Tous" language={language} mediaTags={[]} dialogRef={dialogRef} onClose={() => setSelectedId(null)} onMove={(direction) => setSelectedId(assets[(selectedIndex + direction + assets.length) % assets.length].id)} onToggleTag={() => undefined} onDelete={() => undefined} readOnly />}
    </section>
  );
};
