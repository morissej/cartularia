import { isDeepStrictEqual } from 'node:util';
import sharp from 'sharp';
import {
  applyPresentationMirrors,
  classifyPresentationRegeneration,
  regeneratePresentationDerivatives,
} from './private-upload-command.mjs';
import { registryThumbnailFromBundle, sha256Of, validRegistryThumbnail } from './presentation-variants.mjs';

/**
 * Script Admin unique de rattrapage des dérivés de présentation (K7) : plan/exécution par Cartulaire.
 * Simulation par défaut ; --execute applique ; hors émulateur --allow-remote est obligatoire même en simulation.
 * Refuse cart_demo_* (fixtures statiques du bundle) ; ne dégrade jamais un statut de vérification ; écritures limitées
 * aux chemins de l'objet : private-derivatives/{uid}/{id}/*, privateDrafts/{uid}/cartularies/{id}/binaries/*
 * (presentationDerivative, derivativeStatus, publicationEligible, updatedAt), cartularies/{id}/assets/*.privatePresentation,
 * registries/{r}/items/{id}.thumbnail + thumbnailStatus. IWC (bundle Hosting) : --bundle-thumbnail pose item.thumbnail kind
 * bundle sans Storage, sur l'asset primaire seulement (bundle_asset_mismatch sinon). Idempotence stricte : un second
 * passage identique n'écrit rien (summary.firestoreWrites = 0).
 */

export class PresentationRegenerationError extends Error {
  constructor(code, message) { super(message); this.name = 'PresentationRegenerationError'; this.code = code; }
}

export const CARTULARY_ID_PATTERN = /^cart_[a-z0-9_]+$/;
const DEMO_CARTULARY_PREFIX = 'cart_demo_';
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const BINARY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const DEFAULT_LIMIT = 50;
const MAXIMUM_LIMIT = 500;
const BOOLEAN_FLAGS = new Map([
  ['--allow-remote', 'allowRemote'],
  ['--execute', 'execute'],
  ['--force', 'force'],
]);
const VALUE_FLAGS = new Map([
  ['--cartulary', 'cartularyId'],
  ['--expect-owner', 'expectedOwner'],
  ['--limit', 'limit'],
  ['--binary', 'binaryIds'],
  ['--bundle-thumbnail', 'bundleThumbnailPath'],
  ['--bundle-asset', 'bundleAssetId'],
]);

export const PRESENTATION_REGENERATION_USAGE = `Utilisation :
  node scripts/regenerate-presentation-derivatives.mjs --cartulary <id> [--expect-owner <uid>] [--allow-remote] [--execute]
                                                        [--limit N] [--binary <id>]... [--force]
                                                        [--bundle-thumbnail </assets/.../<stem>.240.webp> [--bundle-asset <assetId>]]

Options :
  --cartulary <id>          OBLIGATOIRE : ^cart_[a-z0-9_]+$ ; cart_demo_* refusé (demo_cartulary_refused), rien n'est lu.
  --expect-owner <uid>      facultatif : comparé à accountHolderId de la racine (owner_mismatch sinon, rien n'est écrit).
  --allow-remote            OBLIGATOIRE hors émulateur, même en simulation (remote_not_allowed).
  --execute                 applique (simulation par défaut : plan seulement, aucune écriture).
  --limit N                 nombre maximal de binaires régénérés par exécution (défaut ${DEFAULT_LIMIT}, maximum ${MAXIMUM_LIMIT}).
  --binary <id>             répétable : restreint le plan à ces binaires.
  --force                   régénère même les binaires already_current et rejoue ceux dont l'original a déjà été refusé
                            (skipped:failure_recorded).
  --bundle-thumbnail <path> IWC/bundle : pose registries/{r}/items/{id}.thumbnail = { kind: 'bundle', path, width, height,
                            assetId, sha256 } (+ thumbnailStatus 'ready') depuis le fichier public/<path> (≤ 240 px, WebP),
                            sans Storage ; assetId = primaryAssetId de l'item (item sans primaryAssetId, ou --bundle-asset
                            différent : bundle_asset_mismatch, rien n'est écrit).
  --help, -h                cette aide.

Variables :
  GCLOUD_PROJECT / FIREBASE_PROJECT_ID  projet Firebase : OBLIGATOIRE hors émulateur (project_required).
  FIREBASE_STORAGE_BUCKET / VITE_FIREBASE_STORAGE_BUCKET (.env)  bucket Storage.
  FIRESTORE_EMULATOR_HOST   présent → émulateur.

Plan (simulation) : classement de chaque binaire (to_generate / already_current / original_missing / skipped:<raison>,
dont failure_recorded : échec sharp déjà consigné, rejoué seulement avec --force),
table binaryId → assets, vignette d'item prévue. Exécution : variantes presentation-v3-{240,480,768,1200}.webp + vignette
inline dans le manifeste, miroir assets.privatePresentation, items.thumbnail (updatedAt/revision de l'item inchangés).
Sortie : PRESENTATION_REGENERATION_PLAN ou PRESENTATION_REGENERATION_APPLIED sur stdout (compteurs et chemins, jamais
d'octets ni de dataUrl) ; en erreur PRESENTATION_REGENERATION_FAILED sur stderr, code 1.`;

