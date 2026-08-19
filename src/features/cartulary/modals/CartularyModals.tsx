import { lazy, Suspense } from 'react';
import type { RefObject } from 'react';
import { ArrowLeft, ArrowRight, FileText, Plus, Trash2, Video, X } from 'lucide-react';
import { aiFieldProps } from '../../../ai/fieldCatalog.ts';
import { PrivateMediaImage } from '../../../components/PrivateMediaImage.tsx';
import { presentationDerivativeUrl } from '../../../media/presentationDerivatives.ts';
import type { Asset, MediaTag, Valuation } from '../../../types/index.ts';
import type { InterfaceLanguage } from '../../../utils/interfaceState.ts';
import { formatDateTime } from '../../../utils/formatting.ts';

const Spin360 = lazy(() => import('../../../components/Spin360.tsx').then((module) => ({ default: module.Spin360 })));

export interface UndoNotice {
  id: string;
  message: string;
  onUndo: () => void | Promise<void>;
  onExpire?: () => void | Promise<void>;
}

export interface PendingDeletion {
  title: string;
  description: string;
  targetLabel: string;
  onConfirm: () => UndoNotice | Promise<UndoNotice>;
}

const translated = (language: InterfaceLanguage, french: string, english: string) => language === 'FR' ? french : english;

export function SpinViewerModal({
  assets,
  language,
  dialogRef,
  onClose,
}: {
  assets: Asset[];
  language: InterfaceLanguage;
  dialogRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  if (assets.length === 0) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={dialogRef} className="modal-content modal-content--spin" role="dialog" aria-modal="true" aria-labelledby="spin-dialog-title" data-focus-layer="true" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><span className="eyebrow">03 · {translated(language, 'Séquence 3D', '3D sequence')}</span><strong id="spin-dialog-title">{translated(language, 'Revue à 360°', '360° review')}</strong></div>
          <button type="button" onClick={onClose} aria-label={translated(language, 'Fermer', 'Close')}><X size={18} /></button>
        </div>
        <Suspense fallback={<div className="media-empty" role="status">{translated(language, 'Chargement de la séquence 360°…', 'Loading 360° sequence…')}</div>}>
          <Spin360 images={assets} posterImageUrl={assets[0].url} language={language} />
        </Suspense>
      </div>
    </div>
  );
}

