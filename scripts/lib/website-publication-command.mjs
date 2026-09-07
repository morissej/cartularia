import { createHash } from 'node:crypto';
import { ProjectionCommandError, PUBLIC_BLOCK_ALLOWLIST, recordProjectionApproval, publishPublicBlocks, revokePublicPublication, validatePublicProjectionBlocks } from './projection-command.mjs';
import { detectTrustedFileFormat } from './private-upload-command.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/.test(value);

async function pendingMediaCleanupJobs(firestore, cartularyId) {
  const groups = await Promise.all(['websiteOperations', 'websiteCleanup'].map(async (name) => {
    const snapshot = await firestore.collection(`cartularies/${cartularyId}/${name}`).get();
    return Promise.all(snapshot.docs.filter((doc) => doc.data().complete !== true).map(async (doc) => {
      // A receipt proves that the projection changed even if the process died
      // immediately after its transaction, before updating this cleanup job.
      const receipt = await firestore.doc(`cartularies/${cartularyId}/commandReceipts/${doc.id}`).get();
      const expectedCommand = name === 'websiteOperations' ? 'publishPublicBlocks' : 'revokePublicPublication';
      return receipt.exists && receipt.data().command === expectedCommand
        ? { ref: doc.ref, paths: name === 'websiteOperations' ? doc.data().previousPaths || [] : doc.data().paths || [] } : null;
    }));
  }));
  return groups.flat().filter(Boolean);
}

async function finishPendingMediaCleanup({ firestore, bucket, state }) {
  const jobs = await pendingMediaCleanupJobs(firestore, state.cartularyId);
  const blocks = await firestore.collection(`publications/${state.publicCode}/blocks`).get();
  const activePaths = new Set(blocks.docs.flatMap((doc) => (doc.data().assets || []).map((asset) => asset.storagePath)));
  for (const job of jobs) {
    for (const path of job.paths) {
      if (typeof path !== 'string' || !path.startsWith(`public/${state.publicCode}/`) || activePaths.has(path)) continue;
      try {
        await bucket.file(path).delete({ ignoreNotFound: true });
        const parts = path.split('/');
        if (parts.length === 4) {
          const derivative = firestore.doc(`cartularies/${state.cartularyId}/assets/${parts[2]}/derivatives/${parts[3]}`);
          if ((await derivative.get()).exists) await derivative.set({ processingState: 'revoked' }, { merge: true });
        }
      }
      catch { throw new ProjectionCommandError('media_cleanup_pending', 'Le contenu a été retiré de la sélection, mais certaines anciennes copies doivent encore être supprimées. Reprenez le nettoyage des médias.'); }
    }
    await job.ref.set({ complete: true }, { merge: true });
  }
}

export async function getWebsitePublicationState({ firestore, requestAuth, cartularyId }) {
  if (!requestAuth?.uid) throw new ProjectionCommandError('unauthenticated', 'Connectez-vous au Registre.');
  if (!identifier(cartularyId)) throw new ProjectionCommandError('invalid_argument', 'Cartulaire invalide.');
  const root = await firestore.doc(`cartularies/${cartularyId}`).get();
  if (!root.exists) throw new ProjectionCommandError('cartulary_not_found', 'Cartulaire introuvable.');
  const value = root.data();
  const [user, membership] = await Promise.all([
    firestore.doc(`users/${requestAuth.uid}`).get(),
    firestore.doc(`organizations/${value.organizationId}/memberships/${requestAuth.uid}`).get(),
  ]);
  const member = membership.exists ? membership.data() : null;
  if (!user.exists || user.data().status !== 'active' || value.accountHolderId !== requestAuth.uid
    || member?.uid !== requestAuth.uid || member?.status !== 'active' || !member.roles?.includes('legal_owner')
    || !member.permissions?.includes('publication.manage') || !member.scopes?.registryIds?.includes(value.registryId)) {
    throw new ProjectionCommandError('permission_denied', 'La publication est réservée au propriétaire autorisé.');
  }
  const publication = await firestore.doc(`publications/${value.publicCode}`).get();
  const published = publication.exists && publication.data().status === 'published';
  const publicBlocks = published ? await firestore.collection(`publications/${value.publicCode}/blocks`).limit(PUBLIC_BLOCK_ALLOWLIST.length + 1).get() : null;
  if (publicBlocks && publicBlocks.size > PUBLIC_BLOCK_ALLOWLIST.length) throw new ProjectionCommandError('invalid_blocks', 'La sélection publiée dépasse la limite autorisée.');
  const blockIds = published && Array.isArray(publication.data().blockIds) ? publication.data().blockIds.filter((id) => PUBLIC_BLOCK_ALLOWLIST.includes(id)) : [];
  const selectedAssetIds = [...new Set((publicBlocks?.docs || []).filter((block) => blockIds.includes(block.id))
    .flatMap((block) => Array.isArray(block.data().assets) ? block.data().assets.slice(0, 100).map((asset) => asset.assetId).filter(identifier) : []))];
  const cleanupJobs = await pendingMediaCleanupJobs(firestore, cartularyId);
  return { cartularyId, publicCode: value.publicCode, revision: value.revision,
    cleanupPending: cleanupJobs.length > 0, pendingCleanupCount: cleanupJobs.length,
    status: publication.exists && publication.data().status === 'published' ? 'published' : publication.exists && publication.data().status === 'revoked' ? 'revoked' : 'draft',
    blockIds, selectedAssetIds };
}