const usageError = (code, message) => ({ ok: false, code, message });
const fail = (code, message) => { throw new PresentationRegenerationError(code, message); };

export const isRegenerableCartularyId = (cartularyId) => typeof cartularyId === 'string'
  && CARTULARY_ID_PATTERN.test(cartularyId)
  && !cartularyId.startsWith(DEMO_CARTULARY_PREFIX);

/* ----------------------------------------------------------------------------------------------
 * Arguments (fonction pure)
 * -------------------------------------------------------------------------------------------- */

export const parsePresentationRegenerationArgs = (argv = [], env = {}) => {
  const usesEmulator = Boolean(env.FIRESTORE_EMULATOR_HOST);
  const explicitProject = [env.GCLOUD_PROJECT, env.FIREBASE_PROJECT_ID].find((value) => typeof value === 'string' && value.trim()) ?? null;
  const options = {
    help: false,
    cartularyId: null,
    expectedOwner: null,
    allowRemote: false,
    execute: false,
    force: false,
    limit: DEFAULT_LIMIT,
    binaryIds: [],
    bundleThumbnailPath: null,
    bundleAssetId: null,
    projectId: explicitProject ? explicitProject.trim() : usesEmulator ? 'cartularia-wave2-local' : null,
    usesEmulator,
  };
  const unknown = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const [flag, inlineValue] = argument.includes('=') ? [argument.slice(0, argument.indexOf('=')), argument.slice(argument.indexOf('=') + 1)] : [argument, undefined];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (BOOLEAN_FLAGS.has(argument)) {
      options[BOOLEAN_FLAGS.get(argument)] = true;
    } else if (VALUE_FLAGS.has(flag)) {
      const value = inlineValue !== undefined ? inlineValue : argv[index + 1];
      if (inlineValue === undefined) index += 1;
      if (typeof value !== 'string' || !value || value.startsWith('--')) return usageError('invalid_argument', `${flag} attend une valeur.`);
      const key = VALUE_FLAGS.get(flag);
      if (key === 'binaryIds') options.binaryIds.push(value.trim());
      else options[key] = value.trim();
    } else {
      unknown.push(argument);
    }
  }
  if (options.help) return { ok: true, options };
  if (unknown.length) return usageError('invalid_argument', `Option inconnue : ${unknown.join(' ')}.`);
  if (!options.cartularyId) return usageError('cartulary_required', '--cartulary <id> est obligatoire.');
  if (!CARTULARY_ID_PATTERN.test(options.cartularyId)) return usageError('invalid_cartulary_id', `Identifiant de Cartulaire invalide : ${options.cartularyId}.`);
  if (options.cartularyId.startsWith(DEMO_CARTULARY_PREFIX)) return usageError('demo_cartulary_refused', 'Les Cartulaires de démonstration (cart_demo_*) servent des dérivés statiques du bundle : aucune régénération.');
  if (options.expectedOwner !== null && !UID_PATTERN.test(options.expectedOwner)) return usageError('invalid_argument', '--expect-owner attend un identifiant utilisateur.');
  const limit = Number(options.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAXIMUM_LIMIT) return usageError('invalid_argument', `--limit attend un entier entre 1 et ${MAXIMUM_LIMIT}.`);
  options.limit = limit;
  if (options.binaryIds.some((binaryId) => !BINARY_ID_PATTERN.test(binaryId))) return usageError('invalid_argument', '--binary attend un identifiant de binaire.');
  if (options.bundleThumbnailPath !== null && (!options.bundleThumbnailPath.startsWith('/assets/') || !/\.webp$/i.test(options.bundleThumbnailPath) || options.bundleThumbnailPath.includes('..'))) {
    return usageError('invalid_argument', '--bundle-thumbnail attend un chemin /assets/.../<stem>.240.webp du bundle Hosting.');
  }
  if (options.bundleAssetId !== null && !options.bundleThumbnailPath) return usageError('invalid_argument', '--bundle-asset exige --bundle-thumbnail.');
  return { ok: true, options };
};

