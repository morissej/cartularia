import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import {
  ArrowLeft,
  CircleCheck,
  FileArchive,
  ImagePlus,
  LoaderCircle,
  LockKeyhole,
  Plus,
  ShieldCheck,
  UploadCloud,
  Package,
} from 'lucide-react';
import type { OrganizationDocument, RegistryDocument } from '../../domain/foundations.ts';
import type { RegistryCollectionDocument } from '../../domain/collections.ts';
import { resumeOrCreateCartulary, type CartularyCreationResult } from '../../domain/cartularyCreation.ts';
import { validateFileForUpload } from '../../security/fileValidation.ts';
import {
  CartularyCreationFailedError,
  createWatchCartulary,
  waitForCartularyCreation,
  type CartularyCreationProgress,
} from '../../services/cartularyCreation.ts';
import { buildCartularyHref } from './registryCatalog.ts';
import { registryHref } from './registryRouting.ts';
import { loadRegistryCollections } from '../../services/collections.ts';

const fileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / 1024 ** 2).toFixed(1)} Mo`;
};

const progressLabel = (progress: CartularyCreationProgress | null) => {
  if (!progress) return '';
  if (progress.phase === 'preparing') return 'Préparation du brouillon privé…';
  if (progress.phase === 'hashing') return `Calcul de l’empreinte · ${progress.fileName}`;
  if (progress.phase === 'uploading') return `Téléversement ${progress.completedFiles + 1}/${progress.totalFiles} · ${progress.fileName}`;
  if (progress.phase === 'verifying') return `Vérification du fichier… · ${progress.fileName}`;
  if (progress.phase === 'finalizing') return 'Enregistrement des métadonnées privées…';
  return 'Création autoritaire et raccordement au Registre…';
};

export function NewCartularyPage({ user, organization, registry }: {
  user: User;
  organization: OrganizationDocument;
  registry: RegistryDocument;
}) {
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<CartularyCreationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createdCartularyId, setCreatedCartularyId] = useState<string | null>(null);
  const [pendingCreation, setPendingCreation] = useState<CartularyCreationResult | null>(null);
  const [collections, setCollections] = useState<RegistryCollectionDocument[]>([]);
  const [form, setForm] = useState({
    brand: '',
    model: '',
    reference: '',
    manufactureYear: '',
    serialNumber: '',
    caliber: '',
    collectionId: 'col_pilots',
    description: '',
    conditionSummary: '',
    purchaseDate: '',
    purchasePrice: '',
    currency: 'EUR',
    seller: '',
    valuationDate: '',
    valuationLow: '',
    valuationMid: '',
    valuationHigh: '',
    sourceLabel: 'Dossier transmis par le propriétaire',
  });
  useEffect(() => {
    let active = true;
    void loadRegistryCollections(registry.id).then((items) => {
      if (!active) return;
      setCollections(items.filter((item) => item.status !== 'archived'));
      if (items.length > 0) setForm((current) => ({ ...current, collectionId: items.some((item) => item.id === current.collectionId) ? current.collectionId : items[0].id }));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [registry.id]);
  const allFileCount = useMemo(() => {
    const identities = new Set([coverFile, ...files].filter(Boolean).map((file) => `${file!.name}\u0000${file!.size}\u0000${file!.lastModified}`));
    return identities.size;
  }, [coverFile, files]);
  const totalBytes = useMemo(() => {
    const unique = new Map<string, File>();
    for (const file of [coverFile, ...files]) {
      if (file) unique.set(`${file.name}\u0000${file.size}\u0000${file.lastModified}`, file);
    }
    return [...unique.values()].reduce((sum, file) => sum + file.size, 0);
  }, [coverFile, files]);
  const progressPercent = progress && progress.totalBytes > 0
    ? Math.min(100, Math.round((progress.uploadedBytes / progress.totalBytes) * 100))
    : 0;

  const update = (field: keyof typeof form, value: string) => setForm((current) => ({ ...current, [field]: value }));
  const numberOrNull = (value: string) => value.trim() ? Number(value) : null;

  const selectCoverFile = async (file: File | null) => {
    setError(null);
    if (!file) return setCoverFile(null);
    try {
      await validateFileForUpload({ blob: file, fileName: file.name, declaredMimeType: file.type, expectedKind: 'image' });
      setCoverFile(file);
    } catch (caught) {
      setCoverFile(null);
      setError(caught instanceof Error ? caught.message : 'Photo de couverture refusée.');
    }
  };

  const selectDossierFiles = async (selectedFiles: File[]) => {
    setError(null);
    try {
      await Promise.all(selectedFiles.map((file) => validateFileForUpload({
        blob: file,
        fileName: file.name,
        declaredMimeType: file.type,
      })));
      setFiles(selectedFiles);
    } catch (caught) {
      setFiles([]);
      setError(caught instanceof Error ? caught.message : 'Un fichier du dossier a été refusé.');
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!coverFile || !form.brand.trim() || !form.model.trim() || !form.reference.trim()) return;
    setSubmitting(true);
    setError(null);
    setCreatedCartularyId(null);
    try {
      const result = await resumeOrCreateCartulary(pendingCreation, () => createWatchCartulary({
        user,
        organizationId: organization.id,
        registryId: registry.id,
        coverFile,
        files,
        onProgress: setProgress,
        profile: {
          collectionId: form.collectionId.trim(),
          brand: form.brand.trim(),
          model: form.model.trim(),
          reference: form.reference.trim(),
          manufactureYear: numberOrNull(form.manufactureYear),
          serialNumber: form.serialNumber.trim(),
          caliber: form.caliber.trim(),
          description: form.description.trim(),
          conditionSummary: form.conditionSummary.trim(),
          purchaseDate: form.purchaseDate,
          purchasePrice: numberOrNull(form.purchasePrice),
          currency: form.currency.trim().toUpperCase() || 'EUR',
          seller: form.seller.trim(),
          valuationDate: form.valuationDate,
          valuationLow: numberOrNull(form.valuationLow),
          valuationMid: numberOrNull(form.valuationMid),
          valuationHigh: numberOrNull(form.valuationHigh),
          sourceLabel: form.sourceLabel.trim(),
        },
      }));
      setPendingCreation(result);
      await waitForCartularyCreation(result.cartularyId);
      setCreatedCartularyId(result.cartularyId);
    } catch (caught) {
      if (caught instanceof CartularyCreationFailedError) setPendingCreation(null);
      setError(caught instanceof Error ? caught.message : 'Création impossible. Le brouillon privé reste conservé.');
    } finally {
      setSubmitting(false);
    }
  };

  if (createdCartularyId) {
    return (
      <section className="registry-create-success" aria-labelledby="registry-create-success-title">
        <CircleCheck aria-hidden="true" />
        <p className="registry-kicker">Cartulaire créé</p>
        <h1 id="registry-create-success-title">{form.brand} {form.model}</h1>
        <p>Le Cartulaire privé a été créé et sa projection minimale a été ajoutée à {registry.name}. Les fichiers restent secrets.</p>
        <div className="registry-create-success__actions">
          <a href={buildCartularyHref(createdCartularyId, registryHref(registry.id, 'items'), 'watch')}>Ouvrir le Cartulaire</a>
          <a href={registryHref(registry.id, 'items')}>Voir le catalogue</a>
        </div>
      </section>
    );
  }

  return (
    <section className="registry-create" aria-labelledby="registry-create-title">
      <header className="registry-page-heading registry-create__heading">
        <div>
          <a className="registry-create__back" href={registryHref(registry.id, 'items')}><ArrowLeft aria-hidden="true" /> Catalogue</a>
          <p className="registry-kicker">Nouveau cartulaire</p>
          <h1 id="registry-create-title">Ajouter un objet</h1>
          <p>Créez un dossier privé distinct. Les informations et fichiers sont secrets par défaut et devront être revus après import.</p>
        </div>
        <div className="registry-create__privacy"><ShieldCheck aria-hidden="true" /><span>Secret par défaut</span></div>
      </header>

      <form className="registry-create-form" onSubmit={handleSubmit}>
        <section className="registry-create-card">
          <header><span>01</span><div><h2>Identifier l’objet</h2><p>Ces trois informations permettent de distinguer le nouveau Cartulaire.</p></div><Package aria-hidden="true" /></header>
          <div className="registry-create-grid registry-create-grid--three">
            <label><span>Marque *</span><input name="brand" value={form.brand} onChange={(event) => update('brand', event.target.value)} required /></label>
            <label><span>Modèle *</span><input name="model" value={form.model} onChange={(event) => update('model', event.target.value)} required /></label>
            <label><span>Référence *</span><input name="reference" value={form.reference} onChange={(event) => update('reference', event.target.value)} required /></label>
            <label><span>Année</span><input name="manufactureYear" type="number" min="1500" max="2200" value={form.manufactureYear} onChange={(event) => update('manufactureYear', event.target.value)} /></label>
            <label><span>Numéro de série</span><input name="serialNumber" value={form.serialNumber} onChange={(event) => update('serialNumber', event.target.value)} /></label>
            <label><span>Calibre</span><input name="caliber" value={form.caliber} onChange={(event) => update('caliber', event.target.value)} /></label>
            <label><span>Collection</span><select name="collectionId" value={form.collectionId} onChange={(event) => update('collectionId', event.target.value)} required><option value={form.collectionId}>{collections.find((item) => item.id === form.collectionId)?.name || form.collectionId.replace(/^col_/, '').replace(/[_-]+/g, ' ')}</option>{collections.filter((item) => item.id !== form.collectionId).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          </div>
          <label className="registry-create-wide"><span>Description</span><textarea name="description" rows={4} value={form.description} onChange={(event) => update('description', event.target.value)} /></label>
          <label className="registry-create-wide"><span>État déclaré</span><textarea name="conditionSummary" rows={3} value={form.conditionSummary} onChange={(event) => update('conditionSummary', event.target.value)} /></label>
        </section>

        <section className="registry-create-card">
          <header><span>02</span><div><h2>Joindre le dossier</h2><p>Choisissez d’abord la photo de couverture, puis toutes les pièces à conserver.</p></div><FileArchive aria-hidden="true" /></header>
          <div className="registry-create-file-grid">
            <label className="registry-create-file">
              <ImagePlus aria-hidden="true" />
              <span><strong>Photo de couverture *</strong><small>JPG, PNG, HEIC ou WEBP</small></span>
              <input name="coverFile" type="file" accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif" required onChange={(event) => void selectCoverFile(event.target.files?.[0] || null)} />
              {coverFile && <em>{coverFile.name} · {fileSize(coverFile.size)}</em>}
            </label>
            <label className="registry-create-file">
              <UploadCloud aria-hidden="true" />
              <span><strong>Photos, vidéos et documents</strong><small>Sélection multiple · originaux privés</small></span>
              <input name="dossierFiles" type="file" accept=".jpg,.jpeg,.png,.webp,.heic,.heif,.mp4,.m4v,.mov,.pdf" multiple onChange={(event) => void selectDossierFiles(Array.from(event.target.files || []))} />
              {files.length > 0 && <em>{files.length} fichier{files.length > 1 ? 's' : ''} sélectionné{files.length > 1 ? 's' : ''}</em>}
            </label>
          </div>
          {allFileCount > 0 && <p className="registry-create-file-summary"><strong>{allFileCount}</strong> fichier{allFileCount > 1 ? 's' : ''} distinct{allFileCount > 1 ? 's' : ''} · {fileSize(totalBytes)}</p>}
        </section>

        <section className="registry-create-card">
          <header><span>03</span><div><h2>Documenter l’acquisition et la valeur</h2><p>Facultatif. Ces données ne figurent jamais dans la projection du Registre.</p></div><LockKeyhole aria-hidden="true" /></header>
          <div className="registry-create-grid registry-create-grid--three">
            <label><span>Date d’achat</span><input name="purchaseDate" type="date" value={form.purchaseDate} onChange={(event) => update('purchaseDate', event.target.value)} /></label>
            <label><span>Prix d’achat</span><input name="purchasePrice" type="number" min="0" step="0.01" value={form.purchasePrice} onChange={(event) => update('purchasePrice', event.target.value)} /></label>
            <label><span>Devise</span><input name="currency" maxLength={3} value={form.currency} onChange={(event) => update('currency', event.target.value)} /></label>
            <label><span>Vendeur</span><input name="seller" value={form.seller} onChange={(event) => update('seller', event.target.value)} /></label>
            <label><span>Date de valorisation</span><input name="valuationDate" type="date" value={form.valuationDate} onChange={(event) => update('valuationDate', event.target.value)} /></label>
            <label><span>Valeur basse</span><input name="valuationLow" type="number" min="0" step="0.01" value={form.valuationLow} onChange={(event) => update('valuationLow', event.target.value)} /></label>
            <label><span>Valeur médiane</span><input name="valuationMid" type="number" min="0" step="0.01" value={form.valuationMid} onChange={(event) => update('valuationMid', event.target.value)} /></label>
            <label><span>Valeur haute</span><input name="valuationHigh" type="number" min="0" step="0.01" value={form.valuationHigh} onChange={(event) => update('valuationHigh', event.target.value)} /></label>
            <label><span>Source déclarée</span><input name="sourceLabel" value={form.sourceLabel} onChange={(event) => update('sourceLabel', event.target.value)} /></label>
          </div>
        </section>

        {progress && submitting && (
          <section className="registry-create-progress" aria-live="polite">
            <div><LoaderCircle className="registry-spinner" aria-hidden="true" /><span>{progressLabel(progress)}</span><strong>{progressPercent}%</strong></div>
            <progress value={progressPercent} max="100">{progressPercent}%</progress>
            <small>{fileSize(progress.uploadedBytes)} sur {fileSize(progress.totalBytes)} téléversés</small>
          </section>
        )}
        {error && <p className="registry-create-error" role="alert">{error}</p>}

        <footer className="registry-create-actions">
          <div><ShieldCheck aria-hidden="true" /><span>Le Registre ne recevra qu’une projection minimale sans numéro de série, valeur ni chemin de fichier.</span></div>
          <button type="submit" disabled={submitting || !coverFile || !form.brand.trim() || !form.model.trim() || !form.reference.trim()}>
            {submitting ? <LoaderCircle className="registry-spinner" aria-hidden="true" /> : <Plus aria-hidden="true" />}
            {submitting ? 'Création en cours…' : 'Créer le Cartulaire'}
          </button>
        </footer>
      </form>
    </section>
  );
}
