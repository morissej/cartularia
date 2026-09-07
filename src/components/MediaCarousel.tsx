import { useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, Play } from 'lucide-react';
import type { Asset } from '../types';
import { horizontalNavigationDirection, targetConsumesHorizontalNavigation } from '../utils/horizontalNavigation.ts';
import { PrivateMediaImage } from './PrivateMediaImage.tsx';
import { PresentationImage } from './PresentationImage.tsx';
import { MediaDownloadLink } from './MediaDownloadLink.tsx';
import { MediaVideo } from './MediaVideo';

interface MediaCarouselProps {
  assets: Asset[];
  language: 'FR' | 'EN';
  eyebrow?: string;
  onOpen: (asset: Asset) => void;
  compact?: boolean;
}

export function MediaCarousel({
  assets,
  language,
  eyebrow,
  onOpen,
  compact = false,
}: MediaCarouselProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const currentIndex = Math.max(0, assets.findIndex((asset) => asset.id === selectedId));
  const move = (direction: -1 | 1) => {
    if (assets.length) setSelectedId(assets[(currentIndex + direction + assets.length) % assets.length].id);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const direction = horizontalNavigationDirection(event.key);
    if (!direction || targetConsumesHorizontalNavigation(event.target) || assets.length < 2) return;
    event.preventDefault();
    move(direction);
  };

  if (assets.length === 0) {
    return null;
  }

  const current = assets[currentIndex];
  const poster = current.posterUrl || current.thumbnailUrl || current.url;
  const timestamp = current.metadataTimestamp || current.capturedAt;
  const timestampDate = timestamp ? new Date(timestamp) : null;
  const formattedTimestamp = timestampDate && !Number.isNaN(timestampDate.getTime())
    ? new Intl.DateTimeFormat(language === 'FR' ? 'fr-FR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(timestampDate)
    : null;

  return (
    <section
      className={`media-carousel ${compact ? 'media-carousel--compact' : ''}`}
      aria-label={language === 'FR' ? 'Diaporama média' : 'Media slideshow'}
      aria-roledescription="carousel"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="media-carousel__stage">
        <button
          type="button"
          className="media-carousel__open"
          onClick={() => onOpen(current)}
          aria-label={language === 'FR' ? `Ouvrir ${current.name}` : `Open ${current.name}`}
        >
          {current.type === 'document' ? (
            <span className="media-carousel__document"><FileText size={52} /><strong>{current.originalFileName || current.name}</strong><small>{current.mimeType || 'Document'}</small></span>
          ) : current.type === 'video' ? (
            <MediaVideo asset={current} language={language} controls={false} muted />
          ) : (
            <PrivateMediaImage asset={current} sourceOverride={poster} alt={current.name} sizes="(max-width: 720px) 100vw, 900px" eager />
          )}
          {current.type === 'video' && (
            <span className="media-carousel__play" aria-hidden="true">
              <Play size={22} fill="currentColor" />
            </span>
          )}
        </button>

        {assets.length > 1 && (
          <>
            <button
              type="button"
              className="media-carousel__arrow media-carousel__arrow--left"
              onClick={() => move(-1)}
              aria-label={language === 'FR' ? 'Média précédent' : 'Previous media'}
            >
              <ChevronLeft size={20} />
            </button>
            <button
              type="button"
              className="media-carousel__arrow media-carousel__arrow--right"
              onClick={() => move(1)}
              aria-label={language === 'FR' ? 'Média suivant' : 'Next media'}
            >
              <ChevronRight size={20} />
            </button>
          </>
        )}
      </div>

      <div className="media-carousel__caption" aria-live="polite">
        <div>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h3>{current.name}</h3>
          <div className="media-carousel__tags">
            {current.tags.map((tag) => <span key={tag}>{({ 'main-photo': language === 'FR' ? 'Photo principale' : 'Main photo', 'main-video': language === 'FR' ? 'Vidéo principale' : 'Main video', 'spin-3d': '360°', slideshow: language === 'FR' ? 'Diaporama' : 'Slideshow', accessories: language === 'FR' ? 'Accessoires' : 'Accessories', documentation: 'Documentation', other: language === 'FR' ? 'Autre' : 'Other' })[tag]}</span>)}
          </div>
          {timestamp && (
            <time className="media-carousel__timestamp" dateTime={timestamp}>
              {formattedTimestamp ? `${language === 'FR' ? 'Date du média :' : 'Media date:'} ${formattedTimestamp}` : language === 'FR' ? 'Date à vérifier' : 'Date to verify'}
            </time>
          )}
        </div>
        <div className="media-carousel__actions">
          <MediaDownloadLink media={current} language={language} compact />
          <div className="media-carousel__count">
            <span>{String(currentIndex + 1).padStart(2, '0')}</span>
            <span>/</span>
            <span>{String(assets.length).padStart(2, '0')}</span>
          </div>
        </div>
      </div>

      {assets.length > 1 && (
        <div className="media-carousel__thumbs" aria-label={language === 'FR' ? 'Choisir un média' : 'Choose media'}>
          {assets.map((asset, index) => {
            const thumbnail = asset.posterUrl || asset.thumbnailUrl || asset.url;
            const videoPoster = asset.posterUrl || asset.thumbnailUrl;
            return (
              <button
                type="button"
                key={asset.id}
                className={index === currentIndex ? 'is-active' : ''}
                onClick={() => setSelectedId(asset.id)}
                aria-label={`${index + 1}. ${asset.name}`}
                aria-current={index === currentIndex ? 'true' : undefined}
              >
                {asset.type === 'document'
                  ? <FileText size={20} aria-hidden="true" />
                  : asset.type === 'video'
                    ? videoPoster
                      ? <PresentationImage src={videoPoster} alt="" sizes="70px" loading="lazy" decoding="async" />
                      : <span className="media-carousel__thumb-placeholder" aria-hidden="true" />
                    : <PrivateMediaImage asset={asset} sourceOverride={thumbnail} alt="" sizes="70px" />}
                {asset.type === 'video' && <Play size={11} fill="currentColor" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