/* ----------------------------------------------------------------------------------------------
 * Plan (lecture seule)
 * -------------------------------------------------------------------------------------------- */

/**
 * Chemin disque (relatif à public/) d'un chemin de bundle tel que le catalogue généré l'écrit (segments encodés,
 * `Focus%20Shift%20White%20Front.240.webp`) : segments décodés, jamais remontant ni absolu ; null si le chemin est refusé.
 * La vignette d'item conserve la forme ENCODÉE du catalogue (celle que le navigateur demande et que la Galerie sert déjà).
 */
export const bundleFileSystemPath = (publicPath) => {
  if (typeof publicPath !== 'string' || !publicPath.startsWith('/assets/') || !/\.webp$/i.test(publicPath)) return null;
  let segments;
  try { segments = publicPath.slice(1).split('/').map((segment) => decodeURIComponent(segment)); } catch { return null; }
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\'))) return null;
  return segments.join('/');
};

/** Vignette bundle prête à écrire depuis les octets du fichier public/<path> (lus par l'appelant, jamais téléchargés). */
export const describeBundleThumbnail = async ({ path, bytes, assetId }) => {
  if (!bytes) fail('bundle_file_missing', `Fichier du bundle introuvable : public${path}.`);
  const metadata = await sharp(bytes).metadata().catch(() => null);
  if (metadata?.format !== 'webp') fail('bundle_file_invalid', `Le fichier ${path} n'est pas un WebP.`);
  const thumbnail = registryThumbnailFromBundle({ path, width: metadata.width, height: metadata.height, assetId, sha256: sha256Of(bytes) });
  if (!thumbnail) fail('bundle_file_invalid', `Le fichier ${path} dépasse 240 px ou l'asset cible est indéterminé.`);
  return { ...thumbnail, bytes: bytes.length };
};