export function MediaViewerModal({
  asset,
  assetCount,
  position,
  audience,
  language,
  mediaTags,
  dialogRef,
  onClose,
  onMove,
  onToggleTag,
  onDelete,
}: {
  asset: Asset;
  assetCount: number;
  position: number;
  audience: string;
  language: InterfaceLanguage;
  mediaTags: Array<{ id: MediaTag; label: string }>;
  dialogRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onMove: (direction: -1 | 1) => void;
  onToggleTag: (assetId: string, tag: MediaTag) => void;
  onDelete: (assetId: string) => void;
}) {
  const tx = (french: string, english: string) => translated(language, french, english);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={dialogRef} className="media-modal" role="dialog" aria-modal="true" aria-labelledby="media-dialog-title" data-focus-layer="true" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <button type="button" className="media-modal__close" onClick={onClose} aria-label={tx('Fermer', 'Close')}><X size={18} /></button>
        <div className="media-modal__visual">
          {assetCount > 1 && <>
            <button type="button" className="media-modal__arrow media-modal__arrow--previous" onClick={() => onMove(-1)} aria-label={tx('Média précédent', 'Previous media')}><ArrowLeft size={20} /></button>
            <button type="button" className="media-modal__arrow media-modal__arrow--next" onClick={() => onMove(1)} aria-label={tx('Média suivant', 'Next media')}><ArrowRight size={20} /></button>
          </>}
          {asset.type === 'document' ? (
            <div className="media-modal__document">
              <FileText size={56} />
              <strong>{asset.originalFileName || asset.name}</strong>
              <small>{asset.mimeType || 'Document'} · {asset.fileSize || tx('taille non renseignée', 'size not provided')}</small>
              {asset.mimeType === 'application/pdf' && <a href={asset.url} target="_blank" rel="noreferrer">{tx('Ouvrir le PDF', 'Open PDF')}</a>}
            </div>
          ) : asset.type === 'video' ? (
            <video src={asset.url} poster={presentationDerivativeUrl(asset.posterUrl || asset.thumbnailUrl, 768)} controls preload="metadata">
              {tx('Votre navigateur ne peut pas lire cette vidéo.', 'Your browser cannot play this video.')}
            </video>
          ) : <PrivateMediaImage asset={asset} alt={asset.name} sizes="(max-width: 720px) 100vw, 70vw" eager />}
        </div>
        <div className="media-modal__caption">
          <div>
            <span className="eyebrow">{asset.type === 'video' ? tx('Vidéo indexée', 'Indexed video') : asset.type === 'document' ? tx('Document indexé', 'Indexed document') : tx('Photographie indexée', 'Indexed photograph')}</span>
            <h2 id="media-dialog-title" {...aiFieldProps('media.assets[].name', asset.id)}>{asset.name}</h2>
            {position >= 0 && <span className="media-modal__position" aria-live="polite">{position + 1} / {assetCount}</span>}
          </div>
          <fieldset className="media-tag-editor">
            <legend>{tx('Catégories', 'Categories')}</legend>
            {mediaTags.map((tag) => (
              <button
                type="button"
                key={tag.id}
                {...aiFieldProps('media.assets[].tags', `${asset.id}:${tag.id}`)}
                className={asset.tags.includes(tag.id) ? 'is-active' : ''}
                onClick={() => onToggleTag(asset.id, tag.id)}
                disabled={audience !== 'Secret'}
                aria-pressed={asset.tags.includes(tag.id)}
              >{tag.label}</button>
            ))}
          </fieldset>
          <dl>
            <div><dt>{tx('Horodatage', 'Timestamp')}</dt><dd {...aiFieldProps('media.assets[].metadataTimestamp', asset.id)}>{asset.metadataTimestamp ? formatDateTime(asset.metadataTimestamp) : '—'}</dd></div>
            <div><dt>Source</dt><dd>{asset.timestampSource === 'file.lastModified' ? tx('Métadonnée du fichier', 'File metadata') : tx('Métadonnée du catalogue', 'Catalogue metadata')}</dd></div>
            <div><dt>{tx('Visibilité', 'Visibility')}</dt><dd>{asset.visibility}</dd></div>
            <div><dt>Format</dt><dd>{asset.mimeType || asset.type}</dd></div>
            <div><dt>{tx('Empreinte', 'Digest')}</dt><dd {...aiFieldProps('media.assets[].hash', asset.id)}>{asset.hash.slice(0, 16)}…</dd></div>
            {asset.type === 'video' && <div><dt>Original</dt><dd>{asset.duration} · {asset.fileSize}</dd></div>}
          </dl>
          {asset.type === 'video' && <small className="vault-note"><Video size={14} /> {tx('Original haute définition conservé dans le coffre média.', 'High-definition original kept in the media vault.')}</small>}
          <button type="button" className="button button--quiet no-print" onClick={() => onDelete(asset.id)}><Trash2 size={14} /> {tx('Supprimer ce fichier', 'Delete this file')}</button>
        </div>
      </div>
    </div>
  );
}

