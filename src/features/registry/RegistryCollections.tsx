import { useEffect, useMemo, useState } from 'react';
import { Archive, Check, Copy, ExternalLink, Globe2, Layers3, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import {
  collectionWebsiteIsPublished,
  collectionWebsitePath,
  type RegistryCollectionDocument,
  type RegistryCollectionInput,
} from '../../domain/collections.ts';
import type { RegistryDocument } from '../../domain/foundations.ts';
import { registryItemCollectionIds, type RegistryItemProjection } from '../../domain/projections.ts';
import { deleteRegistryCollection, normalizeCollectionSlug, observeRegistryCollections, saveRegistryCollection } from '../../services/collections.ts';
import { observeRegistryItems } from '../../services/projections.ts';
import { labelFromIdentifier } from './registryPresentation.ts';

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

export function RegistryCollections({ registry, canManage }: { registry: RegistryDocument; canManage: boolean }) {
  const [collections, setCollections] = useState<RegistryCollectionDocument[]>([]);
  const [items, setItems] = useState<RegistryItemProjection[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RegistryCollectionInput>(emptyInput);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedCollectionId, setCopiedCollectionId] = useState<string | null>(null);

  useEffect(() => observeRegistryCollections(registry.id, setCollections, () => setError('Les collections enregistrées ne sont pas disponibles.')), [registry.id]);
  useEffect(() => observeRegistryItems(registry.id, setItems, () => setItems([])), [registry.id]);

  const rows = useMemo(() => {
    const documents = new Map(collections.map((entry) => [entry.id, entry]));
    const identifiers = new Set([...documents.keys(), ...items.flatMap(registryItemCollectionIds)]);
    return [...identifiers].map((id) => ({
      id,
      document: documents.get(id) || null,
      items: items.filter((item) => registryItemCollectionIds(item).includes(id) && item.projectionStatus === 'active'),
    })).sort((left, right) => (left.document?.name || labelFromIdentifier(left.id)).localeCompare(right.document?.name || labelFromIdentifier(right.id), 'fr'));
  }, [collections, items]);

  const startEdit = (document: RegistryCollectionDocument | null, id: string) => {
    const name = document?.name || labelFromIdentifier(id);
    setEditingId(id);
    setForm(document ? {
      name: document.name,
      description: document.description,
      websiteTitle: document.websiteTitle,
      websiteSlug: document.websiteSlug,
      status: document.status,
      visibility: document.visibility,
      publicationConsent: document.publicationConsent === true,
      publishedCartularyIds: document.publishedCartularyIds || [],
    } : { ...emptyInput(), name, websiteTitle: name, websiteSlug: normalizeCollectionSlug(name) });
    setError(null);
  };

  const startCreate = () => {
    setEditingId('');
    setForm(emptyInput());
    setError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) return;
    if (form.publicationConsent && form.publishedCartularyIds.length === 0) {
      setError('Sélectionnez au moins un objet avant de publier le mini-site.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveRegistryCollection({
        id: editingId || undefined,
        organizationId: registry.organizationId,
        registryId: registry.id,
        input: { ...form, name: form.name.trim(), websiteTitle: form.websiteTitle.trim() || form.name.trim() },
      });
      setEditingId(null);
      setForm(emptyInput());
    } catch {
      setError('Enregistrement impossible. Vérifiez vos droits puis réessayez.');
    } finally {
      setSaving(false);
    }
  };

  const editingCollectionItems = editingId === null || editingId === ''
    ? []
    : items.filter((item) => registryItemCollectionIds(item).includes(editingId) && item.projectionStatus === 'active');

  const togglePublishedItem = (cartularyId: string) => {
    setForm((current) => ({
      ...current,
      publishedCartularyIds: current.publishedCartularyIds.includes(cartularyId)
        ? current.publishedCartularyIds.filter((id) => id !== cartularyId)
        : [...current.publishedCartularyIds, cartularyId],
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

  const remove = async (id: string, itemCount: number) => {
    if (itemCount > 0 || !window.confirm('Supprimer cette collection vide ?')) return;
    try {
      await deleteRegistryCollection(registry.id, id);
    } catch {
      setError('La collection n’a pas pu être supprimée.');
    }
  };

  return (
    <section className="registry-collections" aria-labelledby="registry-collections-title">
      <header className="registry-page-heading">
        <div><p className="registry-kicker">Organisation du Registre</p><h1 id="registry-collections-title">Collections</h1></div>
        {canManage && <button type="button" className="registry-collections__create" onClick={startCreate}><Plus aria-hidden="true" />Créer une collection</button>}
      </header>

      {error && <p className="registry-form-error" role="alert">{error}</p>}

      {editingId !== null && (
        <form className="registry-collection-form" onSubmit={submit}>
          <header><div><span>{editingId ? 'Modifier' : 'Nouvelle collection'}</span><h2>{editingId ? form.name : 'Créer une collection'}</h2></div><button type="button" onClick={() => setEditingId(null)} aria-label="Fermer"><X aria-hidden="true" /></button></header>
          <div>
            <label>Nom<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value, websiteSlug: current.websiteSlug || normalizeCollectionSlug(event.target.value) }))} required /></label>
            <label>Titre du site<input value={form.websiteTitle} onChange={(event) => setForm((current) => ({ ...current, websiteTitle: event.target.value }))} placeholder={form.name || 'Titre public'} /></label>
            <label>Adresse du site<input value={form.websiteSlug} onChange={(event) => setForm((current) => ({ ...current, websiteSlug: normalizeCollectionSlug(event.target.value) }))} required /></label>
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
                  disabled={form.status === 'archived' || editingId === '' || editingCollectionItems.length === 0}
                  onChange={(event) => setForm((current) => ({
                    ...current,
                    publicationConsent: event.target.checked,
                    status: event.target.checked ? 'published' : 'draft',
                    visibility: event.target.checked ? 'public' : 'secret',
                  }))}
                />
                <span>{form.publicationConsent ? 'Publication du mini-site confirmée' : 'Je confirme la publication du mini-site'}</span>
              </label>
            </header>
            <p><strong>L’état interne</strong> sert à gérer la Collection dans votre Registre. <strong>La publication</strong> rend publique une projection séparée contenant uniquement les objets cochés ci-dessous.</p>

            {editingId === '' ? (
              <p className="registry-collection-publication__notice">Enregistrez d’abord la nouvelle Collection ; vous pourrez ensuite choisir les objets et publier son mini-site.</p>
            ) : editingCollectionItems.length > 0 ? (
              <fieldset>
                <legend>Objets à afficher sur le mini-site</legend>
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
                <label><span>Adresse publique</span><input value={`${window.location.origin}${collectionWebsitePath(registry.id, editingId)}`} readOnly /></label>
                <button type="button" onClick={() => void copyWebsiteUrl(editingId)}><Copy aria-hidden="true" />{copiedCollectionId === editingId ? 'Copiée' : 'Copier'}</button>
                <a href={collectionWebsitePath(registry.id, editingId)} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />Accéder au mini-site</a>
              </div>
            )}
          </section>

          <button type="submit" disabled={saving || !form.name.trim() || (form.publicationConsent && form.publishedCartularyIds.length === 0)}><Save aria-hidden="true" />{saving ? 'Enregistrement…' : form.publicationConsent ? 'Enregistrer et publier' : 'Enregistrer'}</button>
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
                {canManage && <button type="button" onClick={() => startEdit(document, id)}><Pencil aria-hidden="true" />{document ? 'Modifier' : 'Configurer'}</button>}
                {canManage && document && <button type="button" onClick={() => void remove(id, collectionItems.length)} disabled={collectionItems.length > 0} title={collectionItems.length > 0 ? 'Réaffectez les objets avant de supprimer la collection.' : undefined}><Trash2 aria-hidden="true" />Supprimer</button>}
              </footer>
            </article>
          );
        })}
        {rows.length === 0 && <div className="registry-collections__empty"><Archive aria-hidden="true" /><h2>Aucune collection</h2>{canManage && <button type="button" onClick={startCreate}>Créer la première collection</button>}</div>}
      </div>
    </section>
  );
}
