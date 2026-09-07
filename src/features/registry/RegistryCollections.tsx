import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Archive, Check, Copy, ExternalLink, Globe2, Layers3, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import {
  collectionWebsiteIsPublished,
  collectionWebsitePath,
  registryCollectionVersion,
  registryCollectionId,
  type RegistryCollectionDocument,
  type RegistryCollectionInput,
} from '../../domain/collections.ts';
import type { RegistryDocument } from '../../domain/foundations.ts';
import { registryItemCollectionIds, type RegistryItemProjection } from '../../domain/projections.ts';
import { deleteRegistryCollection, normalizeCollectionSlug, saveRegistryCollection } from '../../services/collections.ts';
import { observeRegistryItems } from '../../services/projections.ts';
import { labelFromIdentifier } from './registryPresentation.ts';
import { useRegistryCollections } from './useRegistryCollections.ts';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';

const emptyInput = (): RegistryCollectionInput => ({
  name: '',
  description: '',
  websiteTitle: '',
  websiteSlug: '',
  status: 'draft',
  visibility: 'secret',
  publicationConsent: false,
  publishedCartularyIds: [],
});

export function RegistryCollections({ registry, canManage, canPublish = false }: { registry: RegistryDocument; canManage: boolean; canPublish?: boolean }) {
  const { collections, state: collectionsState, retry: retryCollections } = useRegistryCollections(registry.id);
  const [items, setItems] = useState<RegistryItemProjection[]>([]);
  const [itemsState, setItemsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingVersion, setEditingVersion] = useState<string | null>(null);
  const [creationId, setCreationId] = useState<string | undefined>();
  const [form, setForm] = useState<RegistryCollectionInput>(emptyInput);
  const [formBaseline, setFormBaseline] = useState(() => JSON.stringify(emptyInput()));
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedCollectionId, setCopiedCollectionId] = useState<string | null>(null);
  const busy = saving || removingId !== null;
  const { confirmDiscard } = useUnsavedChangesGuard(busy || (editingId !== null && JSON.stringify(form) !== formBaseline), { busy });

  useEffect(() => {
    setItemsState('loading');
    return observeRegistryItems(registry.id, (nextItems) => { setItems(nextItems); setItemsState('ready'); }, () => setItemsState('error'));
  }, [registry.id, attempt]);
  const inventoryReady = collectionsState === 'ready' && itemsState === 'ready';
  const inventoryError = collectionsState === 'error' || itemsState === 'error';
  const currentEditingDocument = editingId ? collections.find((entry) => entry.id === editingId) : null;
  const staleForm = Boolean(editingId && currentEditingDocument && registryCollectionVersion(currentEditingDocument) !== editingVersion);
  const publicationLocked = !canPublish && Boolean(form.publicationConsent || currentEditingDocument?.publicationConsent);

  useEffect(() => {
    if (editingId && collectionsState === 'ready' && !currentEditingDocument) {
      setEditingId(null); setEditingVersion(null); setForm(emptyInput());
      setError('Cette Collection a été supprimée. Le formulaire a été fermé ; aucun brouillon ne peut la recréer.');
    }
  }, [editingId, currentEditingDocument, collectionsState]);

  const rows = useMemo(() => {
    const documents = new Map(collections.map((entry) => [entry.id, entry]));
    const identifiers = new Set([...documents.keys(), ...items.flatMap(registryItemCollectionIds)]);
    return [...identifiers].map((id) => ({
      id,
      document: documents.get(id) || null,
      items: items.filter((item) => registryItemCollectionIds(item).includes(id) && item.projectionStatus === 'active'),
    })).sort((left, right) => (left.document?.name || labelFromIdentifier(left.id)).localeCompare(right.document?.name || labelFromIdentifier(right.id), 'fr'));
  }, [collections, items]);

  const startEdit = (document: RegistryCollectionDocument, id: string) => {
    if (!confirmDiscard()) return;
    const name = document?.name || labelFromIdentifier(id);
    setEditingId(id);
    setEditingVersion(registryCollectionVersion(document));
    const next = document ? {
      name: document.name,
      description: document.description,
      websiteTitle: document.websiteTitle,
      websiteSlug: document.websiteSlug,
      status: document.status,
      visibility: document.visibility,
      publicationConsent: document.publicationConsent === true,
      publishedCartularyIds: document.publishedCartularyIds || [],
    } : { ...emptyInput(), name, websiteTitle: name, websiteSlug: normalizeCollectionSlug(name) };
    setForm(next); setFormBaseline(JSON.stringify(next));
    setError(null);
  };

  const startCreate = () => {
    if (!confirmDiscard()) return;
    setEditingId('');
    setCreationId(registryCollectionId('Collection'));
    setEditingVersion(null);
    setForm(emptyInput());
    setFormBaseline(JSON.stringify(emptyInput()));
    setError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage || busy || staleForm || publicationLocked || !form.name.trim() || !inventoryReady) return;
    if (form.publicationConsent && form.publishedCartularyIds.length === 0) {
      setError('Sélectionnez au moins un objet avant de publier le mini-site.');
      return;
    }
    if (form.publicationConsent && (!canPublish || !window.confirm('Publier cette sélection et ces informations sur le Web, accessibles à tous ?'))) return;
    setSaving(true);
    setError(null);
    try {
      await saveRegistryCollection({
        id: editingId || undefined,
        createId: editingId === '' ? creationId : undefined,
        organizationId: registry.organizationId,
        registryId: registry.id,
        input: { ...form, name: form.name.trim(), websiteTitle: form.websiteTitle.trim() || form.name.trim() },
        expectedVersion: editingVersion || undefined,
        confirmedPublication: form.publicationConsent,
      });
      setEditingId(null);
      setEditingVersion(null);
      setForm(emptyInput());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Enregistrement impossible. Vérifiez vos droits puis réessayez.');
    } finally {
      setSaving(false);
    }
  };

  const editingCollectionItems = editingId === null || editingId === ''
    ? []
    : items.filter((item) => registryItemCollectionIds(item).includes(editingId) && item.projectionStatus === 'active');

  const isEditingDocumentPublished = currentEditingDocument ? collectionWebsiteIsPublished(currentEditingDocument) : false;

  const togglePublishedItem = (cartularyId: string) => {
    setForm((current) => ({
      ...current,
      publishedCartularyIds: current.publishedCartularyIds.includes(cartularyId)
        ? current.publishedCartularyIds.filter((id) => id !== cartularyId)
        : [...current.publishedCartularyIds, cartularyId],
    }));
  };

  const selectAllItems = () => {
    setForm((current) => ({
      ...current,
      publishedCartularyIds: editingCollectionItems.map((item) => item.cartularyId),
    }));
  };

  const deselectAllItems = () => {
    setForm((current) => ({
      ...current,
      publishedCartularyIds: [],
    }));
  };

  const copyWebsiteUrl = async (collectionId: string) => {
    const url = `${window.location.origin}${collectionWebsitePath(registry.id, collectionId)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedCollectionId(collectionId);
      window.setTimeout(() => setCopiedCollectionId((current) => current === collectionId ? null : current), 1_800);
    } catch {
      setError("L’adresse n’a pas pu être copiée. Vous pouvez la sélectionner manuellement.");
    }
  };

  const remove = async (document: RegistryCollectionDocument, itemCount: number) => {
    if (!canManage || busy || !inventoryReady || itemCount > 0 || !confirmDiscard() || !window.confirm('Supprimer cette collection vide et retirer son éventuel mini-site public ?')) return;
    setRemovingId(document.id);
    try {
      await deleteRegistryCollection(registry.id, document.id, registryCollectionVersion(document));
      if (editingId === document.id) { setEditingId(null); setEditingVersion(null); setForm(emptyInput()); }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'La collection n’a pas pu être supprimée.');
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <section className="registry-collections" aria-labelledby="registry-collections-title">
      <header className="registry-page-heading">
        <div><p className="registry-kicker">Organisation du Registre</p><h1 id="registry-collections-title">Collections</h1></div>
        {canManage && <button type="button" className="registry-collections__create" onClick={startCreate} disabled={!inventoryReady || busy}><Plus aria-hidden="true" />Créer une collection</button>}
      </header>

      {error && <p className="registry-form-error" role="alert">{error}</p>}
      {!inventoryReady && <div role={inventoryError ? 'alert' : 'status'} className="registry-collections__notice">
        <p>{inventoryError ? 'L’inventaire n’a pas pu être actualisé. Les données encore affichées peuvent être anciennes ; les modifications sont suspendues.' : 'Chargement des Collections et de leurs objets…'}</p>
        {inventoryError && <button type="button" onClick={() => { retryCollections(); setAttempt((current) => current + 1); }}>Réessayer</button>}
      </div>}

      {editingId !== null && (
        <form className="registry-collection-form" onSubmit={submit}>
          <header><div><span>{editingId ? 'Modifier' : 'Nouvelle collection'}</span><h2>{editingId ? form.name : 'Créer une collection'}</h2></div><button type="button" disabled={busy} onClick={() => { if (confirmDiscard()) setEditingId(null); }} aria-label="Fermer"><X aria-hidden="true" /></button></header>
          {staleForm && <div role="alert"><p>Cette Collection a changé depuis l’ouverture du formulaire. Rechargez sa dernière version avant de poursuivre.</p><button type="button" onClick={() => currentEditingDocument && startEdit(currentEditingDocument, currentEditingDocument.id)}>Recharger la dernière version</button></div>}
          {publicationLocked && <p role="status">La modification d’une Collection publiée nécessite le droit de gérer les publications.</p>}
          <fieldset className="registry-collection-form__fields" disabled={busy || staleForm || publicationLocked}>
          <div>
            <label>Nom<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value, websiteSlug: current.websiteSlug || normalizeCollectionSlug(event.target.value) }))} required /></label>
            <label>Titre du site<input value={form.websiteTitle} onChange={(event) => setForm((current) => ({ ...current, websiteTitle: event.target.value }))} placeholder={form.name || 'Titre public'} /></label>
            <label>État interne<select value={form.status === 'archived' ? 'archived' : 'active'} onChange={(event) => setForm((current) => event.target.value === 'archived' ? { ...current, status: 'archived', visibility: 'secret', publicationConsent: false } : { ...current, status: current.publicationConsent ? 'published' : 'draft' })}><option value="active">Active dans le Registre</option><option value="archived">Archivée</option></select></label>
            <label className="registry-collection-form__description">Description<textarea rows={3} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
          </div>

          <section className="registry-collection-publication" aria-labelledby="registry-collection-publication-title">
            <header>
              <div><span>Publication distincte</span><h3 id="registry-collection-publication-title">Mini-site de la Collection</h3></div>
              <label className="registry-collection-publication__toggle">
                <input
                  type="checkbox"
                  checked={form.publicationConsent}
                  disabled={!canPublish || form.status === 'archived' || editingId === '' || editingCollectionItems.length === 0}
                  onChange={(event) => setForm((current) => ({
                    ...current,
                    publicationConsent: event.target.checked,
                    status: event.target.checked ? 'published' : 'draft',
                    visibility: event.target.checked ? 'public' : 'secret',
                  }))}
                />
                <span>{form.publicationConsent ? 'Publication du mini-site activée' : 'Je souhaite publier le mini-site'}</span>
              </label>
            </header>
            <p><strong>L’état interne</strong> sert à gérer la Collection dans votre Registre. <strong>La publication</strong> rend publique une projection séparée contenant uniquement les objets cochés ci-dessous.</p>

            {editingId === '' ? (
              <p className="registry-collection-publication__notice">Enregistrez d’abord la nouvelle Collection ; vous pourrez ensuite choisir les objets et publier son mini-site.</p>
            ) : editingCollectionItems.length > 0 ? (
              <fieldset>
                <legend style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', flexWrap: 'wrap', gap: '8px' }}>
                  <span>Objets à afficher sur le mini-site ({form.publishedCartularyIds.length} / {editingCollectionItems.length} sélectionnés)</span>
                  {editingCollectionItems.length > 1 && (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        type="button"
                        onClick={selectAllItems}
                        style={{ background: 'transparent', border: '1px solid var(--rule)', padding: '2px 8px', fontSize: '9px', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}
                      >
                        Tout cocher
                      </button>
                      <button
                        type="button"
                        onClick={deselectAllItems}
                        style={{ background: 'transparent', border: '1px solid var(--rule)', padding: '2px 8px', fontSize: '9px', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}
                      >
                        Tout décocher
                      </button>
                    </div>
                  )}
                </legend>
                {form.publicationConsent && form.publishedCartularyIds.length === 0 && (
                  <div style={{ gridColumn: '1 / -1', padding: '10px 14px', background: 'rgba(235, 90, 60, 0.08)', border: '1px solid var(--mark)', color: 'var(--mark)', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <AlertTriangle size={16} aria-hidden="true" />
                    <span>Cochez au moins un objet ci-dessous pour inclure du contenu sur le mini-site.</span>
                  </div>
                )}
                {editingCollectionItems.map((item) => (
                  <label key={item.cartularyId} className={form.publishedCartularyIds.includes(item.cartularyId) ? 'is-selected' : undefined}>
                    <input type="checkbox" checked={form.publishedCartularyIds.includes(item.cartularyId)} onChange={() => togglePublishedItem(item.cartularyId)} />
                    <span><strong>{item.displayTitle}</strong><small>{[item.referenceCode, item.manufactureYear].filter(Boolean).join(' · ')}</small></span>
                    {form.publishedCartularyIds.includes(item.cartularyId) && <Check aria-hidden="true" />}
                  </label>
                ))}
              </fieldset>
            ) : <p className="registry-collection-publication__notice">Ajoutez au moins un Cartulaire à cette Collection avant de publier son mini-site.</p>}

            {form.publicationConsent && editingId && (
              <div className="registry-collection-publication__url">
                <label>
                  <span>{isEditingDocumentPublished ? 'Adresse publique (actuellement en ligne)' : 'Adresse publique (active dès enregistrement)'}</span>
                  <input value={`${window.location.origin}${collectionWebsitePath(registry.id, editingId)}`} readOnly />
                </label>
                <button type="button" onClick={() => void copyWebsiteUrl(editingId)}><Copy aria-hidden="true" />{copiedCollectionId === editingId ? 'Copiée' : 'Copier'}</button>
                {isEditingDocumentPublished ? (
                  <a href={collectionWebsitePath(registry.id, editingId)} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />Accéder au mini-site</a>
                ) : (
                  <span style={{ fontSize: '9px', fontStyle: 'italic', color: 'var(--muted)', alignSelf: 'center', padding: '0 4px' }}>
                    Enregistrez pour mettre en ligne
                  </span>
                )}
              </div>
            )}
          </section>

          <button type="submit" disabled={!inventoryReady || saving || !form.name.trim() || (form.publicationConsent && form.publishedCartularyIds.length === 0)}>
            <Save aria-hidden="true" />
            {saving
              ? 'Enregistrement…'
              : form.publicationConsent && form.publishedCartularyIds.length === 0
                ? 'Sélectionnez au moins un objet pour publier'
                : form.publicationConsent
                  ? 'Enregistrer et publier'
                  : 'Enregistrer'}
          </button>
          </fieldset>
        </form>
      )}

      <div className="registry-collection-grid">
        {rows.map(({ id, document, items: collectionItems }) => {
          const websitePublished = document ? collectionWebsiteIsPublished(document) : false;
          const publishedCount = websitePublished ? document?.publishedCartularyIds?.length || 0 : 0;
          return (
            <article key={id}>
              <header><Layers3 aria-hidden="true" /><div><span>{document?.status === 'archived' ? 'Archivée' : websitePublished ? 'Mini-site publié' : document?.status === 'published' ? 'Publication à confirmer' : 'Collection active'}</span><h2>{document?.name || labelFromIdentifier(id)}</h2></div><strong>{collectionItems.length}</strong></header>
              {document?.description && <p>{document.description}</p>}
              <dl>
                <div><dt>État interne</dt><dd>{document?.status === 'archived' ? 'Archivée' : 'Active dans le Registre'}</dd></div>
                <div><dt>Mini-site</dt><dd>{websitePublished ? 'Publié sur le Web' : 'Non publié'}</dd></div>
                <div><dt>Contenu public</dt><dd>{websitePublished ? `${publishedCount} objet${publishedCount > 1 ? 's' : ''} sélectionné${publishedCount > 1 ? 's' : ''}` : 'Aucun objet exposé'}</dd></div>
              </dl>
              {websitePublished && <div className="registry-collection-card__url"><Globe2 aria-hidden="true" /><span>{`${window.location.origin}${collectionWebsitePath(registry.id, id)}`}</span></div>}
              <footer>
                <a href={`/registry/${encodeURIComponent(registry.id)}/items?collection=${encodeURIComponent(id)}`}>Voir les objets <ExternalLink aria-hidden="true" /></a>
                {websitePublished && <button type="button" onClick={() => void copyWebsiteUrl(id)}><Copy aria-hidden="true" />{copiedCollectionId === id ? 'URL copiée' : 'Copier l’URL'}</button>}
                {websitePublished && <a href={collectionWebsitePath(registry.id, id)} target="_blank" rel="noreferrer"><Globe2 aria-hidden="true" />Accéder au mini-site</a>}
                {canManage && document && <button type="button" disabled={!inventoryReady || busy} onClick={() => startEdit(document, id)}><Pencil aria-hidden="true" />Modifier</button>}
                {!document && <span>Collection indisponible : réaffectez ses objets à une Collection existante.</span>}
                {canManage && document && <button type="button" onClick={() => void remove(document, collectionItems.length)} disabled={!inventoryReady || busy || collectionItems.length > 0 || (websitePublished && !canPublish)} title={websitePublished && !canPublish ? 'Le droit de publication est requis pour retirer ce mini-site.' : collectionItems.length > 0 ? 'Réaffectez les objets avant de supprimer la collection.' : undefined}><Trash2 aria-hidden="true" />Supprimer</button>}
              </footer>
            </article>
          );
        })}
        {inventoryReady && rows.length === 0 && <div className="registry-collections__empty"><Archive aria-hidden="true" /><h2>Aucune collection</h2>{canManage && <button type="button" onClick={startCreate}>Créer la première collection</button>}</div>}
      </div>
    </section>
  );
}
