import { useEffect, useMemo, useRef, useState } from 'react';
import type { PrivateCartularySnapshot } from '../services/cartularies.ts';
import type { VerticalSchema } from '../schema/schemaTypes.ts';
import { buildGenericFieldRows, formatGenericValue } from '../schema/fieldPresentation.ts';
import {
  CARTULARY_PRESENTATION_CONTRACT_VERSION,
  COMMON_CARTULARY_STRUCTURE,
  cartularyPageDefinitions,
  cartularyPageForSchemaSection,
} from '../features/cartulary/presentation/cartularyPresentationContract.ts';
import { cartularyPageFromHash, type CartularyPage } from '../utils/interfaceState.ts';
import { BrandLogo } from './BrandLogo';
import './generic-cartulary.css';
import type { Asset } from '../types';
import type { RegistryItemProjection } from '../domain/projections.ts';
import type { RegistryFollowUpItem } from '../domain/followUp.ts';
import { RegistryTodoBoard } from '../features/registry/RegistryTodoBoard';
import { genericFieldGroupIsEditable, validateGenericFieldValue } from '../../scripts/lib/generic-editing-policy.mjs';
import { schemaSectionLabel } from '../schema/schemaLabels.ts';
import { assetTypeLabel, LIFECYCLE_LABELS } from '../features/registry/registryPresentation.ts';
import { PrivateMediaImage } from './PrivateMediaImage';
import { MediaVideo } from './MediaVideo';
import { MediaDownloadLink } from './MediaDownloadLink';
import { PublicWebsitePublicationPanel } from './PublicWebsitePublicationPanel';
import { GenericCartularyPrintSummary } from './GenericCartularyPrintSummary';
import { PUBLICATION_BLOCK_CATALOG } from '../domain/publication';
import { buildWebsiteDraft, websiteDraftRequest } from '../domain/websiteDraft';
import { confirmUnsavedNavigation, useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { GenericRepeatedFields } from './GenericRepeatedFields';
import { GenericMediaEditor } from './GenericMediaEditor';
import type { GenericMediaMutation } from '../services/genericCartulary';
import type { WebsitePublicationState } from '../services/websitePublication';
import { WebsiteDraftWarnings } from './WebsiteDraftWarnings';

interface GenericCartularyViewProps {
  snapshot: PrivateCartularySnapshot;
  schema: VerticalSchema;
  returnHref?: string | null;
  collectionName?: string;
  canManage?: boolean;
  canPublish?: boolean;
  assets?: Asset[];
  mediaError?: boolean;
  registryItem?: RegistryItemProjection | null;
  todos?: RegistryFollowUpItem[];
  followUpState?: 'loading' | 'ready' | 'error' | 'missing';
  onRetryFollowUp?: () => void;
  onSave?: (edits: Array<{ fieldId: string; value: unknown }>) => Promise<void>;
  onSaveMedia?: (mutation: GenericMediaMutation) => Promise<void>;
  onUploadMedia?: (file: File, progress: (message: string) => void) => Promise<Asset>;
  onRetryMedia?: () => void;
  onPublicationChanged?: () => void;
}

export const GenericCartularyView = ({ snapshot, schema, returnHref, collectionName, canManage = false, canPublish = false, assets = [], mediaError = false, registryItem, todos = [], followUpState = 'ready', onRetryFollowUp, onSave, onSaveMedia, onUploadMedia, onRetryMedia, onPublicationChanged }: GenericCartularyViewProps) => {
  const [activePage, setActivePage] = useState<CartularyPage>(() => cartularyPageFromHash(window.location.hash));
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [publicationSelection, setPublicationSelection] = useState<string[]>([]);
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);
  const [authorizingMedia, setAuthorizingMedia] = useState(false);
  const [publicationBaseline, setPublicationBaseline] = useState<{ blocks: string[]; media: string[] }>({ blocks: [], media: [] });
  const [publicationBusy, setPublicationBusy] = useState(false);
  const initializedPublication = useRef(false);
  const selectionKey = (blocks: string[], media: string[]) => JSON.stringify([[...blocks].sort(), [...media].sort()]);
  const publicationDirty = selectionKey(publicationSelection, selectedMediaIds) !== selectionKey(publicationBaseline.blocks, publicationBaseline.media);
  const unavailableSelectedMedia = selectedMediaIds.some((id) => !assets.some((asset) => asset.id === id && asset.binaryId));
  const resetPublicationSelection = () => { setPublicationSelection(publicationBaseline.blocks); setSelectedMediaIds(publicationBaseline.media); };
  const hydratePublication = (state: WebsitePublicationState, committed = false) => {
    if (!committed && (initializedPublication.current && publicationDirty)) return;
    initializedPublication.current = true;
    const next = { blocks: state.status === 'published' ? state.blockIds : [], media: state.status === 'published' ? state.selectedAssetIds || [] : [] };
    setPublicationBaseline(next); setPublicationSelection(next.blocks); setSelectedMediaIds(next.media);
  };
  const busy = saving || authorizingMedia || publicationBusy;
  const { confirmDiscard } = useUnsavedChangesGuard(busy || publicationDirty || Object.keys(edits).length > 0, { busy, onDiscard: () => { setEdits({}); setEditing(false); setError(''); resetPublicationSelection(); } });
  const fieldIsEditable = (field: VerticalSchema['fields'][number] | undefined) => genericFieldGroupIsEditable(field, schema.fields);
  const pages = cartularyPageDefinitions('FR');
  const ownershipSectionId = 'cover.ownership_history';
  const exposesOwnershipHistory = schema.sections.includes(ownershipSectionId);
  const hasOwnershipSection = snapshot.sections.some((section) => section.schemaSectionId === ownershipSectionId);
  const sections = useMemo(() => exposesOwnershipHistory && !hasOwnershipSection
    ? [{
        id: 'ownership.history',
        schemaSectionId: ownershipSectionId,
        schemaVersion: `${schema.schemaId}@${schema.version}`,
        title: "Historique de l'objet - Propriétaires précédents",
        visibility: 'secret' as const,
        status: 'imported_unreviewed' as const,
        fields: {},
        revision: 1 as const,
      }, ...snapshot.sections]
    : snapshot.sections, [exposesOwnershipHistory, hasOwnershipSection, schema.schemaId, schema.version, snapshot.sections]);

  useEffect(() => {
    const updatePage = () => setActivePage(cartularyPageFromHash(window.location.hash));
    window.addEventListener('hashchange', updatePage);
    return () => window.removeEventListener('hashchange', updatePage);
  }, []);

  const visibleSections = useMemo(() => sections.filter((section) => (
    cartularyPageForSchemaSection(section.schemaSectionId) === activePage
  )), [activePage, sections]);
  const displayedSections = [...visibleSections, ...schema.sections.filter((id) => editing && cartularyPageForSchemaSection(id) === activePage
    && !sections.some((section) => section.schemaSectionId === id) && schema.fields.some((field) => field.sectionId === id && fieldIsEditable(field)))
    .map((id) => ({ id, schemaSectionId: id, schemaVersion: `${schema.schemaId}@${schema.version}`, title: schemaSectionLabel(id), visibility: 'secret' as const, status: 'imported_unreviewed' as const, fields: {}, revision: 1 as const }))];
  const missingCommonSections = COMMON_CARTULARY_STRUCTURE.filter((definition) => (
    definition.page === activePage
    && !sections.some((section) => section.schemaSectionId === definition.id)
  ));

  const navigateTo = (page: CartularyPage) => {
    if (!confirmUnsavedNavigation()) return;
    setEditing(false); setEdits({}); setError(''); setNotice('');
    window.location.hash = page;
    setActivePage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const save = async () => {
    if (!onSave || !canManage || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const values = Object.entries(edits).map(([fieldId, value]) => ({ fieldId, value: validateGenericFieldValue(schema.fields.find((field) => field.fieldId === fieldId), value) }));
      if (!values.length) { setEditing(false); return; }
      await onSave(values);
      setEdits({}); setEditing(false); setNotice('Modifications enregistrées dans le Cartulaire et son Registre.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Enregistrement impossible. Votre saisie est conservée.'); }
    finally { setSaving(false); }
  };
  const publicationDraft = useMemo(() => buildWebsiteDraft({ brand: snapshot.envelope.makerName, model: snapshot.envelope.modelName, reference: snapshot.envelope.referenceCode || '', assets: assets.filter((asset) => selectedMediaIds.includes(asset.id)),
    specifications: snapshot.sections.map((section) => ({ title: schemaSectionLabel(section.schemaSectionId), items: buildGenericFieldRows(section, schema)
      .filter((row) => schema.fields.find((field) => field.fieldId === row.fieldId)?.publishableTo.includes('public'))
      .map((row) => ({ label: row.label, value: formatGenericValue(row.value) })) })).filter((group) => group.items.length > 0),
  }, publicationSelection), [assets, selectedMediaIds, publicationSelection, schema, snapshot]);
  const publicationBlocks = useMemo(() => websiteDraftRequest(publicationDraft), [publicationDraft]);
  const selectPublicMedia = async (asset: Asset, selected: boolean) => {
    if (authorizingMedia || publicationBusy) return;
    if (!selected) { setSelectedMediaIds((current) => current.filter((id) => id !== asset.id)); return; }
    if (asset.visibility !== 'Tous') {
      if (!onSaveMedia || !window.confirm(`Autoriser « ${asset.name} » à être sélectionné pour le public ? L’autorisation sera enregistrée. L’original restera privé et la mise en ligne exigera encore votre confirmation.`)) return;
      setAuthorizingMedia(true); setError('');
      try { await onSaveMedia({ changes: [{ id: asset.id, visibility: 'Tous' }], removeIds: [], confirmedPublicIds: [asset.id] }); }
      catch (failure) { setError(failure instanceof Error ? failure.message : 'Autorisation non enregistrée. Le média reste non sélectionné.'); return; }
      finally { setAuthorizingMedia(false); }
    }
    setSelectedMediaIds((current) => [...new Set([...current, asset.id])]);
    setPublicationSelection((current) => current.includes('media-library') ? current : [...current, 'media-library']);
  };

  return (
    <div className="generic-cartulary" data-cartulary-presentation-version={CARTULARY_PRESENTATION_CONTRACT_VERSION}>
      {returnHref && <a className="generic-cartulary__return" href={returnHref}>← Retour au Registre</a>}
      <header className="generic-cartulary__header">
        <BrandLogo />
        <div>
          <span className="eyebrow">Cartulaire multi-actifs · {snapshot.envelope.publicCode}</span>
          <h1>{snapshot.envelope.displayTitle}</h1>
          <p>{snapshot.envelope.makerName} · {snapshot.envelope.modelName}</p>
        </div>
        <div className="generic-cartulary__badges">
          <span>{collectionName || 'Collection privée'}</span>
          <span>{assetTypeLabel(snapshot.envelope.assetType)}</span>
          <span>{LIFECYCLE_LABELS[snapshot.envelope.lifecycleStatus] || snapshot.envelope.lifecycleStatus}</span>
        </div>
      </header>

      <nav className="generic-cartulary__tabs" aria-label="Pages du Cartulaire">
        {pages.map((page) => (
          <button type="button" key={page.id} className={activePage === page.id ? 'is-active' : undefined} onClick={() => navigateTo(page.id)} aria-current={activePage === page.id ? 'page' : undefined}>
            <span>{page.number}</span>{page.label}
          </button>
        ))}
      </nav>

      <main className="generic-cartulary__sections">
        {canManage && onSave && !['media', 'publication'].includes(activePage) && <div className="generic-cartulary__edit-actions">
          {!editing ? <button type="button" className="button button--primary" onClick={() => setEditing(true)}>Modifier les informations</button>
            : <><button type="button" className="button button--primary" disabled={saving || !Object.keys(edits).length} onClick={() => void save()}>{saving ? 'Enregistrement en cours…' : 'Enregistrer'}</button><button type="button" className="button button--quiet" disabled={saving} onClick={() => { if (confirmDiscard()) { setEditing(false); setEdits({}); setError(''); } }}>Annuler</button><p>Les champs calculés et système restent en lecture seule. Les informations personnelles se gèrent dans le Coffre, séparément. Le profil {schema.schemaId}@{schema.version} est conservé.</p></>}
        </div>}
        {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
        {activePage === 'cover' && (
          <section className="generic-section generic-section--common">
            <header><div><span className="eyebrow">Structure commune</span><h2>Collection</h2></div></header>
            <dl className="generic-field-list"><div><dt>Collection</dt><dd>{collectionName || 'Collection privée'}</dd><span>Privé · Cartulaire</span></div></dl>
          </section>
        )}
        {activePage === 'cover' && <section aria-label="État du suivi">
          {followUpState === 'ready' && !registryItem && <><h2>À Faire</h2><p>Le suivi nécessite le raccordement de cet objet au Registre.</p></>}
          {followUpState !== 'ready' && <div role={followUpState === 'loading' ? 'status' : 'alert'}><h2>À Faire</h2><p>{followUpState === 'loading' ? 'Chargement du suivi…' : followUpState === 'missing' ? 'Le lien entre cet objet et le Registre est indisponible. L’absence de tâches ne peut pas être confirmée.' : 'Le suivi n’a pas pu être actualisé. Les dernières tâches connues restent affichées ; les modifications sont suspendues.'}</p>{followUpState !== 'loading' && onRetryFollowUp && <button type="button" onClick={onRetryFollowUp}>Réessayer le suivi</button>}</div>}
          {registryItem && (followUpState === 'ready' || todos.length > 0) && <RegistryTodoBoard registryId={snapshot.envelope.registryId} items={[registryItem]} todos={todos} canManage={canManage && followUpState === 'ready'} />}
        </section>}
        {activePage === 'media' && <section className="generic-section"><h2>Médias de l’objet</h2>
          {mediaError && <div role="alert"><p>Les médias n’ont pas pu être actualisés. Les dernières informations connues peuvent être anciennes ; les modifications sont suspendues.</p>{onRetryMedia && <button type="button" onClick={onRetryMedia}>Réessayer les médias</button>}</div>}
          {!mediaError && !assets.length && <p>Aucun média disponible. Les fichiers joints lors de la création apparaissent ici après vérification.</p>}
          <div className="generic-media-grid">{assets.map((asset) => <article key={asset.id}><h3>{asset.name}</h3>{asset.type === 'image' ? <PrivateMediaImage asset={asset} alt={asset.name} /> : asset.type === 'video' ? <MediaVideo asset={asset} /> : <p>Document joint</p>}<MediaDownloadLink media={asset} />{!asset.url && !asset.binaryId && <p role="status">Fichier source indisponible : sa réintégration est nécessaire.</p>}</article>)}</div>
          {canManage && !mediaError && onSaveMedia && onUploadMedia && <GenericMediaEditor assets={assets} canPublish={canPublish} onSave={onSaveMedia} onUpload={onUploadMedia} />}
        </section>}
        {activePage === 'publication' && <section className="generic-section"><h2>Publiez un mini -site de votre Cartulaire</h2>
          {canPublish && <><fieldset disabled={authorizingMedia || publicationBusy}><legend>Contenus choisis pour le mini-site public</legend>{PUBLICATION_BLOCK_CATALOG.filter((block) => ['cover-watch', 'reference-specs', 'media-library'].includes(block.id)).map((block) => <label key={block.id}><input type="checkbox" checked={publicationSelection.includes(block.id)} onChange={(event) => setPublicationSelection((current) => event.target.checked ? [...current, block.id] : current.filter((id) => id !== block.id))} />{block.title}</label>)}</fieldset>
            {assets.length > 0 && <fieldset disabled={authorizingMedia || publicationBusy || mediaError}><legend>Médias que vous choisissez pour le mini-site</legend><p>Aucun média n’est sélectionné automatiquement. Un média Secret doit d’abord recevoir une autorisation explicite enregistrée. La mise en ligne exige ensuite une copie de présentation vérifiée et votre confirmation. Désélectionner ici prépare la prochaine publication, sans retirer une publication déjà en ligne.</p>{assets.map((asset) => <label key={asset.id}><input type="checkbox" checked={selectedMediaIds.includes(asset.id)} disabled={!asset.binaryId} onChange={(event) => void selectPublicMedia(asset, event.target.checked)} />{asset.name} · {asset.visibility}{!asset.binaryId && ' · Réintégration du fichier nécessaire'}</label>)}</fieldset>}
          </>}
          {authorizingMedia && <p role="status">Enregistrement de l’autorisation du média…</p>}
          {publicationDirty && <p role="status">Sélection modifiée, non publiée. <button type="button" disabled={busy} onClick={() => { if (confirmDiscard()) resetPublicationSelection(); }}>Annuler les changements de sélection</button></p>}
          {publicationSelection.some((id) => !['cover-watch', 'reference-specs', 'media-library'].includes(id)) && <p role="alert">La publication actuelle contient des rubriques non modifiables dans cet écran. Utilisez le Cartulaire d’origine pour les mettre à jour ; leur retrait reste possible ci-dessous.</p>}
          {unavailableSelectedMedia && <p role="alert">Un média de la sélection publiée n’est pas disponible dans cet inventaire. Actualisez les médias avant de mettre à jour le mini-site ; vous pouvez toujours retirer la publication.</p>}
          <WebsiteDraftWarnings blocks={publicationDraft} />
          <PublicWebsitePublicationPanel cartularyId={snapshot.envelope.id} blocks={publicationBlocks} onSelectionLoaded={hydratePublication} onStateChanged={(state) => { hydratePublication(state, true); onPublicationChanged?.(); }} onBusyChange={setPublicationBusy} publishingDisabled={authorizingMedia || mediaError || unavailableSelectedMedia || publicationSelection.some((id) => !['cover-watch', 'reference-specs', 'media-library'].includes(id))} readOnly={!canPublish} />
        </section>}
        {displayedSections.map((section) => {
          const rows = buildGenericFieldRows(section, schema);
          const repeatedFields = schema.fields.filter((field) => field.sectionId === section.schemaSectionId && field.cardinality === 'repeatable' && fieldIsEditable(field));
          const repeatedGroups = [...new Set(repeatedFields.map((field) => field.fieldId.split('[]')[0]))].map((prefix) => repeatedFields.filter((field) => field.fieldId.split('[]')[0] === prefix));
          if (editing) for (const field of schema.fields.filter((field) => field.sectionId === section.schemaSectionId && fieldIsEditable(field))) {
            if (!rows.some((row) => row.fieldId === field.fieldId)) rows.push({ fieldId: field.fieldId, label: field.label, value: null, proofStatus: null, visibility: 'secret', knownBySchema: true, source: 'fields' });
          }
          return (
            <section key={section.id} className="generic-section">
              <header>
                <div><h2>{schemaSectionLabel(section.schemaSectionId) === section.schemaSectionId ? section.title : schemaSectionLabel(section.schemaSectionId)}</h2></div>
                <span className="generic-section__status">Déclarations à vérifier</span>
              </header>
              {rows.length ? (
                <dl className="generic-field-list">
                  {rows.filter((row) => !repeatedFields.some((field) => field.fieldId === row.fieldId)).map((row) => {
                    const field = schema.fields.find((candidate) => candidate.fieldId === row.fieldId);
                    const value = Object.hasOwn(edits, row.fieldId) ? edits[row.fieldId] : row.value;
                    const editable = editing && fieldIsEditable(field);
                    const inputId = `generic-field-${row.fieldId}`;
                    const change = (next: unknown) => setEdits((current) => ({ ...current, [row.fieldId]: next }));
                    return (
                    <div key={`${row.source}:${row.fieldId}`} className={!row.knownBySchema ? 'is-unknown' : undefined}>
                      <dt>{editable ? <label htmlFor={inputId}>{row.label}{field?.required ? ' *' : ''}</label> : row.label}{!row.knownBySchema && <small>Information complémentaire importée</small>}</dt>
                      <dd>{!editable ? formatGenericValue(row.value) : field!.dataType === 'boolean' ? <select id={inputId} value={value === null ? '' : String(value)} disabled={saving} onChange={(event) => change(event.target.value === '' ? null : event.target.value === 'true')}><option value="">Non renseigné</option><option value="true">Oui</option><option value="false">Non</option></select>
                        : field!.dataType === 'enum' && field!.allowedValues?.length ? <select id={inputId} value={String(value ?? '')} disabled={saving} onChange={(event) => change(event.target.value)}><option value="">Non renseigné</option>{field!.allowedValues.map((option) => <option key={option}>{option}</option>)}</select>
                        : field!.dataType === 'money' ? <div><input id={inputId} type="number" min="0" step="any" disabled={saving} value={String((value as { amount?: number })?.amount ?? '')} onChange={(event) => change(event.target.value === '' ? null : { amount: Number(event.target.value), currency: (value as { currency?: string })?.currency || 'EUR' })} /><span>{(value as { currency?: string })?.currency || 'EUR'}</span></div>
                        : field!.dataType === 'long_text' ? <textarea id={inputId} value={String(value ?? '')} disabled={saving} maxLength={10000} onChange={(event) => change(event.target.value)} />
                        : <input id={inputId} type={['number', 'percentage'].includes(field!.dataType) ? 'number' : field!.dataType === 'date' ? 'date' : field!.dataType === 'url' ? 'url' : 'text'} value={String(value ?? '')} disabled={saving} maxLength={1000} onChange={(event) => change(['number', 'percentage'].includes(field!.dataType) ? event.target.value === '' ? null : Number(event.target.value) : event.target.value)} />}</dd>
                      <span>{editable ? 'Déclaration privée · validation à l’enregistrement' : 'Donnée privée · provenance conservée'}</span>
                    </div>
                  ); })}
                </dl>
              ) : <p className="generic-section__empty">Aucune valeur dans cette section.</p>}
              {repeatedGroups.map((fields) => <GenericRepeatedFields key={fields[0].fieldId} fields={fields} values={Object.fromEntries(fields.map((field) => [field.fieldId, Object.hasOwn(edits, field.fieldId) ? edits[field.fieldId] : rows.find((row) => row.fieldId === field.fieldId)?.value]))} editing={editing} busy={saving} onChange={(next) => setEdits((current) => ({ ...current, ...next }))} />)}
              {editing && schema.fields.some((field) => field.sectionId === section.schemaSectionId && field.cardinality === 'repeatable' && !fieldIsEditable(field)) && <p>Les listes contenant des pièces jointes, des montants composés ou des informations personnelles restent en lecture seule dans cet écran. Leurs données existantes sont conservées.</p>}
            </section>
          );
        })}
        {activePage === 'publication' && <GenericCartularyPrintSummary snapshot={snapshot} schema={schema} assets={assets} />}
        {missingCommonSections.filter((definition) => !['cover.collection', 'cover.todos', 'publication.cartulary', 'publication.report'].includes(definition.id)).map((definition) => (
          <section key={definition.id} className="generic-section generic-section--common">
            <header><div><span className="eyebrow">Structure commune</span><h2>{definition.title}</h2></div></header>
            <p className="generic-section__empty">{['condition.storage', 'condition.transmission'].includes(definition.id) ? <a href="/account/sign-in?space=vault">Ces informations personnelles se gèrent dans le Coffre.</a> : definition.id === 'publication.collections' ? <a href={`/registry/${encodeURIComponent(snapshot.envelope.registryId)}/collections`}>Gérer les collections et leur publication</a> : definition.id === 'publication.community' ? <a href="/community">Accéder au Cercle et aux modalités d’admission</a> : 'Aucune donnée enregistrée.'}</p>
          </section>
        ))}
        {visibleSections.length === 0 && missingCommonSections.length === 0 && activePage !== 'cover' && (
          <section className="generic-section generic-section--common"><p className="generic-section__empty">Aucune donnée enregistrée sur cette page.</p></section>
        )}
      </main>
    </div>
  );
};
