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
import { activeRegistryCollections, defaultActiveCollectionId } from '../../domain/collections.ts';
import { SUPPORTED_CREATION_PROFILES, resumeOrCreateCartulary, type SupportedCreationAssetType, type CartularyCreationResult } from '../../domain/cartularyCreation.ts';
import { validateFileForUpload } from '../../security/fileValidation.ts';
import {
  CartularyCreationFailedError,
  createCartulary,
  waitForCartularyCreation,
  type CartularyCreationProgress,
} from '../../services/cartularyCreation.ts';
import { buildCartularyHref } from './registryCatalog.ts';
import { registryHref } from './registryRouting.ts';
import { useRegistryCollections } from './useRegistryCollections.ts';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';

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
  const [submittedIdentity, setSubmittedIdentity] = useState<{ title: string; assetType: SupportedCreationAssetType } | null>(null);
  const { collections: allCollections, state: collectionsState, retry: retryCollections } = useRegistryCollections(registry.id);
  const collections = useMemo(() => activeRegistryCollections(allCollections), [allCollections]);
  const [assetType, setAssetType] = useState<SupportedCreationAssetType>('watch');
  const creationDefinition = SUPPORTED_CREATION_PROFILES[assetType];
  const [form, setForm] = useState({
    brand: '',
    model: '',
    reference: '',
    manufactureYear: '',
    serialNumber: '',
    caliber: '',
    collectionId: '',
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
  const dirty = !createdCartularyId && (submitting || Boolean(coverFile || files.length || pendingCreation) || assetType !== 'watch'
    || Object.entries(form).some(([key, value]) => key !== 'collectionId' && value !== (key === 'currency' ? 'EUR' : key === 'sourceLabel' ? 'Dossier transmis par le propriétaire' : '')));
  useUnsavedChangesGuard(dirty, { busy: submitting, message: pendingCreation ? 'Une création a déjà été demandée. Quitter abandonne cet écran de reprise ; vérifiez ensuite le Catalogue avant de créer à nouveau. Continuer ?' : undefined });
  useEffect(() => {
    if (collectionsState === 'ready' && !submitting && !pendingCreation) setForm((current) => ({ ...current, collectionId: defaultActiveCollectionId(allCollections, current.collectionId) }));
  }, [allCollections, collectionsState, submitting, pendingCreation]);
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
    if (submitting || (!pendingCreation && (!coverFile || !form.brand.trim() || !form.model.trim() || !form.reference.trim() || !form.collectionId || collectionsState !== 'ready'))) return;
    if (!pendingCreation) setSubmittedIdentity({ title: `${form.brand.trim()} ${form.model.trim()}`, assetType });
    setSubmitting(true);
    setError(null);
    setCreatedCartularyId(null);
    try {
      const result = await resumeOrCreateCartulary(pendingCreation, () => createCartulary({
        assetType,
        user,
        organizationId: organization.id,
        registryId: registry.id,
        coverFile: coverFile!,
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
        <h1 id="registry-create-success-title">{submittedIdentity?.title}</h1>
        <p>Le Cartulaire privé a été créé et sa projection minimale a été ajoutée à {registry.name}. Les fichiers restent secrets.</p>
        <div className="registry-create-success__actions">
          <a href={buildCartularyHref(createdCartularyId, registryHref(registry.id, 'items'), submittedIdentity?.assetType || assetType)}>Ouvrir le Cartulaire</a>
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
          <p>Créez un dossier privé distinct. Les informations et fichiers sont secrets par défaut ; vos déclarations restent à vérifier.</p>
        </div>
        <div className="registry-create__privacy"><ShieldCheck aria-hidden="true" /><span>Secret par défaut</span></div>
      </header>

      <form className="registry-create-form" onSubmit={handleSubmit}>
        {pendingCreation && <p role="status">La demande a déjà été envoyée. Ses informations sont figées : vérifiez son résultat ci-dessous sans créer un second objet.</p>}
        <fieldset className="registry-create-form__fields" disabled={submitting || Boolean(pendingCreation)}>
        <label className="registry-create-wide"><span>Type d’objet</span><select value={assetType} disabled={submitting || Boolean(pendingCreation)} onChange={(event) => setAssetType(event.target.value as SupportedCreationAssetType)}>{Object.entries(SUPPORTED_CREATION_PROFILES).map(([id, definition]) => <option key={id} value={id}>{definition.label}</option>)}</select></label>
        <p>Types actuellement pris en charge : montres et automobiles. Les informations propres à chaque type suivent son modèle de dossier.</p>
        {assetType === 'car' && <p>Après création, vous pourrez compléter les caractéristiques, entretiens et incidents, ajouter ou remplacer des médias, choisir leurs rôles et préparer une publication. Les champs calculés et l’historique personnel des propriétaires restent en lecture seule ici ; le Coffre reste un espace séparé. Les téléchargements privés et les copies publiques dépendent de la vérification serveur des fichiers.</p>}
        {collectionsState !== 'ready' && <div role={collectionsState === 'error' ? 'alert' : 'status'}><p>{collectionsState === 'error' ? 'Les Collections n’ont pas pu être chargées.' : 'Chargement des Collections…'}</p>{collectionsState === 'error' && <button type="button" onClick={retryCollections}>Réessayer</button>}</div>}
        {collectionsState === 'ready' && collections.length === 0 && <p role="status">Créez d’abord une Collection active pour y ranger l’objet. <a href={registryHref(registry.id, 'collections')}>Créer une Collection</a></p>}
        <section className="registry-create-card">
          <header><span>01</span><div><h2>Identifier l’objet</h2><p>Les champs marqués d’un astérisque sont requis pour ce type d’objet.</p></div><Package aria-hidden="true" /></header>
          <div className="registry-create-grid registry-create-grid--three">
            <label><span>{creationDefinition.makerLabel} *</span><input name="brand" value={form.brand} onChange={(event) => update('brand', event.target.value)} required /></label>
            <label><span>Modèle *</span><input name="model" value={form.model} onChange={(event) => update('model', event.target.value)} required /></label>
            <label><span>{creationDefinition.referenceLabel} *</span><input name="reference" value={form.reference} onChange={(event) => update('reference', event.target.value)} required /></label>
            <label><span>Année{assetType === 'car' ? ' *' : ''}</span><input name="manufactureYear" type="number" min={creationDefinition.minYear} max={new Date().getFullYear() + 1} required={assetType === 'car'} value={form.manufactureYear} onChange={(event) => update('manufactureYear', event.target.value)} /></label>
            <label><span>{creationDefinition.serialLabel}{assetType === 'car' ? ' *' : ''}</span><input name="serialNumber" value={form.serialNumber} required={assetType === 'car'} onChange={(event) => update('serialNumber', event.target.value)} /></label>
            <label><span>{creationDefinition.technicalLabel}</span><input name="caliber" value={form.caliber} onChange={(event) => update('caliber', event.target.value)} /></label>
            <label><span>Collection</span><select name="collectionId" value={form.collectionId} disabled={collectionsState !== 'ready' || collections.length === 0} onChange={(event) => update('collectionId', event.target.value)} required><option value="">Choisir une Collection</option>{collections.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
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
          <header><span>03</span><div><h2>Documenter l’acquisition et la valeur</h2><p>Facultatif. Les montants alimentent vos vues privées du Registre ; ils ne sont pas publiés sur les mini-sites.</p></div><LockKeyhole aria-hidden="true" /></header>
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

        </fieldset>
        {progress && submitting && (
          <section className="registry-create-progress" aria-live="polite">
            <div><LoaderCircle className="registry-spinner" aria-hidden="true" /><span>{progressLabel(progress)}</span><strong>{progressPercent}%</strong></div>
            <progress value={progressPercent} max="100">{progressPercent}%</progress>
            <small>{fileSize(progress.uploadedBytes)} sur {fileSize(progress.totalBytes)} téléversés</small>
          </section>
        )}
        {error && <p className="registry-create-error" role="alert">{error}</p>}

        <footer className="registry-create-actions">
          <div><ShieldCheck aria-hidden="true" /><span>Le Registre reçoit une projection minimale, sans numéro de série ni chemin de fichier. Les montants restent dans vos vues privées du Registre.</span></div>
          <button type="submit" disabled={submitting || (!pendingCreation && (collectionsState !== 'ready' || !form.collectionId || !coverFile || !form.brand.trim() || !form.model.trim() || !form.reference.trim()))}>
            {submitting ? <LoaderCircle className="registry-spinner" aria-hidden="true" /> : <Plus aria-hidden="true" />}
            {submitting ? 'Création en cours…' : pendingCreation ? 'Vérifier la création en cours' : 'Créer le Cartulaire'}
          </button>
        </footer>
      </form>
    </section>
  );
}