export function validateWebsiteRequest(input) {
  if (!identifier(input?.cartularyId) || !identifier(input?.requestId) || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 1 || input.confirmed !== true) {
    throw new ProjectionCommandError('invalid_argument', 'Confirmez la publication depuis la version actuelle du dossier.');
  }
  if (!Array.isArray(input.blocks) || !input.blocks.length || input.blocks.length > PUBLIC_BLOCK_ALLOWLIST.length
    || new Set(input.blocks.map((block) => block.id)).size !== input.blocks.length
    || input.blocks.some((block) => !PUBLIC_BLOCK_ALLOWLIST.includes(block.id))) {
    throw new ProjectionCommandError('invalid_blocks', 'Sélectionnez uniquement des contenus publiables.');
  }
  if (Buffer.byteLength(JSON.stringify(input.blocks)) > 250_000) throw new ProjectionCommandError('invalid_argument', 'Le contenu sélectionné est trop volumineux.');
  for (const block of input.blocks) {
    if (typeof block.title !== 'string' || !block.title.trim() || !Array.isArray(block.assets) || block.assets.length > 100) throw new ProjectionCommandError('invalid_blocks', 'Contenu ou médias invalides.');
    for (const asset of block.assets) {
      if (!identifier(asset.assetId) || !identifier(asset.binaryId)) throw new ProjectionCommandError('invalid_asset', 'Enregistrez les médias dans le dossier avant de les publier.');
    }
  }
  if (input.blocks.some((block) => block.assets.length) && input.confirmedNonPersonalMedia !== true) throw new ProjectionCommandError('media_consent_required', 'Confirmez vos droits de diffusion et l’absence de données personnelles dans les médias sélectionnés.');
  validatePublicProjectionBlocks(input.blocks.map((block) => ({ ...block, assetRefs: [] })));
  return input;
}