export const planPresentationRegeneration = async ({
  firestore, storage, bucketName = undefined, cartularyId, expectedOwner = null, binaryIds = [], force = false, limit = DEFAULT_LIMIT,
  bundleThumbnailPath = null, bundleAssetId = null, readBundleFile = null,
}) => {
  if (!isRegenerableCartularyId(cartularyId)) fail(cartularyId?.startsWith?.(DEMO_CARTULARY_PREFIX) ? 'demo_cartulary_refused' : 'invalid_cartulary_id', `Cartulaire refusé : ${cartularyId}.`);
  const rootSnapshot = await firestore.doc(`cartularies/${cartularyId}`).get();
  if (!rootSnapshot.exists) fail('root_missing', `cartularies/${cartularyId} est absent : aucun propriétaire déductible.`);
  const root = rootSnapshot.data();
  const ownerUid = typeof root.accountHolderId === 'string' ? root.accountHolderId : null;
  if (!ownerUid) fail('owner_unknown', 'La racine ne porte pas accountHolderId.');
  if (expectedOwner && expectedOwner !== ownerUid) fail('owner_mismatch', 'Le propriétaire attendu ne correspond pas à accountHolderId.');
  const registryId = typeof root.registryId === 'string' ? root.registryId : null;
  const warnings = [];
  const draft = await firestore.doc(`privateDrafts/${ownerUid}/cartularies/${cartularyId}`).get();
  if (!draft.exists || draft.data()?.status !== 'active') {
    warnings.push('private_draft_not_active: les variantes Storage resteront illisibles par le propriétaire (ownsPrivateDraft) ; la vignette inline reste lisible.');
  }
  const assetSnapshot = await firestore.collection(`cartularies/${cartularyId}/assets`).get();
  const assetsByBinary = new Map();
  for (const document of assetSnapshot.docs) {
    const binaryId = document.data()?.binaryId;
    if (typeof binaryId !== 'string' || !binaryId) continue;
    if (!assetsByBinary.has(binaryId)) assetsByBinary.set(binaryId, []);
    assetsByBinary.get(binaryId).push(document.id);
  }
  const itemRef = registryId ? firestore.doc(`registries/${registryId}/items/${cartularyId}`) : null;
  const item = itemRef ? await itemRef.get() : null;
  const itemExists = Boolean(item?.exists);
  const primaryAssetId = itemExists && typeof item.data()?.primaryAssetId === 'string' ? item.data().primaryAssetId : null;
  const existingThumbnail = itemExists ? item.data()?.thumbnail ?? null : null;

  const bucket = storage.bucket(bucketName);
  const binarySnapshot = await firestore.collection(`privateDrafts/${ownerUid}/cartularies/${cartularyId}/binaries`).get();
  const selected = binaryIds.length ? binarySnapshot.docs.filter((document) => binaryIds.includes(document.id)) : binarySnapshot.docs;
  const binaries = [];
  for (const document of selected) {
    const identity = { uid: ownerUid, cartularyId, binaryId: document.id };
    const classification = await classifyPresentationRegeneration({ bucket, identity, manifest: document.data(), force });
    binaries.push({ binaryId: document.id, ...classification, assetIds: assetsByBinary.get(document.id) ?? [] });
  }
  const missingBinaryIds = binaryIds.filter((binaryId) => !binarySnapshot.docs.some((document) => document.id === binaryId));
  for (const binaryId of missingBinaryIds) binaries.push({ binaryId, status: 'skipped', reason: 'manifest_missing', assetIds: assetsByBinary.get(binaryId) ?? [] });
  const counts = binaries.reduce((total, binary) => ({ ...total, [binary.status]: (total[binary.status] || 0) + 1 }), {});
  const toGenerate = binaries.filter((binary) => binary.status === 'to_generate').map((binary) => binary.binaryId);
  if (toGenerate.length > limit) warnings.push(`limit: ${toGenerate.length} binaires à régénérer, ${limit} traités par exécution.`);
  const mirrorable = binaries.filter((binary) => binary.status === 'to_generate' || binary.status === 'already_current');
  const plannedItemThumbnail = primaryAssetId && mirrorable.some((binary) => binary.assetIds.includes(primaryAssetId)) ? 'inline' : null;

  let bundle = null;
  if (bundleThumbnailPath) {
    if (!itemExists) fail('item_missing', `registries/${registryId}/items/${cartularyId} est absent : aucune vignette bundle à poser.`);
    // N32 (tour 4 point 6) : la vignette d'item désigne TOUJOURS l'asset primaire ; une vignette posée sur un autre asset
    // serait remise à null par la synchronisation suivante (registryItemThumbnailFor). Refus sans écriture.
    if (!primaryAssetId) fail('bundle_asset_mismatch', 'L’item n’a pas de primaryAssetId : aucune vignette bundle ne peut lui être attribuée.');
    if (bundleAssetId && bundleAssetId !== primaryAssetId) fail('bundle_asset_mismatch', `--bundle-asset ${bundleAssetId} ne désigne pas l’asset primaire de l’item (${primaryAssetId}).`);
    if (typeof readBundleFile !== 'function') fail('bundle_reader_missing', 'Aucun lecteur de fichier bundle fourni.');
    bundle = await describeBundleThumbnail({ path: bundleThumbnailPath, bytes: await readBundleFile(bundleThumbnailPath), assetId: primaryAssetId });
  }
  const blockers = [];
  if (!registryId) warnings.push('registry_unknown: la racine ne porte pas registryId, aucune vignette d’item ne sera posée.');
  if (registryId && !itemExists) warnings.push('item_missing: aucune projection registries/{r}/items/{id}, aucune vignette d’item ne sera posée.');
  return {
    cartularyId,
    ownerUid,
    registryId,
    itemExists,
    primaryAssetId,
    existingThumbnailKind: validRegistryThumbnail(existingThumbnail) ? existingThumbnail.kind : null,
    assetCount: assetSnapshot.docs.length,
    binaries,
    counts,
    toGenerate: toGenerate.slice(0, limit),
    limit,
    force,
    plannedItemThumbnail: bundle ? 'bundle' : plannedItemThumbnail,
    bundle: bundle ? { kind: 'bundle', path: bundle.path, width: bundle.width, height: bundle.height, assetId: bundle.assetId, sha256: bundle.sha256, bytes: bundle.bytes } : null,
    warnings,
    blockers,
    ok: blockers.length === 0,
  };
};

