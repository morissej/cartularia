import { privateBinaryIsVerified } from './private-upload-command.mjs';

const tags = new Set(['main-photo', 'main-video', 'spin-3d', 'slideshow', 'accessories', 'documentation', 'other']);
const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{3,160}$/.test(value);
export class GenericMediaError extends Error {
  constructor(code, message) { super(message); this.code = code; this.name = 'GenericMediaError'; }
}
const fail = (message, code = 'invalid_generic_media') => { throw new GenericMediaError(code, message); };

/** Explicit delta; omitted imported assets and private originals are never erased. */
export function applyGenericMediaChanges({ draft, root, existingAssets, binaries }) {
  if (draft?.version !== 1 || draft.baseRevision !== root.revision) fail('Le Cartulaire a changé. Rechargez les médias avant de réessayer.', 'revision_conflict');
  if (Object.keys(draft).some((key) => !['version', 'baseRevision', 'changes', 'removeIds', 'confirmedRemoval', 'confirmedPublicIds'].includes(key)) || (draft.confirmedPublicIds !== undefined && (!Array.isArray(draft.confirmedPublicIds) || draft.confirmedPublicIds.length > 100 || draft.confirmedPublicIds.some((id) => !identifier(id))))) fail('Confirmation de diffusion invalide.');
  if (!Array.isArray(draft.changes) || !Array.isArray(draft.removeIds) || draft.changes.length + draft.removeIds.length < 1 || draft.changes.length + draft.removeIds.length > 100) fail('La liste des modifications média est invalide.');
  const current = new Map([...existingAssets].filter(([, asset]) => asset.projectionStatus !== 'withdrawn').map(([id, asset]) => [id, {
    id, name: asset.displayName || id, type: asset.mediaKind, binaryId: asset.binaryId || null,
    originalFileName: asset.originalFileName || null, mimeType: asset.mimeDeclared || null,
    capturedAt: asset.capturedAt || null, timestampSource: asset.timestampSource || null,
    description: asset.description || null, category: asset.componentCode || null,
    tags: asset.tags || [], visibility: asset.requestedVisibility === 'public' ? 'Tous' : asset.requestedVisibility === 'community' ? 'Communauté' : 'Secret',
  }]));
  const seen = new Set();
  for (const id of draft.removeIds) {
    if (!identifier(id) || !current.has(id) || seen.has(id) || draft.confirmedRemoval !== true) fail('Confirmez les médias précis à retirer.');
    if (root.publicationStatus === 'published') fail('Retirez d’abord le mini-site public dans Publication avant de retirer ou remplacer un média.', 'publication_must_be_revoked');
    seen.add(id); current.delete(id);
  }
  for (const change of draft.changes) {
    if (!change || Object.keys(change).some((key) => !['id', 'name', 'tags', 'visibility', 'binaryId'].includes(key)) || !identifier(change.id) || seen.has(change.id)) fail('Modification média dupliquée ou non autorisée.');
    seen.add(change.id);
    const existing = current.get(change.id);
    if (!existing && existingAssets.has(change.id)) fail('Un média retiré ne peut pas être réactivé implicitement.');
    if (change.binaryId && existing && change.binaryId !== existing.binaryId) fail('Un remplacement doit créer un nouveau média et conserver l’ancien original.');
    const binaryId = change.binaryId || existing?.binaryId;
    const binary = binaryId ? binaries.get(binaryId) : null;
    if (!existing && (!identifier(binaryId) || !privateBinaryIsVerified(binary) || binary.verificationStatus !== 'accepted' || !['media', 'condition_attachment'].includes(binary.kind) || binary.cartularyId !== root.id || binary.ownerUid !== root.accountHolderId)) fail('Le nouveau fichier doit être vérifié dans le brouillon privé de cet objet.');
    const type = existing?.type || (binary.mimeType?.startsWith('image/') ? 'image' : binary.mimeType?.startsWith('video/') ? 'video' : binary.mimeType === 'application/pdf' ? 'document' : null);
    if (!existing && !type) fail('Ce type de fichier n’est pas pris en charge.');
    const next = { ...existing, id: change.id, type, binaryId: binaryId || null, originalFileName: existing?.originalFileName || binary?.fileName || null,
      name: change.name ?? existing?.name ?? binary?.fileName, tags: change.tags ?? existing?.tags ?? [], visibility: change.visibility ?? existing?.visibility ?? 'Secret' };
    if (typeof next.name !== 'string' || !next.name.trim() || next.name.length > 200 || !Array.isArray(next.tags) || next.tags.length > 7 || next.tags.some((tag) => !tags.has(tag)) || !['Secret', 'Communauté', 'Tous'].includes(next.visibility)) fail('Nom, classement ou autorisation média invalide.');
    if ((next.tags.includes('main-photo') || next.tags.includes('spin-3d')) && type !== 'image') fail('Seule une image peut servir de couverture ou de vue 360°.');
    if (next.tags.includes('main-video') && type !== 'video') fail('Le rôle vidéo exige un fichier vidéo.');
    if (next.visibility === 'Tous' && existing?.visibility !== 'Tous' && (!draft.confirmedPublicIds?.includes(change.id) || !privateBinaryIsVerified(binary) || binary.verificationStatus !== 'accepted')) fail('Confirmez explicitement l’autorisation publique du média vérifié.');
    if (existing?.visibility === 'Tous' && next.visibility !== 'Tous' && root.publicationStatus === 'published') fail('Retirez d’abord le mini-site public avant de remettre ce média en privé.', 'publication_must_be_revoked');
    next.name = next.name.trim(); next.tags = [...new Set(next.tags)];
    if (next.tags.includes('main-photo')) for (const [id, other] of current) if (id !== next.id) current.set(id, { ...other, tags: other.tags.filter((tag) => tag !== 'main-photo') });
    current.set(change.id, next);
  }
  return [...current.values()];
}
