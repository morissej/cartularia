import { Lock, Pencil, Play, Plus, Trash2, Video } from 'lucide-react';
import type { AIFieldId } from '../../../ai/fieldCatalog.ts';
import { aiFieldProps } from '../../../ai/fieldCatalog.ts';
import { PrivateMediaImage } from '../../../components/PrivateMediaImage.tsx';
import { AutoResizeTextarea } from '../../../components/AutoResizeTextarea.tsx';
import type { PublishedBlockId } from '../../../domain/publication.ts';
import type { Asset, ComparableTransaction } from '../../../types/index.ts';
import type { InterfaceLanguage } from '../../../utils/interfaceState.ts';
import { formatDate, formatMoney } from '../../../utils/formatting.ts';

export interface MarkerState {
  active: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

export interface PublicationMarkerState {
  active: boolean;
  pendingValidation: boolean;
  onToggle: (label: string) => void;
  disabled?: boolean;
}

export interface BlockMarkerState {
  blockId: PublishedBlockId;
  language: InterfaceLanguage;
  website: PublicationMarkerState;
  report: PublicationMarkerState;
  community: PublicationMarkerState;
  edit?: MarkerState;
}

export function PageIntroduction({ number, title }: { number: string; title: string }) {
  return <header className="page-intro"><span className="page-intro__number">{number}</span><h1>{title}</h1></header>;
}

export function BlockMarkers({ selection, label }: { selection: BlockMarkerState; label: string }) {
  if (!selection.edit) return null;
  return (
    <div className="content-markers">
      <button
        type="button"
        className={`content-marker content-marker--edit no-print ${selection.edit.active ? 'is-active' : ''}`}
        onClick={selection.edit.onToggle}
        disabled={selection.edit.disabled}
        aria-pressed={selection.edit.active}
        aria-label={`${selection.language === 'FR' ? (selection.edit.active ? 'Terminer la modification de' : 'Modifier') : (selection.edit.active ? 'Finish editing' : 'Edit')} ${label}`}
        title={selection.language === 'FR' ? 'Modifier le texte' : 'Edit text'}
      ><Pencil size={15} aria-hidden="true" /></button>
    </div>
  );
}

export function SectionTitle({ eyebrow, title, publish }: { eyebrow: string; title: string; publish?: BlockMarkerState }) {
  return <div className="section-title"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>{publish && <BlockMarkers selection={publish} label={title} />}</div>;
}

export function EditableParagraphs({
  values,
  editing,
  onChange,
  className,
  onActivate,
  aiField,
  language = 'FR',
}: {
  values: string[];
  editing: boolean;
  onChange: (index: number, value: string) => void;
  className?: string;
  onActivate?: () => void;
  aiField?: AIFieldId;
  language?: InterfaceLanguage;
}) {
  return (
    <div
      {...(aiField ? aiFieldProps(aiField) : {})}
      className={`${className || ''} ${editing ? 'editable-copy-fields' : onActivate ? 'editable-click-target' : ''}`.trim()}
      onClick={!editing ? onActivate : undefined}
      onKeyDown={!editing && onActivate ? (event) => { if (event.key === 'Enter') onActivate(); } : undefined}
      tabIndex={!editing && onActivate ? 0 : undefined}
      role={!editing && onActivate ? 'button' : undefined}
      title={!editing && onActivate ? (language === 'FR' ? 'Cliquer pour modifier' : 'Click to edit') : undefined}
    >
      {values.map((value, index) => editing ? (
        <AutoResizeTextarea key={index} {...(aiField ? aiFieldProps(aiField, index) : {})} value={value} rows={4} onChange={(event) => onChange(index, event.target.value)} aria-label={language === 'FR' ? `Modifier le paragraphe ${index + 1}` : `Edit paragraph ${index + 1}`} />
      ) : <p key={index} {...(aiField ? aiFieldProps(aiField, index) : {})}>{value}</p>)}
    </div>
  );
}

export function VideoPoster({ asset, onOpen }: { asset: Asset; onOpen: (asset: Asset) => void }) {
  const hasPoster = Boolean(asset.posterUrl || asset.thumbnailUrl);
  return (
    <button type="button" className="video-poster" onClick={() => onOpen(asset)}>
      {hasPoster
        ? <PrivateMediaImage asset={asset} alt="" sizes="(max-width: 720px) 100vw, 1200px" />
        : <span className="video-poster__placeholder"><Video size={38} /><small>{asset.name}</small></span>}
      <span className="video-poster__play" aria-hidden="true"><Play size={24} fill="currentColor" /></span>
    </button>
  );
}

export function ComparableTable({
  title,
  items,
  selection,
  hideHeading = false,
  onUpdate,
  onDelete,
  onAdd,
  language = 'FR',
}: {
  title: string;
  items: ComparableTransaction[];
  selection?: BlockMarkerState;
  hideHeading?: boolean;
  onUpdate?: (id: string, patch: Partial<ComparableTransaction>) => void;
  onDelete?: (id: string) => void;
  onAdd?: () => void;
  language?: InterfaceLanguage;
}) {
  const isFrench = language === 'FR';
  const editable = Boolean(onUpdate);
  return (
    <div className="comparable-group">
      {!hideHeading && <div className="comparable-group__heading">
        <div><h3>{title}</h3><span>{items.length} {isFrench ? `observation${items.length > 1 ? 's' : ''}` : `observation${items.length === 1 ? '' : 's'}`}</span></div>
        <div className="comparable-group__actions">
          {onAdd && <button type="button" className="button button--quiet no-print" onClick={onAdd}><Plus size={14} /> {isFrench ? 'Ajouter' : 'Add'}</button>}
          {selection && <BlockMarkers selection={selection} label={title} />}
        </div>
      </div>}
      <div className={`comparables-table ${editable ? 'comparables-table--editable' : ''}`} role="table" aria-label={title}>
        <div className="comparables-table__head" role="row">
          <span role="columnheader">Date</span><span role="columnheader">{isFrench ? 'Comparable' : 'Comparable item'}</span><span role="columnheader">Source</span><span role="columnheader">{isFrench ? 'Canal' : 'Channel'}</span><span role="columnheader">{isFrench ? 'État' : 'Condition'}</span><span role="columnheader">{isFrench ? 'Valeur' : 'Value'}</span>{editable && <span role="columnheader" aria-label="Actions" />}
        </div>
        {items.map((comparable) => (
          <div role="row" key={comparable.id} data-ai-scope="value.comparables[]" data-ai-instance={comparable.id}>
            <span hidden {...aiFieldProps('value.comparables[].sourceType', comparable.id)}>{comparable.sourceType}</span>
            <span hidden {...aiFieldProps('value.comparables[].currency', comparable.id)}>{comparable.currency}</span>
            {editable && onUpdate ? <>
              <input data-column-label="Date" {...aiFieldProps('value.comparables[].date', comparable.id)} type="date" value={comparable.date} onChange={(event) => onUpdate(comparable.id, { date: event.target.value })} aria-label={isFrench ? `Date de ${comparable.description || 'ce comparable'}` : `Date of ${comparable.description || 'this comparable item'}`} />
              <AutoResizeTextarea data-column-label={isFrench ? 'Comparable' : 'Comparable item'} {...aiFieldProps('value.comparables[].description', comparable.id)} value={comparable.description} rows={2} onChange={(event) => onUpdate(comparable.id, { description: event.target.value })} aria-label={isFrench ? 'Description du comparable' : 'Comparable item description'} />
              <input data-column-label="Source" {...aiFieldProps('value.comparables[].source', comparable.id)} type="text" value={comparable.source} onChange={(event) => onUpdate(comparable.id, { source: event.target.value })} aria-label={isFrench ? 'Source du comparable' : 'Comparable item source'} />
              <select data-column-label={isFrench ? 'Canal' : 'Channel'} {...aiFieldProps('value.comparables[].channel', comparable.id)} value={comparable.saleChannel} onChange={(event) => onUpdate(comparable.id, { saleChannel: event.target.value as ComparableTransaction['saleChannel'] })} aria-label={isFrench ? 'Canal du comparable' : 'Comparable item channel'}>
                <option value="Annonce">{isFrench ? 'Annonce' : 'Listing'}</option><option value="Enchère">{isFrench ? 'Enchère' : 'Auction'}</option><option value="Vente privée">{isFrench ? 'Vente privée' : 'Private sale'}</option><option value="Marchand">{isFrench ? 'Marchand' : 'Dealer'}</option>
              </select>
              <input data-column-label={isFrench ? 'État' : 'Condition'} {...aiFieldProps('value.comparables[].condition', comparable.id)} type="text" value={comparable.condition} onChange={(event) => onUpdate(comparable.id, { condition: event.target.value })} aria-label={isFrench ? 'État du comparable' : 'Comparable item condition'} />
              <input data-column-label={isFrench ? 'Valeur' : 'Value'} {...aiFieldProps('value.comparables[].amount', comparable.id)} data-ai-currency={comparable.currency} type="number" min="0" step="1" value={comparable.amount} onChange={(event) => onUpdate(comparable.id, { amount: Math.max(0, Number(event.target.value)) })} aria-label={isFrench ? 'Valeur du comparable' : 'Comparable item value'} />
              <button data-column-label={isFrench ? 'Action' : 'Action'} type="button" className="icon-button no-print" onClick={() => onDelete?.(comparable.id)} aria-label={isFrench ? `Supprimer ${comparable.description || 'le comparable'}` : `Delete ${comparable.description || 'the comparable item'}`}><Trash2 size={15} /></button>
            </> : <>
              <time data-column-label="Date" role="cell" {...aiFieldProps('value.comparables[].date', comparable.id)}>{formatDate(comparable.date)}</time>
              <span data-column-label="Comparable" role="cell" {...aiFieldProps('value.comparables[].description', comparable.id)}><strong>{comparable.description}</strong></span>
              <span data-column-label="Source" role="cell" {...aiFieldProps('value.comparables[].source', comparable.id)}>{comparable.source}</span>
              <span data-column-label="Canal" role="cell" {...aiFieldProps('value.comparables[].channel', comparable.id)}>{comparable.saleChannel}</span>
              <span data-column-label="État" role="cell" {...aiFieldProps('value.comparables[].condition', comparable.id)}>{comparable.condition}</span>
              <strong data-column-label="Valeur" role="cell" {...aiFieldProps('value.comparables[].amount', comparable.id)} data-ai-currency={comparable.currency}>{formatMoney(comparable.amount, comparable.currency)}</strong>
            </>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AccessRestricted({ title, language = 'FR' }: { title: string; language?: InterfaceLanguage }) {
  return <div className="restricted-card"><Lock size={18} /><span className="eyebrow">{language === 'FR' ? 'Accès restreint' : 'Restricted access'}</span><h3>{title}</h3></div>;
}