/* ----------------------------------------------------------------------------------------------
 * Exécution
 * -------------------------------------------------------------------------------------------- */

export const applyPresentationRegeneration = async ({ firestore, storage, bucketName = undefined, plan, force = plan.force }) => {
  const results = [];
  const summary = { generated: 0, failed: 0, alreadyCurrent: 0, skipped: 0, mirrored: 0, assetsMirrored: 0, itemThumbnail: null, firestoreWrites: 0 };
  for (const binaryId of plan.toGenerate) {
    const identity = { uid: plan.ownerUid, cartularyId: plan.cartularyId, binaryId };
    const result = await regeneratePresentationDerivatives({ firestore, storage, bucketName, ...identity, force });
    const entry = { binaryId, status: result.status, reason: result.reason ?? null, variants: result.variants ?? [], primaryRewritten: result.primaryRewritten ?? false };
    if (result.status === 'generated') summary.generated += 1;
    else if (result.status === 'failed' || result.status === 'digest_mismatch' || result.status === 'original_missing') summary.failed += 1;
    else summary.skipped += 1;
    results.push(entry);
  }
  // Miroirs pour tout binaire désormais courant (généré maintenant ou déjà courant) : chemin de l'objet seulement, aucune
  // écriture si le contenu est identique (idempotence stricte) ; un échec sharp consigné pose thumbnailStatus 'failed'.
  const mirrorBinaryIds = new Set([
    ...results.filter((entry) => entry.status === 'generated' || entry.status === 'failed').map((entry) => entry.binaryId),
    ...plan.binaries.filter((binary) => binary.status === 'already_current').map((binary) => binary.binaryId),
  ]);
  const mirrors = [];
  for (const binaryId of [...mirrorBinaryIds].sort()) {
    const mirror = await applyPresentationMirrors({ firestore, uid: plan.ownerUid, cartularyId: plan.cartularyId, binaryId });
    mirrors.push({ binaryId, status: mirror.status, reason: mirror.reason ?? null, assets: mirror.assets, itemThumbnail: mirror.itemThumbnail, thumbnailStatus: mirror.thumbnailStatus ?? null, writes: mirror.writes ?? 0 });
    summary.firestoreWrites += mirror.writes ?? 0;
    if (mirror.status === 'mirrored') { summary.mirrored += 1; summary.assetsMirrored += mirror.assets.length; }
    if (mirror.itemThumbnail) summary.itemThumbnail = 'inline';
  }
  if (plan.bundle) {
    const { bytes: _bytes, ...thumbnail } = plan.bundle;
    const itemRef = firestore.doc(`registries/${plan.registryId}/items/${plan.cartularyId}`);
    const existing = (await itemRef.get()).data() ?? {};
    if (!isDeepStrictEqual(existing.thumbnail, thumbnail) || existing.thumbnailStatus !== 'ready') {
      await itemRef.set({ thumbnail, thumbnailStatus: 'ready' }, { merge: true });
      summary.firestoreWrites += 1;
    }
    summary.itemThumbnail = 'bundle';
  }
  return { results, mirrors, summary, ok: summary.failed === 0 };
};

/* ----------------------------------------------------------------------------------------------
 * Rapport et CLI
 * -------------------------------------------------------------------------------------------- */