/** Copies only a verified, metadata-stripped presentation derivative. The original never moves. */
async function prepareDerivative({ firestore, bucket, uid, state, requestId, asset }) {
  const manifest = await firestore.doc(`privateDrafts/${uid}/cartularies/${state.cartularyId}/binaries/${asset.binaryId}`).get();
  const record = manifest.exists ? manifest.data() : null;
  const derivative = record?.presentationDerivative;
  const privatePrefix = `private-derivatives/${uid}/${state.cartularyId}/${asset.binaryId}/`;
  const mediaKind = derivative?.mimeType === 'image/webp' ? 'image' : derivative?.mimeType === 'video/mp4' ? 'video' : derivative?.mimeType === 'application/pdf' ? 'document' : null;
  const safeProcessing = mediaKind === 'image' || (mediaKind === 'document' && derivative.processingMethod === 'pdf_rasterized_v1' && derivative.pageCount > 0 && derivative.pageCount <= 30)
    || (mediaKind === 'video' && derivative.processingMethod === 'video_transcoded_v1' && record?.mediaDecodeStatus === 'decoded_transcoded_verified' && derivative.duration > 0 && derivative.duration <= 180);
  if (!['media', 'condition_attachment'].includes(record?.kind)) throw new ProjectionCommandError('personal_document', 'Les documents personnels et les fichiers non classés restent privés.');
  if (record?.deleted || record?.verificationStatus !== 'accepted' || record?.publicationEligible !== true
    || derivative?.metadataStripped !== true || !derivative.storagePath?.startsWith(privatePrefix)
    || !safeProcessing || !record.sha256 || derivative.sourceSha256 !== record.sha256) {
    throw new ProjectionCommandError('derivative_not_ready', 'Un média sélectionné n’a pas encore de copie publique vérifiée. Les originaux restent privés.');
  }
  const [bytes] = await bucket.file(derivative.storagePath).download();
  const digest = `sha256:${hash(bytes)}`;
  const detected = detectTrustedFileFormat(bytes.subarray(0, 32));
  if ((mediaKind === 'image' && detected !== 'webp') || (mediaKind === 'video' && detected !== 'mp4') || (mediaKind === 'document' && detected !== 'pdf')
    || (derivative.sha256 && derivative.sha256 !== digest) || (derivative.size && derivative.size !== bytes.length)
    || bytes.length > (mediaKind === 'video' ? 100 : 50) * 1024 * 1024) throw new ProjectionCommandError('derivative_integrity', 'La copie de présentation ne correspond pas à son format ou son empreinte vérifiée.');
  if (mediaKind !== 'image' && (!derivative.sha256 || !derivative.size)) throw new ProjectionCommandError('derivative_not_ready', 'Le contrôle d’intégrité de cette copie de présentation est incomplet.');
  const derivativeId = `web_${hash(`${requestId}:${asset.binaryId}:${digest}`).slice(0, 24)}`;
  const storagePath = `public/${state.publicCode}/${asset.assetId}/${derivativeId}`;
  await bucket.file(storagePath).save(bytes, { resumable: false, metadata: {
    contentType: derivative.mimeType, cacheControl: 'private, no-store, max-age=0',
    metadata: { publicCode: state.publicCode, assetId: asset.assetId, derivativeId, metadataStripped: 'true', firebaseStorageDownloadTokens: '' },
  } });
  await firestore.doc(`cartularies/${state.cartularyId}/assets/${asset.assetId}/derivatives/${derivativeId}`).set({
    assetId: asset.assetId, derivativeId, publicCode: state.publicCode, visibility: 'public', processingState: 'ready',
    mediaKind, mimeDetected: derivative.mimeType, storagePath, sha256: digest,
  });
  return { assetId: asset.assetId, derivativeId, byteSize: bytes.length };
}

