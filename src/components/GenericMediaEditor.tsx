import { useState } from 'react';
import type { Asset, MediaTag } from '../types';
import type { GenericMediaMutation } from '../services/genericCartulary';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';

const roles: Array<[MediaTag, string]> = [['main-photo', 'Photo de couverture'], ['main-video', 'Vidéo principale'], ['spin-3d', 'Vue 360°'], ['slideshow', 'Diaporama'], ['accessories', 'Accessoires'], ['documentation', 'Documents'], ['other', 'Autres']];
export function GenericMediaEditor({ assets, canPublish, onSave, onUpload }: { assets: Asset[]; canPublish: boolean;
  onSave: (mutation: GenericMediaMutation) => Promise<void>; onUpload: (file: File, progress: (message: string) => void) => Promise<Asset> }) {
  const [target, setTarget] = useState<Asset | 'new' | null>(null);
  const [name, setName] = useState(''); const [tags, setTags] = useState<MediaTag[]>([]);
  const [visibility, setVisibility] = useState<Asset['visibility']>('Secret');
  const [file, setFile] = useState<File | null>(null); const [uploaded, setUploaded] = useState<Asset | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const existing = target && target !== 'new' ? target : null;
  const dirty = busy || (target !== null && (Boolean(file) || name !== (existing?.name || '') || visibility !== (existing?.visibility || 'Secret') || JSON.stringify(tags) !== JSON.stringify(existing?.tags || [])));
  const { confirmDiscard } = useUnsavedChangesGuard(dirty, { busy, onDiscard: () => { setTarget(null); setFile(null); setUploaded(null); } });
  const open = (asset: Asset | 'new') => { if (!confirmDiscard()) return; setTarget(asset); setName(asset === 'new' ? '' : asset.name); setTags(asset === 'new' ? [] : asset.tags); setVisibility(asset === 'new' ? 'Secret' : asset.visibility); setFile(null); setUploaded(null); setError(''); setMessage(''); };
  const save = async () => {
    if (!target || busy || !name.trim() || (target === 'new' && !file)) return;
    if (file && existing && !window.confirm(`Remplacer « ${existing.name} » par un nouveau fichier ? L’ancien original sera conservé en privé mais retiré du Cartulaire actif. Si le mini-site est publié, retirez-le d’abord.`)) return;
    if (visibility === 'Tous' && (!existing || existing.visibility !== 'Tous' || file) && !window.confirm('Autoriser ce média à être sélectionné pour un mini-site public ? L’original reste privé ; la mise en ligne nécessitera encore votre confirmation dans Publication.')) return;
    setBusy(true); setError(''); setMessage('');
    try {
      let next = uploaded;
      if (file && !next) { next = await onUpload(file, setMessage); setUploaded(next); }
      const id = next?.id || existing!.id;
      await onSave({ changes: [{ id, name: name.trim(), tags, visibility, ...(next ? { binaryId: next.binaryId } : {}) }],
        removeIds: file && existing ? [existing.id] : [], confirmedRemoval: Boolean(file && existing), confirmedPublicIds: visibility === 'Tous' ? [id] : [] });
      setTarget(null); setFile(null); setUploaded(null); setMessage('Média enregistré dans le Cartulaire. Aucun original privé n’a été supprimé.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Enregistrement impossible. Votre saisie est conservée.'); }
    finally { setBusy(false); }
  };
  const remove = async (asset: Asset) => {
    if (!confirmDiscard() || !window.confirm(`Retirer « ${asset.name} » du Cartulaire actif ? Son original privé sera conservé. Si un mini-site est publié, retirez-le d’abord dans Publication.`)) return;
    setBusy(true); setError('');
    try { await onSave({ changes: [], removeIds: [asset.id], confirmedRemoval: true }); setTarget(null); setMessage('Média retiré du Cartulaire actif. Original privé conservé.'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Retrait non confirmé. Réessayez.'); }
    finally { setBusy(false); }
  };
  return <section className="generic-media-editor" aria-label="Enrichir les médias"><h3>Enrichir les médias</h3>
    <p>Ajout, remplacement et classement utilisent la vérification serveur. « Tous » autorise une sélection future ; cela ne met pas le fichier en ligne. Les originaux restent privés et conservés lors d’un retrait.</p>
    <button type="button" disabled={busy} onClick={() => open('new')}>Ajouter un média</button>
    {assets.map((asset) => <p key={asset.id}>{asset.name} · Autorisation : {asset.visibility} <button type="button" disabled={busy} onClick={() => open(asset)}>Modifier {asset.name}</button> <button type="button" disabled={busy} onClick={() => void remove(asset)}>Retirer {asset.name}</button></p>)}
    {target && <fieldset disabled={busy}><legend>{target === 'new' ? 'Nouveau média' : `Modifier ${existing!.name}`}</legend>
      <label>Fichier {existing ? 'de remplacement (facultatif)' : '(requis)'}<input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,application/pdf" onChange={(event) => { const next = event.target.files?.[0] || null; setFile(next); setUploaded(null); if (next) { setName(next.name); setVisibility('Secret'); setTags(next.type.startsWith('image/') ? ['slideshow'] : next.type.startsWith('video/') ? ['main-video'] : ['documentation']); } }} /></label>
      <label>Nom du média<input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} /></label>
      <fieldset><legend>Rôles du média</legend>{roles.map(([tag, label]) => <label key={tag}><input type="checkbox" checked={tags.includes(tag)} onChange={(event) => setTags((current) => event.target.checked ? [...current, tag] : current.filter((value) => value !== tag))} />{label}</label>)}</fieldset>
      <label>Autorisation de diffusion<select value={visibility} onChange={(event) => setVisibility(event.target.value as Asset['visibility'])}><option value="Secret">Secret</option><option value="Communauté">Cercle (publication distincte)</option>{canPublish && <option value="Tous">Tous (sélection publique autorisée)</option>}</select></label>
      <button type="button" disabled={busy || !name.trim() || (target === 'new' && !file)} onClick={() => void save()}>Enregistrer le média</button>
      <button type="button" disabled={busy} onClick={() => { if (confirmDiscard()) setTarget(null); }}>Annuler la modification média</button>
    </fieldset>}
    {busy && <p role="status">{message || 'Enregistrement en cours…'}</p>}{!busy && message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