/** Rapport JSON unique : compteurs, statuts et chemins seulement ; jamais d'octets ni de dataUrl. */
export const describePresentationRegenerationRun = ({ plan, applied = null, dryRun = applied === null, projectId = null, usesEmulator = null }) => ({
  event: applied ? 'PRESENTATION_REGENERATION_APPLIED' : 'PRESENTATION_REGENERATION_PLAN',
  projectId,
  usesEmulator,
  dryRun,
  cartularyId: plan.cartularyId,
  ownerUid: plan.ownerUid,
  registryId: plan.registryId,
  itemExists: plan.itemExists,
  primaryAssetId: plan.primaryAssetId,
  existingThumbnailKind: plan.existingThumbnailKind,
  assetCount: plan.assetCount,
  counts: plan.counts,
  limit: plan.limit,
  force: plan.force,
  binaries: plan.binaries.map((binary) => ({ binaryId: binary.binaryId, status: binary.status, reason: binary.reason ?? null, assetIds: binary.assetIds })),
  toGenerate: plan.toGenerate,
  plannedItemThumbnail: plan.plannedItemThumbnail,
  bundle: plan.bundle,
  warnings: plan.warnings,
  blockers: plan.blockers,
  applied: applied ? { results: applied.results, mirrors: applied.mirrors, summary: applied.summary } : null,
  ok: applied ? applied.ok : plan.ok,
});

export const runPresentationRegeneration = async ({ firestore, storage, bucketName = undefined, execute = false, projectId = null, usesEmulator = null, ...planOptions }) => {
  const plan = await planPresentationRegeneration({ firestore, storage, bucketName, ...planOptions });
  const applied = execute && plan.ok ? await applyPresentationRegeneration({ firestore, storage, bucketName, plan }) : null;
  return { plan, applied, report: describePresentationRegenerationRun({ plan, applied, dryRun: !execute, projectId, usesEmulator }) };
};

/**
 * CLI complet sans initialisation Firebase : `firestore` et `storage` sont des instances ou des fabriques appelées
 * seulement après validation des arguments et des garde-fous distants.
 */
export const runPresentationRegenerationCli = async ({ argv = [], env = {}, firestore, storage, bucketName = undefined, readBundleFile = null, stdout = process.stdout, stderr = process.stderr }) => {
  const failWith = (code, message) => {
    stderr.write(`${JSON.stringify({ event: 'PRESENTATION_REGENERATION_FAILED', code, message })}\n`);
    return { exitCode: 1, report: null };
  };
  const parsed = parsePresentationRegenerationArgs(argv, env);
  if (!parsed.ok) return failWith(parsed.code, `${parsed.message}\n${PRESENTATION_REGENERATION_USAGE}`);
  const { options } = parsed;
  if (options.help) {
    stdout.write(`${PRESENTATION_REGENERATION_USAGE}\n`);
    return { exitCode: 0, report: null };
  }
  if (!options.usesEmulator && !options.projectId) {
    return failWith('project_required', `Hors émulateur, GCLOUD_PROJECT ou FIREBASE_PROJECT_ID doit désigner explicitement le projet, même en simulation.\n${PRESENTATION_REGENERATION_USAGE}`);
  }
  if (!options.usesEmulator && !options.allowRemote) {
    return failWith('remote_not_allowed', 'Régénération interrompue : hors émulateur, --allow-remote est obligatoire même en simulation (identifiants Admin).');
  }
  try {
    const context = { projectId: options.projectId, usesEmulator: options.usesEmulator };
    const store = typeof firestore === 'function' ? await firestore(context) : firestore;
    if (!store) fail('firestore_unavailable', 'Aucune instance Firestore.');
    const storageInstance = typeof storage === 'function' ? await storage(context) : storage;
    if (!storageInstance) fail('storage_unavailable', 'Aucune instance Storage.');
    const { report } = await runPresentationRegeneration({
      firestore: store,
      storage: storageInstance,
      bucketName: typeof bucketName === 'function' ? await bucketName(context) : bucketName,
      cartularyId: options.cartularyId,
      expectedOwner: options.expectedOwner,
      binaryIds: options.binaryIds,
      force: options.force,
      limit: options.limit,
      bundleThumbnailPath: options.bundleThumbnailPath,
      bundleAssetId: options.bundleAssetId,
      readBundleFile,
      execute: options.execute,
      projectId: options.projectId,
      usesEmulator: options.usesEmulator,
    });
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return { exitCode: report.ok ? 0 : 1, report };
  } catch (error) {
    return failWith(error?.code || 'regeneration_failed', error?.message || String(error));
  }
};