export async function publishWebsite({ firestore, bucket, requestAuth, input }) {
  validateWebsiteRequest(input);
  const state = await getWebsitePublicationState({ firestore, requestAuth, cartularyId: input.cartularyId });
  // A new request cannot strand a failed cleanup from an older request.
  if (state.cleanupPending) await finishPendingMediaCleanup({ firestore, bucket, state });
  const operation = firestore.doc(`cartularies/${input.cartularyId}/websiteOperations/${input.requestId}`);
  const signature = hash(JSON.stringify(input));
  let saved = await operation.get();
  if (!saved.exists) {
    if (state.revision !== input.expectedRevision) throw new ProjectionCommandError('revision_conflict', 'Le dossier a changé. Rechargez son état avant de publier.');
    const previousBlocks = await firestore.collection(`publications/${state.publicCode}/blocks`).get();
    const previousPaths = [...new Set(previousBlocks.docs.flatMap((doc) => (doc.data().assets || []).map((asset) => asset.storagePath)))];
    try { await operation.create({ signature, previousPaths, complete: false }); }
    catch (error) { if (error.code !== 6 && error.code !== 'already-exists') throw error; }
    saved = await operation.get();
  }
  if (saved.data().signature !== signature) throw new ProjectionCommandError('request_reused', 'Cette demande a déjà été utilisée avec d’autres contenus.');
  const approvalId = `approval_${hash(input.requestId).slice(0, 24)}`;
  const uniqueAssets = [...new Map(input.blocks.flatMap((block) => block.assets).map((asset) => [asset.assetId, asset])).values()];
  if (uniqueAssets.length > 100) throw new ProjectionCommandError('invalid_assets', 'Sélectionnez au maximum 100 médias.');
  const refs = new Map();
  // Sequential preparation keeps image memory bounded in the callable runtime.
  if (saved.data().refs) for (const ref of saved.data().refs) refs.set(ref.assetId, ref);
  else {
    let totalBytes = 0;
    for (const asset of uniqueAssets) {
      const prepared = await prepareDerivative({ firestore, bucket, uid: requestAuth.uid, state, requestId: input.requestId, asset });
      totalBytes += prepared.byteSize;
      if (totalBytes > 150 * 1024 * 1024) throw new ProjectionCommandError('publication_media_limit', 'Les copies sélectionnées dépassent 150 Mio. Réduisez la sélection pour préserver la consultation du mini-site.');
      refs.set(asset.assetId, prepared);
    }
    const preparedRefs = [...refs.values()];
    const stableRefs = await firestore.runTransaction(async (transaction) => {
      const latest = await transaction.get(operation);
      if (latest.data().refs) return latest.data().refs;
      transaction.update(operation, { refs: preparedRefs });
      return preparedRefs;
    });
    refs.clear();
    for (const ref of stableRefs) refs.set(ref.assetId, ref);
  }
  const approval = await recordProjectionApproval({ firestore, cartularyId: input.cartularyId, approvalId,
    actorId: requestAuth.uid, requestId: `approve_${hash(input.requestId).slice(0, 24)}`, expectedRevision: input.expectedRevision, audience: 'public',
    blocks: input.blocks.map((block) => ({ id: block.id, title: block.title, payload: block.payload, assetRefs: block.assets.map((asset) => refs.get(asset.assetId)) })),
  });
  const result = await publishPublicBlocks({ firestore, cartularyId: input.cartularyId, approvalId, actorId: requestAuth.uid,
    requestId: input.requestId, expectedRevision: approval.revision });
  await finishPendingMediaCleanup({ firestore, bucket, state });
  return { ...result, ...await getWebsitePublicationState({ firestore, requestAuth, cartularyId: input.cartularyId }) };
}

export async function revokeWebsite({ firestore, bucket, requestAuth, input }) {
  if (!identifier(input?.requestId) || input.confirmed !== true || !Number.isInteger(input.expectedRevision)) throw new ProjectionCommandError('invalid_argument', 'Confirmez le retrait de la publication.');
  const state = await getWebsitePublicationState({ firestore, requestAuth, cartularyId: input.cartularyId });
  if (input.cleanupOnly === true) {
    await finishPendingMediaCleanup({ firestore, bucket, state });
    return getWebsitePublicationState({ firestore, requestAuth, cartularyId: input.cartularyId });
  }
  const cleanup = firestore.doc(`cartularies/${input.cartularyId}/websiteCleanup/${input.requestId}`);
  let saved = await cleanup.get();
  if (!saved.exists) {
    const blocks = await firestore.collection(`publications/${state.publicCode}/blocks`).get();
    const paths = [...new Set(blocks.docs.flatMap((doc) => (doc.data().assets || []).map((asset) => asset.storagePath)))];
    try { await cleanup.create({ paths, publicCode: state.publicCode, expectedRevision: input.expectedRevision, complete: false }); }
    catch (error) { if (error.code !== 6 && error.code !== 'already-exists') throw error; }
    saved = await cleanup.get();
  }
  if (saved.data().expectedRevision !== input.expectedRevision) throw new ProjectionCommandError('request_reused', 'Cette demande a déjà été utilisée pour une autre version.');
  const result = await revokePublicPublication({ firestore, cartularyId: input.cartularyId, actorId: requestAuth.uid,
    requestId: input.requestId, expectedRevision: input.expectedRevision });
  await finishPendingMediaCleanup({ firestore, bucket, state });
  const current = await getWebsitePublicationState({ firestore, requestAuth, cartularyId: input.cartularyId });
  return { ...result, ...current, mediaAccessRevoked: current.status !== 'published' };
}