export function MarketHistoryDialog({
  values,
  language,
  dialogRef,
  onClose,
  onAdd,
  onUpdate,
  onDelete,
}: {
  values: Valuation[];
  language: InterfaceLanguage;
  dialogRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<Valuation>) => void;
  onDelete: (valuation: Valuation) => void;
}) {
  const tx = (french: string, english: string) => translated(language, french, english);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={dialogRef} className="modal-content modal-content--market-history" role="dialog" aria-modal="true" aria-labelledby="market-history-dialog-title" data-focus-layer="true" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><span className="eyebrow">04 · {tx('Valorisation', 'Valuation')}</span><strong id="market-history-dialog-title">{tx('Évolution du marché', 'Market trend')}</strong></div>
          <button type="button" onClick={onClose} aria-label={tx('Fermer l’éditeur de l’évolution du marché', 'Close the market trend editor')}><X size={18} /></button>
        </div>
        <div className="market-history-dialog__body">
          <div className="market-history-dialog__intro">
            <div><h3>{tx('Évaluations datées', 'Dated valuations')}</h3><p>{tx('Ajoutez ou modifiez les bornes et la source de chaque point du graphique.', 'Add or edit the bounds and source for each point on the chart.')}</p></div>
            <button type="button" className="button button--primary" onClick={onAdd}><Plus size={14} /> {tx('Ajouter une ligne', 'Add row')}</button>
          </div>
          <div className="market-history-editor" role="table" aria-label={tx('Saisie manuelle de l’évolution du marché', 'Manual market trend entry')}>
            <div className="market-history-editor__head" role="row"><span>Date</span><span>{tx('Basse', 'Low')}</span><span>{tx('Médiane', 'Median')}</span><span>{tx('Haute', 'High')}</span><span>Source</span><span /></div>
            {values.map((valuation) => (
              <div role="row" key={`editor-${valuation.id}`} data-ai-scope="value.market.valuations[]" data-ai-instance={valuation.id}>
                <input {...aiFieldProps('value.market.valuations[].date', valuation.id)} type="date" value={valuation.date} onChange={(event) => onUpdate(valuation.id, { date: event.target.value })} aria-label={tx('Date de valorisation', 'Valuation date')} />
                <input {...aiFieldProps('value.market.valuations[].lowValue', valuation.id)} type="number" min="0" step="100" value={valuation.lowValue} onChange={(event) => onUpdate(valuation.id, { lowValue: Math.max(0, Number(event.target.value)) })} aria-label={tx('Valeur basse', 'Low value')} />
                <input {...aiFieldProps('value.market.valuations[].midValue', valuation.id)} type="number" min="0" step="100" value={valuation.midValue} onChange={(event) => onUpdate(valuation.id, { midValue: Math.max(0, Number(event.target.value)) })} aria-label={tx('Valeur médiane', 'Median value')} />
                <input {...aiFieldProps('value.market.valuations[].highValue', valuation.id)} type="number" min="0" step="100" value={valuation.highValue} onChange={(event) => onUpdate(valuation.id, { highValue: Math.max(0, Number(event.target.value)) })} aria-label={tx('Valeur haute', 'High value')} />
                <input {...aiFieldProps('value.market.valuations[].source', valuation.id)} type="text" value={valuation.source} onChange={(event) => onUpdate(valuation.id, { source: event.target.value })} aria-label={tx('Source de la valorisation', 'Valuation source')} />
                <button type="button" className="icon-button" onClick={() => onDelete(valuation)} aria-label={tx('Supprimer l’évaluation', 'Delete valuation')}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DeletionDialog({
  deletion,
  error,
  submitting,
  language,
  dialogRef,
  onCancel,
  onConfirm,
}: {
  deletion: PendingDeletion;
  error: string | null;
  submitting: boolean;
  language: InterfaceLanguage;
  dialogRef: RefObject<HTMLDivElement | null>;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const tx = (french: string, english: string) => translated(language, french, english);
  return (
    <div className="modal-overlay" onClick={() => { if (!submitting) onCancel(); }}>
      <div ref={dialogRef} className="modal-content modal-content--deletion" role="alertdialog" aria-modal="true" aria-labelledby="deletion-dialog-title" aria-describedby="deletion-dialog-description" data-focus-layer="true" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><span className="eyebrow">{tx('Action destructive', 'Destructive action')}</span><strong id="deletion-dialog-title">{deletion.title}</strong></div>
          <button type="button" onClick={onCancel} disabled={submitting} aria-label={tx('Annuler et fermer', 'Cancel and close')}><X size={18} /></button>
        </div>
        <div className="deletion-dialog__body">
          <strong>{deletion.targetLabel}</strong>
          <p id="deletion-dialog-description">{deletion.description}</p>
          {error && <p className="deletion-dialog__error" role="alert">{error}</p>}
          <div className="deletion-dialog__actions">
            <button type="button" className="button button--quiet" onClick={onCancel} disabled={submitting}>{tx('Conserver', 'Keep')}</button>
            <button type="button" className="button button--danger" onClick={() => void onConfirm()} disabled={submitting}>
              {submitting ? tx('Suppression…', 'Deleting…') : tx('Confirmer la suppression', 'Confirm deletion')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function UndoToast({ notice, language, onUndo, onDismiss }: {
  notice: UndoNotice;
  language: InterfaceLanguage;
  onUndo: () => void | Promise<void>;
  onDismiss: () => void | Promise<void>;
}) {
  const tx = (french: string, english: string) => translated(language, french, english);
  return (
    <div className="undo-toast no-print" role="status" aria-live="assertive" aria-atomic="true">
      <p>{notice.message}</p>
      <button type="button" onClick={() => void onUndo()}>{tx('Annuler la suppression', 'Undo deletion')}</button>
      <button type="button" className="undo-toast__dismiss" onClick={() => void onDismiss()} aria-label={tx('Fermer la notification', 'Dismiss notification')}><X size={15} /></button>
    </div>
  );
}
