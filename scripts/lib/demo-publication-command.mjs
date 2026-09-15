import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import sharp from 'sharp';
import { buildDemoCartularyAssets, DEMO_ACCOUNT, DEMO_CARTULARIES, DEMO_WEBSITE_BLOCK_IDS, demoCartularyContentById } from '../../src/data/demoCartularies.ts';
import { filterPublicationBlockIds, PUBLICATION_BLOCK_CATALOG } from '../../src/domain/publication.ts';
import { verifyAuditChain } from './audit-verifier.mjs';
import { CANONICALIZATION_VERSION, canonicalize, sha256Bytes, sha256Digest } from './canonical-json.mjs';
import { PUBLIC_BLOCK_ALLOWLIST, validatePublicProjectionBlocks } from './projection-command.mjs';
import { findPrivatePublicTextToken } from './public-text-policy.mjs';

/**
 * Publication réelle du mini-site d'UN objet de démonstration (ADR-026/028, vague V2).
 *
 * Le compte démo partagé ne peut pas publier par la Cloud Function publishCartularyWebsite
 * (adhésion `guest` sans `legal_owner` ni `publication.manage`, médias sans binaryId ni brouillon
 * privé) et ne doit pas le pouvoir : son mot de passe est dans le bundle. Cette commande Admin,
 * exécutée par Jérôme, produit la même projection que `publishPublicBlocks`
 * (scripts/lib/projection-command.mjs) — publications/{code}, blocks, mediaAccess, seals, racine
 * patchée, événement d'audit, approbation consommée, reçu — lue par le même lecteur
 * (`loadPublicProjection`) et les mêmes règles que les objets réels. Jamais de faux « publié » :
 * les dérivés WebP sont matérialisés dans Storage sous public/{code}/{assetId}/{derivativeId} avec
 * les métadonnées exigées par storage.rules, et chaque bloc porte l'eyebrow
 * « Démonstration · données fictives ».
 *
 * Différences assumées avec la fonction réelle, toutes visibles dans les documents écrits :
 *   - événement d'audit `publication.published` / `publication.revoked` dont l'acteur est
 *     `{ uid: <compte démo>, role: 'demo_seed' }` (même rôle que le seed), requestId déterministe
 *     `demo_publish_<id>_<n>` / `demo_revoke_<id>_<n>` (n = prochain numéro de séquence) ;
 *   - approbation `publicationApprovals/{approvalId}` créée déjà consommée, decisionSource
 *     'admin_demo_seed' ;
 *   - publications/{code} porte en plus `demo: true` et `demoDisclaimer` ;
 *   - la bibliothèque média ne publie que les images fixes (vue principale et vues non « spin »),
 *     jamais la vidéo webm ni la note texte : ni ffmpeg ni dérivé texte ne sont disponibles.
 *
 * Simulation par défaut (aucune écriture) ; `--apply --confirm-demo-publication` applique ;
 * `--revoke --apply --confirm-demo-publication` retire. Hors émulateur : projet explicite et
 * `--allow-remote` obligatoires, même en simulation. La logique, l'analyse des arguments et l'aide
 * vivent ici (testées en mémoire) ; scripts/publish-demo-website.mjs ne garde que l'initialisation
 * Firebase différée. Jamais touchés : users/{uid}, organizations/{org}/memberships/{uid}, règles, index.
 */

export class DemoPublicationError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'DemoPublicationError'; this.code = code; Object.assign(this, details); }
}

export const DEMO_PUBLICATION_VERSION = 'demo-publication-v1';
export const DEMO_PURPOSE = 'public_read_only_demo';
export const DEMO_EYEBROW = 'Démonstration · données fictives';
export const DEMO_DISCLAIMER = 'Exemplaire, documents, historique et valeurs fictifs.';
export const DEMO_AUDIT_ROLE = 'demo_seed';
export const DEMO_DECISION_SOURCE = 'admin_demo_seed';
// V4 D3 : même liste que la sélection démo du client (aperçu local démo = mini-site démo publié), valeur inchangée.
export const DEFAULT_DEMO_WEBSITE_BLOCKS = DEMO_WEBSITE_BLOCK_IDS;
export const DEMO_DERIVATIVE_MAX_EDGE = 1600;
export const DEMO_DERIVATIVE_WEBP_QUALITY = 82;
const PUBLIC_CACHE_CONTROL = 'private, no-store, max-age=0';
const ZERO_HASH = `sha256:${'0'.repeat(64)}`;
const DEFAULT_FIXTURES_ROOT = fileURLToPath(new URL('../../public/', import.meta.url));
const DEMO_FIXTURE_PREFIX = '/assets/demo-watches/';
const IDENTIFIER = /^[a-z0-9][a-z0-9_-]{5,127}$/;
const BOOLEAN_FLAGS = new Map([
  ['--allow-remote', 'allowRemote'],
  ['--apply', 'apply'],
  ['--confirm-demo-publication', 'confirmDemoPublication'],
  ['--revoke', 'revoke'],
  ['--include-video', 'includeVideo'],
]);
const VALUE_FLAGS = new Map([
  ['--cartulary', 'cartularyId'],
  ['--blocks', 'blocks'],
]);

export const DEMO_PUBLICATION_USAGE = `Utilisation :
  node scripts/publish-demo-website.mjs --cartulary <id> [--blocks <liste>] [--include-video] [--allow-remote]
                                        [--apply --confirm-demo-publication] [--revoke]

Options :
  --cartulary <id>            OBLIGATOIRE : identifiant d'un objet de démonstration (DEMO_CARTULARIES,
                              src/data/demoCartularies.ts) ; tout autre identifiant est refusé
                              (not_a_demo_cartulary), rien n'est lu.
  --blocks <liste>            blocs publiés, séparés par des virgules, tous dans la liste blanche publique
                              (aucun bloc valeur ni personnel). Défaut : ${DEFAULT_DEMO_WEBSITE_BLOCKS.join(',')}.
  --include-video             demande le bloc media-motion : exige FFMPEG_PATH et FFPROBE_PATH
                              (video_tooling_missing sinon) ; les fixtures démo sont en webm, hors liste
                              blanche du transcodeur (video_source_unsupported) : la vidéo n'est jamais publiée
                              sans conversion préalable de la fixture.
  --allow-remote              OBLIGATOIRE hors émulateur, même en simulation (remote_not_allowed sinon).
  --apply                     applique la publication (ou le retrait avec --revoke) ; exige aussi
                              --confirm-demo-publication (confirmation_required).
  --confirm-demo-publication  confirmation explicite, après revue du plan de simulation.
  --revoke                    retrait : publication et sceau passés revoked, blocks et mediaAccess supprimés,
                              fichiers public/{code}/ supprimés, dérivés processingState revoked.
  --help, -h                  cette aide.

Variables :
  GCLOUD_PROJECT / FIREBASE_PROJECT_ID  projet Firebase : OBLIGATOIRE hors émulateur, même en simulation
                              (project_required, Firebase jamais initialisé). Défaut émulateur : cartularia-demo-local.
  FIREBASE_STORAGE_BUCKET     bucket Storage (défaut hors émulateur : <projet>.firebasestorage.app).
  FIRESTORE_EMULATOR_HOST     présent → émulateur.

Garde-fous (plan bloqué, rien n'est écrit, code 1) :
  cartulary_not_found         racine cartularies/{id} absente ;
  not_demo_root               racine sans demo: true ;
  organization_mismatch / registry_mismatch / public_code_mismatch
                              racine, publications/{code} ou seals/{code} hors du compte démo ou d'un autre objet ;
  demo_account_mismatch       accountHolderId sans users/{uid} actif d'accountPurpose public_read_only_demo ;
  demo_account_privileged     l'adhésion du compte démo porte legal_owner ou publication.manage ;
  audit_chain_invalid         chaîne d'audit incohérente (scripts/lib/audit-verifier.mjs) ;
  secret_field_detected / block_not_allowlisted / no_blocks
                              politique de texte public ou sélection invalide ;
  publication_not_active      --revoke sans publication published ;
  video_tooling_missing / video_source_unsupported  voir --include-video ;
  storage_required            --apply sans bucket Storage (émulateur sans Storage).
Idempotence : publication published de cette racine, sourceRevision égale à la révision courante et mêmes
blocs → already_published (ok, aucune écriture).

Séquence de production (identifiants de la session Firebase CLI ; JAMAIS exécutée par les tests) :
  1. simulation : GCLOUD_PROJECT=<projet> FIREBASE_STORAGE_BUCKET=<bucket> node scripts/run-with-firebase-cli-adc.mjs -- \\
       node scripts/publish-demo-website.mjs --cartulary <id> --allow-remote
  2. application après revue : … --allow-remote --apply --confirm-demo-publication
  3. vérification anonyme de /watch-website?publicCode=<code> ; sinon retrait :
       … --allow-remote --revoke --apply --confirm-demo-publication

Sortie : un objet JSON unique sur stdout (DEMO_PUBLICATION_PLAN, DEMO_PUBLICATION_APPLIED ou
DEMO_PUBLICATION_REVOKED) : chemins, compteurs, empreintes tronquées, jamais de contenu ;
en erreur DEMO_PUBLICATION_FAILED sur stderr, code 1.`;

const fail = (code, message, details) => { throw new DemoPublicationError(code, message, details); };
const usageError = (code, message) => ({ ok: false, code, message });
const shortHash = (value) => (typeof value === 'string' ? value.replace(/^sha256:/, '').slice(0, 16) : null);
const sameSet = (left, right) => left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
export const demoCartularyDefinition = (cartularyId) => DEMO_CARTULARIES.find((entry) => entry.id === cartularyId) ?? null;

/* ----------------------------------------------------------------------------------------------
 * Arguments (fonction pure)
 * -------------------------------------------------------------------------------------------- */

export const parseDemoPublicationArgs = (argv = [], env = {}) => {
  const usesEmulator = Boolean(env.FIRESTORE_EMULATOR_HOST);
  const explicitProject = [env.GCLOUD_PROJECT, env.FIREBASE_PROJECT_ID].find((value) => typeof value === 'string' && value.trim()) ?? null;
  const options = {
    help: false, cartularyId: null, blocks: null, allowRemote: false, apply: false, confirmDemoPublication: false, revoke: false, includeVideo: false,
    projectId: explicitProject ? explicitProject.trim() : usesEmulator ? 'cartularia-demo-local' : null,
    usesEmulator,
    videoTooling: { ffmpegPath: env.FFMPEG_PATH || null, ffprobePath: env.FFPROBE_PATH || null },
  };
  const unknown = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const [flag, inlineValue] = argument.includes('=') ? [argument.slice(0, argument.indexOf('=')), argument.slice(argument.indexOf('=') + 1)] : [argument, undefined];
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (BOOLEAN_FLAGS.has(argument)) options[BOOLEAN_FLAGS.get(argument)] = true;
    else if (VALUE_FLAGS.has(flag)) {
      const value = inlineValue !== undefined ? inlineValue : argv[index + 1];
      if (inlineValue === undefined) index += 1;
      if (typeof value !== 'string' || !value || value.startsWith('--')) return usageError('invalid_argument', `${flag} attend une valeur.`);
      options[VALUE_FLAGS.get(flag)] = value.trim();
    } else unknown.push(argument);
  }
  if (options.help) return { ok: true, options };
  if (unknown.length) return usageError('invalid_argument', `Option inconnue : ${unknown.join(' ')}.`);
  if (!options.cartularyId) return usageError('invalid_argument', '--cartulary <id> est obligatoire.');
  if (!demoCartularyDefinition(options.cartularyId)) return usageError('not_a_demo_cartulary', `${options.cartularyId} n’est pas un objet de démonstration (DEMO_CARTULARIES) : rien n’est lu.`);
  if (options.blocks !== null) {
    const blocks = options.blocks.split(',').map((value) => value.trim()).filter(Boolean);
    if (!blocks.length) return usageError('invalid_argument', '--blocks attend au moins un bloc.');
    const forbidden = blocks.filter((id) => !PUBLIC_BLOCK_ALLOWLIST.includes(id));
    if (forbidden.length) return usageError('invalid_argument', `Blocs hors liste blanche publique : ${forbidden.join(', ')}.`);
    if (new Set(blocks).size !== blocks.length) return usageError('invalid_argument', 'Un bloc ne peut apparaître qu’une fois dans --blocks.');
    options.blocks = blocks;
  } else options.blocks = [...DEFAULT_DEMO_WEBSITE_BLOCKS];
  if (options.revoke && (options.includeVideo || argv.some((argument) => argument.startsWith('--blocks')))) return usageError('invalid_argument', '--revoke ne se combine ni avec --blocks ni avec --include-video.');
  if (options.apply && !options.confirmDemoPublication) return usageError('confirmation_required', '--apply exige --confirm-demo-publication après revue du plan de simulation : rien n’est écrit.');
  return { ok: true, options };
};

/* ----------------------------------------------------------------------------------------------
 * Contenu et blocs (miroir de src/domain/websiteDraft.ts, non importable depuis Node)
 * -------------------------------------------------------------------------------------------- */

export const buildDemoWebsiteContent = (definition) => {
  const content = demoCartularyContentById(definition.id);
  if (!content) fail('demo_content_missing', `Contenu de démonstration absent pour ${definition.id}.`);
  return {
    brand: definition.brand, model: definition.model, reference: definition.reference,
    assets: buildDemoCartularyAssets(definition),
    heroSummary: content.editableCopy.heroSummary,
    history: content.editableCopy.originParagraphs,
    specifications: [{ title: 'Spécifications', items: definition.technicalSpecs }],
    description: content.editableCopy.watchDescription,
    conditionSummary: content.editableCopy.conditionSummary,
    checks: content.checks.map((check) => ({ label: check.title, result: check.checked ? 'Contrôlé' : 'À contrôler', note: check.note })),
    resources: content.popularityResources,
    reports: content.conditionReports.map((report) => ({ title: report.title, date: report.date, note: report.summary })),
  };
};

/** Médias d'un bloc : fixtures publiques fictives seulement (Archived, visibilité Tous), images fixes hors vidéo et note texte. */
const blockAssets = (id, assets) => assets.filter((asset) => asset.status === 'Archived' && asset.visibility === 'Tous' && (
  id === 'media-library' ? asset.type === 'image' && (asset.tags.includes('main-photo') || !asset.tags.includes('spin-3d'))
    : id === 'media-hero' || id === 'cover-watch' ? asset.type === 'image' && asset.tags.includes('main-photo')
      : id === 'media-motion' ? asset.type === 'video' && asset.tags.includes('main-video')
        : id === 'media-spin' ? asset.type === 'image' && asset.tags.includes('spin-3d')
          : id === 'media-slideshow' ? asset.type === 'image' && asset.tags.includes('slideshow') : false
));

export const buildDemoWebsiteBlocks = ({ definition, blockIds = DEFAULT_DEMO_WEBSITE_BLOCKS }) => {
  const content = buildDemoWebsiteContent(definition);
  return filterPublicationBlockIds('website', blockIds).map((id) => {
    const title = PUBLICATION_BLOCK_CATALOG.find((block) => block.id === id).title;
    let excludedTextCount = 0;
    const safeText = (value) => {
      if (typeof value !== 'string' || !value.trim()) return false;
      if (findPrivatePublicTextToken(value)) { excludedTextCount += 1; return false; }
      return true;
    };
    const paragraphs = (values) => values.filter(safeText);
    const assets = blockAssets(id, content.assets);
    const payload = { heading: title, eyebrow: DEMO_EYEBROW };
    if (id === 'cover-watch' || id === 'media-hero') {
      payload.heading = paragraphs([content.brand, content.model]).join(' · ') || title;
      payload.facts = safeText(content.reference) ? [{ label: 'Référence', value: content.reference }] : [];
      payload.paragraphs = paragraphs([content.heroSummary]);
    } else if (id === 'reference-history') payload.paragraphs = paragraphs(content.history || []);
    else if (id === 'reference-specs') payload.groups = (content.specifications || []).map((group) => ({
      title: safeText(group.title) ? group.title : 'Caractéristiques',
      items: group.items.filter((item) => safeText(item.label) && safeText(item.value)),
    }));
    else if (id === 'reference-checks') payload.facts = (content.checks || []).filter((item) => safeText(item.label)).map((item) => ({ label: item.label, value: paragraphs([item.result, item.note]).join(' · ') }));
    else if (id === 'reference-popularity') payload.resources = (content.resources || []).filter((item) => safeText(item.name) && /^https?:\/\//i.test(item.url) && safeText(item.url)).map((item) => ({ name: item.name, url: item.url }));
    else if (id === 'condition-description') payload.paragraphs = paragraphs(content.description || []);
    else if (id === 'condition-summary') payload.paragraphs = paragraphs(content.conditionSummary || []);
    else if (id === 'condition-reference-report' || id === 'condition-prior-reviews') payload.paragraphs = paragraphs((id === 'condition-reference-report' ? (content.reports || []).slice(0, 1) : (content.reports || []).slice(1)).flatMap((item) => [item.title, item.date, item.note]));
    payload.mediaLabels = assets.map((asset, index) => (safeText(asset.name) ? asset.name : `Média ${index + 1}`));
    return { id, title, payload, assets, excludedTextCount };
  });
};

/* ----------------------------------------------------------------------------------------------
 * Dérivés WebP (sharp) depuis les fixtures publiques
 * -------------------------------------------------------------------------------------------- */

const isWebp = (bytes) => bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP';
const isStillImage = (bytes) => (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
  || (bytes.length >= 8 && bytes[0] === 0x89 && bytes.subarray(1, 4).toString('latin1') === 'PNG')
  || isWebp(bytes);

export const prepareDemoDerivative = async ({ fixturesRoot = DEFAULT_FIXTURES_ROOT, asset, publicCode, requestId }) => {
  if (asset.type !== 'image') fail('unsupported_demo_media', `${asset.id} : seules les images fixes ont un dérivé de démonstration.`);
  if (typeof asset.url !== 'string' || !asset.url.startsWith(DEMO_FIXTURE_PREFIX)) fail('fixture_out_of_scope', `${asset.id} : média hors des fixtures publiques de démonstration.`);
  const root = resolve(fixturesRoot);
  const scope = resolve(root, DEMO_FIXTURE_PREFIX.slice(1));
  const path = resolve(root, asset.url.slice(1));
  if (!path.startsWith(`${scope}${sep}`)) fail('fixture_out_of_scope', `${asset.id} : chemin de fixture hors périmètre.`);
  const source = await readFile(path);
  if (!isStillImage(source)) fail('fixture_format_unknown', `${asset.id} : signature binaire de la fixture inconnue.`);
  const bytes = await sharp(source, { failOn: 'warning', limitInputPixels: 50_000_000 })
    .rotate()
    .resize({ width: DEMO_DERIVATIVE_MAX_EDGE, height: DEMO_DERIVATIVE_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: DEMO_DERIVATIVE_WEBP_QUALITY })
    .toBuffer();
  if (!isWebp(bytes)) fail('derivative_integrity', `${asset.id} : le dérivé produit n’est pas un WebP.`);
  const { width, height } = await sharp(bytes).metadata();
  const sha256 = sha256Bytes(bytes);
  const derivativeId = `web_${createHash('sha256').update(`${requestId}:${asset.id}:${sha256}`).digest('hex').slice(0, 24)}`;
  return {
    assetId: asset.id, derivativeId, publicCode, storagePath: `public/${publicCode}/${asset.id}/${derivativeId}`,
    mediaKind: 'image', mimeType: 'image/webp', sha256, byteSize: bytes.length, sourceByteSize: source.length, width, height, bytes,
  };
};

/* ----------------------------------------------------------------------------------------------
 * Événement d'audit (même recette que createAuditEvent de projection-command.mjs, acteur demo_seed)
 * -------------------------------------------------------------------------------------------- */

export const createDemoAuditEvent = ({ rootData, requestId, uid, occurredAt, action, resource, afterDigest }) => {
  const previousEventHash = rootData.integrityHead || ZERO_HASH;
  const sequence = Number(rootData.integritySequence || 0) + 1;
  const event = {
    eventId: `evt_${sha256Digest(`${action}:${requestId}`).slice(7, 31)}`,
    cartularyId: rootData.id,
    sequence,
    occurredAt,
    actor: { uid, role: DEMO_AUDIT_ROLE },
    action,
    resource,
    beforeDigest: previousEventHash,
    afterDigest,
    previousEventHash,
    canonicalizationVersion: CANONICALIZATION_VERSION,
    requestId,
  };
  return { ...event, hash: sha256Digest({ previousEventHash, event }) };
};

const writeAuditAndRoot = ({ transaction, rootRef, rootData, requestId, uid, occurredAt, action, resource, afterDigest, rootPatch }) => {
  const auditEvent = createDemoAuditEvent({ rootData, requestId, uid, occurredAt, action, resource, afterDigest });
  const nextRevision = rootData.revision + 1;
  transaction.update(rootRef, { ...rootPatch, revision: nextRevision, integrityHead: auditEvent.hash, integritySequence: auditEvent.sequence, updatedAt: FieldValue.serverTimestamp() });
  transaction.create(rootRef.collection('auditEvents').doc(auditEvent.eventId), { ...auditEvent, occurredAt: Timestamp.fromDate(new Date(occurredAt)), occurredAtIso: occurredAt });
  return { auditEvent, nextRevision };
};

const createReceipt = ({ transaction, receiptRef, requestId, command, uid, inputDigest, result }) => {
  transaction.create(receiptRef, { requestId, command, actorId: uid, inputDigest, canonicalPayload: canonicalize(result), result, createdAt: FieldValue.serverTimestamp() });
};

/* ----------------------------------------------------------------------------------------------
 * Plan (lecture seule)
 * -------------------------------------------------------------------------------------------- */

const storagePathsOf = (blockSnapshots) => [...new Set(blockSnapshots.flatMap((snapshot) => (snapshot.data()?.assets || []).map((asset) => asset.storagePath)).filter((path) => typeof path === 'string'))];

export const planDemoPublication = async ({
  firestore, bucket = null, cartularyId, blockIds = DEFAULT_DEMO_WEBSITE_BLOCKS, includeVideo = false, videoTooling = {}, revoke = false,
  fixturesRoot = DEFAULT_FIXTURES_ROOT, blockBuilder = buildDemoWebsiteBlocks,
}) => {
  const definition = demoCartularyDefinition(cartularyId);
  if (!definition) fail('not_a_demo_cartulary', `${cartularyId} n’est pas un objet de démonstration : rien n’est lu.`);
  const publicCode = definition.publicCode;
  const blockers = [];
  const warnings = [];
  const block = (code, path, message) => blockers.push({ code, path, message });
  const mode = revoke ? 'revoke' : 'publish';

  const rootRef = firestore.doc(`cartularies/${cartularyId}`);
  const rootSnapshot = await rootRef.get();
  const rootData = rootSnapshot.exists ? rootSnapshot.data() : null;
  const root = {
    path: rootRef.path, exists: rootSnapshot.exists, revision: rootData?.revision ?? null, integritySequence: rootData?.integritySequence ?? null,
    publicationStatus: rootData?.publicationStatus ?? null, schemaVersion: rootData ? `${rootData.schemaId}@${rootData.schemaVersion}` : null,
  };
  const base = { mode, version: DEMO_PUBLICATION_VERSION, cartularyId, publicCode, object: { brand: definition.brand, model: definition.model, reference: definition.reference }, root };
  if (!rootData) {
    block('cartulary_not_found', rootRef.path, 'Racine absente : seedez le compte démo d’abord ; rien n’est écrit.');
    return { ...base, uid: null, publication: null, seal: null, blocks: [], derivatives: [], derivativeBytes: new Map(), previousPaths: [], storage: { available: Boolean(bucket), existingFileCount: null }, alreadyPublished: false, audit: null, blockers, warnings, ok: false };
  }
  if (rootData.demo !== true) block('not_demo_root', rootRef.path, 'La racine ne porte pas demo: true : rien n’est écrit.');
  if (rootData.organizationId !== DEMO_ACCOUNT.organizationId) block('organization_mismatch', rootRef.path, 'La racine n’appartient pas à l’organisation démo : rien n’est écrit.');
  if (rootData.registryId !== DEMO_ACCOUNT.registryId) block('registry_mismatch', rootRef.path, 'La racine n’est pas projetée dans le Registre démo : rien n’est écrit.');
  if (rootData.publicCode !== publicCode) block('public_code_mismatch', rootRef.path, `Le code public de la racine diffère de ${publicCode} : rien n’est écrit.`);
  if (!Number.isInteger(rootData.revision) || rootData.revision < 1) block('revision_unknown', rootRef.path, 'Révision de la racine absente : rien n’est écrit.');

  const uid = typeof rootData.accountHolderId === 'string' && rootData.accountHolderId ? rootData.accountHolderId : null;
  if (!uid) block('demo_account_mismatch', rootRef.path, 'accountHolderId absent : rien n’est écrit.');
  else {
    const [user, membership] = await Promise.all([
      firestore.doc(`users/${uid}`).get(),
      firestore.doc(`organizations/${DEMO_ACCOUNT.organizationId}/memberships/${uid}`).get(),
    ]);
    if (!user.exists || user.data().status !== 'active' || user.data().accountPurpose !== DEMO_PURPOSE) {
      block('demo_account_mismatch', `users/${uid}`, 'Le titulaire de la racine n’est pas le compte démo actif (accountPurpose public_read_only_demo) : rien n’est écrit.');
    }
    const member = membership.exists ? membership.data() : null;
    if (member && ((member.roles || []).includes('legal_owner') || (member.permissions || []).includes('publication.manage'))) {
      block('demo_account_privileged', membership.ref?.path ?? `organizations/${DEMO_ACCOUNT.organizationId}/memberships/${uid}`, 'Le compte démo partagé porte des droits de publication : corrigez l’adhésion d’abord ; rien n’est écrit.');
    }
  }

  const events = (await rootRef.collection('auditEvents').get()).docs.map((snapshot) => snapshot.data());
  const audit = verifyAuditChain({ events, integrityHead: rootData.integrityHead, integritySequence: rootData.integritySequence });
  if (!audit.valid) block('audit_chain_invalid', `${rootRef.path}/auditEvents`, `Chaîne d’audit incohérente (${audit.errors.map((entry) => entry.code).join(', ')}) : rien n’est écrit.`);

  const publicationRef = firestore.doc(`publications/${publicCode}`);
  const sealRef = firestore.doc(`seals/${publicCode}`);
  const [publicationSnapshot, sealSnapshot, blockSnapshots, mediaAccessSnapshots] = await Promise.all([
    publicationRef.get(), sealRef.get(), publicationRef.collection('blocks').get(), publicationRef.collection('mediaAccess').get(),
  ]);
  const publicationData = publicationSnapshot.exists ? publicationSnapshot.data() : null;
  const sealData = sealSnapshot.exists ? sealSnapshot.data() : null;
  if (publicationData && publicationData.cartularyId !== cartularyId) block('public_code_mismatch', publicationRef.path, 'publications/{code} appartient à un autre Cartulaire : rien n’est écrit.');
  if (sealData && sealData.cartularyId !== cartularyId) block('public_code_mismatch', sealRef.path, 'seals/{code} appartient à un autre Cartulaire : rien n’est écrit.');
  const publication = {
    path: publicationRef.path, exists: publicationSnapshot.exists, status: publicationData?.status ?? null, publicationRevision: publicationData?.publicationRevision ?? null,
    sourceRevision: publicationData?.sourceRevision ?? null, blockIds: Array.isArray(publicationData?.blockIds) ? publicationData.blockIds : [], demo: publicationData?.demo === true,
    blockCount: blockSnapshots.docs.length, mediaAccessCount: mediaAccessSnapshots.docs.length,
  };
  const seal = { path: sealRef.path, exists: sealSnapshot.exists, status: sealData?.status ?? null };
  const previousPaths = storagePathsOf(blockSnapshots.docs);

  const storage = { available: Boolean(bucket), existingFileCount: null };
  if (bucket) {
    const [files] = await bucket.getFiles({ prefix: `public/${publicCode}/` });
    storage.existingFileCount = files.length;
  } else warnings.push({ code: 'storage_unavailable', message: 'Aucun bucket Storage injecté : préfixe public/{code}/ non inventorié ; l’application exigera un bucket.' });

  const sequence = Number(rootData.integritySequence || 0) + 1;
  const requestId = `demo_${revoke ? 'revoke' : 'publish'}_${cartularyId}_${sequence}`;
  if (!IDENTIFIER.test(requestId)) block('invalid_request_id', rootRef.path, 'Identifiant de demande non conforme : rien n’est écrit.');
  const plan = {
    ...base, uid, publication, seal, previousPaths, storage, audit: { valid: audit.valid, eventCount: audit.eventCount, errors: audit.errors },
    requestId, expectedRevision: rootData.revision, expectedSequence: sequence, blocks: [], derivatives: [], derivativeBytes: new Map(), alreadyPublished: false,
  };

  if (revoke) {
    if (publication.status !== 'published') block('publication_not_active', publicationRef.path, 'Aucune publication active à retirer : rien n’est écrit.');
    return { ...plan, blockers, warnings, ok: blockers.length === 0 };
  }

  let requestedBlocks = [...blockIds];
  if (requestedBlocks.includes('media-motion') && !includeVideo) {
    requestedBlocks = requestedBlocks.filter((id) => id !== 'media-motion');
    warnings.push({ code: 'video_not_included', message: 'Bloc media-motion retiré de la sélection : la vidéo exige --include-video.' });
  }
  if (includeVideo) {
    if (!videoTooling.ffmpegPath || !videoTooling.ffprobePath) block('video_tooling_missing', 'media-motion', 'FFMPEG_PATH et FFPROBE_PATH sont requis pour --include-video : rien n’est écrit.');
    else block('video_source_unsupported', 'media-motion', 'La fixture vidéo de démonstration est en webm, hors liste blanche (mov/mp4) du transcodeur : convertissez-la avant de republier ; rien n’est écrit.');
    if (!requestedBlocks.includes('media-motion')) requestedBlocks.push('media-motion');
  }
  let blocks = [];
  try {
    blocks = blockBuilder({ definition, blockIds: requestedBlocks });
    validatePublicProjectionBlocks(blocks.map((entry) => ({ id: entry.id, title: entry.title, payload: entry.payload, assetRefs: [] })));
  } catch (error) {
    block(error?.code || 'invalid_blocks', publicationRef.path, `${error?.message || String(error)} Rien n’est écrit.`);
  }
  if (!blockers.length && !blocks.length) block('no_blocks', publicationRef.path, 'Aucun bloc publiable dans la sélection : rien n’est écrit.');
  plan.blocks = blocks.map((entry) => ({ id: entry.id, title: entry.title, assetIds: entry.assets.map((asset) => asset.id), excludedTextCount: entry.excludedTextCount }));
  const selectedBlockIds = blocks.map((entry) => entry.id);
  plan.alreadyPublished = publication.exists && publication.status === 'published' && publication.demo && publicationData.cartularyId === cartularyId
    && publication.sourceRevision === rootData.revision && sameSet(publication.blockIds, selectedBlockIds);
  if (blockers.length || plan.alreadyPublished) return { ...plan, blockers, warnings, ok: blockers.length === 0 };

  const uniqueAssets = [...new Map(blocks.flatMap((entry) => entry.assets).map((asset) => [asset.id, asset])).values()];
  const derivativesByAsset = new Map();
  for (const asset of uniqueAssets) {
    try {
      const derivative = await prepareDemoDerivative({ fixturesRoot, asset, publicCode, requestId });
      derivativesByAsset.set(asset.id, derivative);
    } catch (error) {
      block(error?.code || 'derivative_failed', `public/${publicCode}/${asset.id}/`, `${error?.message || String(error)} Rien n’est écrit.`);
    }
  }
  if (blockers.length) return { ...plan, blockers, warnings, ok: false };
  const projectedBlocks = blocks.map((entry) => ({
    blockId: entry.id, title: entry.title, payload: entry.payload,
    assets: entry.assets.map((asset) => {
      const derivative = derivativesByAsset.get(asset.id);
      return { assetId: derivative.assetId, derivativeId: derivative.derivativeId, mediaKind: derivative.mediaKind, mimeType: derivative.mimeType, storagePath: derivative.storagePath, contentHash: derivative.sha256 };
    }),
  }));
  const publicationRevision = publication.exists ? Number(publicationData.publicationRevision || 0) + 1 : 1;
  const contentHash = sha256Digest({ publicCode, cartularyId, assetType: rootData.assetType, schemaVersion: root.schemaVersion, sourceRevision: rootData.revision, publicationRevision, blocks: projectedBlocks });
  const derivatives = [...derivativesByAsset.values()];
  const nextPaths = new Set(derivatives.map((derivative) => derivative.storagePath));
  return {
    ...plan,
    projectedBlocks, publicationRevision, contentHash, approvalId: `approval_${sha256Digest(requestId).slice(7, 31)}`,
    derivatives: derivatives.map(({ bytes: _bytes, ...derivative }) => derivative),
    derivativeBytes: new Map(derivatives.map((derivative) => [derivative.storagePath, derivative.bytes])),
    stalePaths: previousPaths.filter((path) => !nextPaths.has(path)),
    blockers, warnings, ok: blockers.length === 0,
  };
};

/* ----------------------------------------------------------------------------------------------
 * Application : Storage → dérivés → transaction miroir de publishPublicBlocks ; retrait
 * -------------------------------------------------------------------------------------------- */

const assertApplicable = (plan, mode) => {
  if (!plan || plan.mode !== mode) fail('plan_mode_mismatch', `Plan ${plan?.mode ?? 'absent'} inattendu pour ${mode} : rien n’est écrit.`);
  if (plan.blockers.length) fail('plan_blocked', `Plan bloqué (${plan.blockers.map((entry) => entry.code).join(', ')}) : rien n’est écrit.`);
};
const derivativeRef = (firestore, cartularyId, storagePath) => {
  const parts = storagePath.split('/');
  return parts.length === 4 ? firestore.doc(`cartularies/${cartularyId}/assets/${parts[2]}/derivatives/${parts[3]}`) : null;
};
const retirePaths = async ({ firestore, bucket, cartularyId, paths, warnings }) => {
  const cleaned = [];
  for (const path of paths) {
    try {
      if (bucket) await bucket.file(path).delete({ ignoreNotFound: true });
      const ref = derivativeRef(firestore, cartularyId, path);
      if (ref && (await ref.get()).exists) await ref.set({ processingState: 'revoked' }, { merge: true });
      cleaned.push(path);
    } catch (error) {
      warnings.push({ code: 'media_cleanup_pending', path, message: `Copie publique non supprimée (${error?.message || error}) : relancer le retrait.` });
    }
  }
  return cleaned;
};

export const applyDemoPublication = async ({ firestore, bucket, plan, now = new Date().toISOString() }) => {
  assertApplicable(plan, 'publish');
  if (plan.alreadyPublished) return { status: 'already_published', publicCode: plan.publicCode, revision: plan.expectedRevision, writes: [], uploadedPaths: [], cleanedPaths: [], warnings: [], ok: true };
  if (!bucket) fail('storage_required', 'Aucun bucket Storage : les dérivés publics ne peuvent pas être déposés ; rien n’est écrit.');
  const { cartularyId, publicCode, uid, requestId, approvalId, expectedRevision, contentHash, publicationRevision, projectedBlocks } = plan;
  const occurredAt = now;
  const uploaded = [];
  const derivativeDocs = [];
  const warnings = [];
  const rollback = async () => {
    for (const path of uploaded) { try { await bucket.file(path).delete({ ignoreNotFound: true }); } catch { /* signalé ci-dessous */ } }
    for (const ref of derivativeDocs) { try { await ref.delete(); } catch { /* signalé ci-dessous */ } }
  };
  try {
    // (a) Storage puis (b) dérivés, comme prepareDerivative de website-publication-command.mjs.
    for (const derivative of plan.derivatives) {
      const bytes = plan.derivativeBytes.get(derivative.storagePath);
      if (!bytes) fail('derivative_missing', `Octets absents pour ${derivative.storagePath}.`);
      await bucket.file(derivative.storagePath).save(bytes, { resumable: false, metadata: {
        contentType: derivative.mimeType, cacheControl: PUBLIC_CACHE_CONTROL,
        metadata: { publicCode, assetId: derivative.assetId, derivativeId: derivative.derivativeId, metadataStripped: 'true', firebaseStorageDownloadTokens: '' },
      } });
      uploaded.push(derivative.storagePath);
      const ref = firestore.doc(`cartularies/${cartularyId}/assets/${derivative.assetId}/derivatives/${derivative.derivativeId}`);
      await ref.set({ assetId: derivative.assetId, derivativeId: derivative.derivativeId, publicCode, visibility: 'public', processingState: 'ready', mediaKind: derivative.mediaKind, mimeDetected: derivative.mimeType, storagePath: derivative.storagePath, sha256: derivative.sha256 });
      derivativeDocs.push(ref);
    }
    // (c) transaction unique, écritures de publishPublicBlocks (projection-command.mjs) reproduites.
    const rootRef = firestore.doc(`cartularies/${cartularyId}`);
    const publicationRef = firestore.doc(`publications/${publicCode}`);
    const sealRef = firestore.doc(`seals/${publicCode}`);
    const approvalRef = rootRef.collection('publicationApprovals').doc(approvalId);
    const receiptRef = rootRef.collection('commandReceipts').doc(requestId);
    const inputDigest = sha256Digest({ command: 'publishDemoWebsite', cartularyId, approvalId, expectedRevision, contentHash });
    const result = await firestore.runTransaction(async (transaction) => {
      const [root, publication, seal, approval, receipt, previousBlocks, previousMediaAccess] = await Promise.all([
        transaction.get(rootRef), transaction.get(publicationRef), transaction.get(sealRef), transaction.get(approvalRef), transaction.get(receiptRef),
        transaction.get(publicationRef.collection('blocks')), transaction.get(publicationRef.collection('mediaAccess')),
      ]);
      if (!root.exists) fail('cartulary_not_found', 'Racine disparue pendant la publication.');
      const rootData = root.data();
      if (rootData.revision !== expectedRevision) fail('revision_conflict', `Révision attendue ${expectedRevision}, révision courante ${rootData.revision} : relancez la simulation.`);
      if (receipt.exists) fail('request_reused', `Reçu ${requestId} déjà présent : relancez la simulation.`);
      if (approval.exists) fail('approval_exists', `Approbation ${approvalId} déjà présente : relancez la simulation.`);
      const currentPublicationRevision = publication.exists ? Number(publication.data().publicationRevision || 0) + 1 : 1;
      if (currentPublicationRevision !== publicationRevision) fail('revision_conflict', 'La publication a changé depuis la simulation : relancez-la.');
      const { auditEvent, nextRevision } = writeAuditAndRoot({
        transaction, rootRef, rootData, requestId, uid, occurredAt, action: 'publication.published', resource: { type: 'publication', id: publicCode },
        afterDigest: contentHash, rootPatch: { publicationStatus: 'published' },
      });
      const decidedAt = Timestamp.fromDate(new Date(occurredAt));
      const approvalBlocks = projectedBlocks.map((entry) => ({ id: entry.blockId, title: entry.title, payload: entry.payload, assetRefs: entry.assets.map((asset) => ({ assetId: asset.assetId, derivativeId: asset.derivativeId })) }));
      transaction.create(approvalRef, {
        approvalId, cartularyId, organizationId: rootData.organizationId, audience: 'public', status: 'consumed', decisionSource: DEMO_DECISION_SOURCE,
        approvedBy: uid, approvedAt: decidedAt, approvedAtIso: occurredAt, sourceRevision: nextRevision, schemaVersion: `${rootData.schemaId}@${rootData.schemaVersion}`,
        blockIds: approvalBlocks.map((entry) => entry.id), blocks: approvalBlocks, contentHash: sha256Digest({ audience: 'public', blocks: approvalBlocks }),
        consumedAt: decidedAt, consumedBy: publicationRef.path,
      });
      transaction.set(publicationRef, {
        publicCode, cartularyId, audience: 'public', assetType: rootData.assetType, schemaVersion: `${rootData.schemaId}@${rootData.schemaVersion}`,
        displayTitle: rootData.displayTitle, makerName: rootData.makerName, modelName: rootData.modelName, referenceCode: rootData.referenceCode,
        status: 'published', publicationStatus: 'published', publicationRevision, sourceRevision: nextRevision,
        blockIds: projectedBlocks.map((entry) => entry.blockId), assetCount: plan.derivatives.length, contentHash,
        generatedAt: FieldValue.serverTimestamp(), publishedAt: decidedAt, publishedAtIso: occurredAt, revokedAt: null,
        demo: true, demoDisclaimer: DEMO_DISCLAIMER,
      });
      for (const entry of projectedBlocks) {
        transaction.set(publicationRef.collection('blocks').doc(entry.blockId), { ...entry, sourceRevision: nextRevision, publicationStatus: 'published', contentHash: sha256Digest(entry), generatedAt: FieldValue.serverTimestamp() });
      }
      for (const previous of previousBlocks.docs) if (!projectedBlocks.some((entry) => entry.blockId === previous.id)) transaction.delete(previous.ref);
      const mediaAccess = new Map();
      for (const derivative of plan.derivatives) mediaAccess.set(derivative.assetId, [...(mediaAccess.get(derivative.assetId) || []), derivative.derivativeId]);
      for (const [assetId, derivativeIds] of mediaAccess) transaction.set(publicationRef.collection('mediaAccess').doc(assetId), { derivativeIds });
      for (const previous of previousMediaAccess.docs) if (!mediaAccess.has(previous.id)) transaction.delete(previous.ref);
      const sealData = {
        publicCode, cartularyId, publicationPath: publicationRef.path, status: 'issued', contentHash,
        supportCode: `S-${sha256Digest(publicCode).slice(7, 15).toUpperCase()}`, issuedAt: decidedAt, issuedAtIso: occurredAt,
        schemaVersion: `${rootData.schemaId}@${rootData.schemaVersion}`, publicationRevision, revokedAt: null,
      };
      if (seal.exists) transaction.update(sealRef, sealData); else transaction.create(sealRef, sealData);
      const summary = { cartularyId, publicCode, publicationRevision, revision: nextRevision, sourceRevision: nextRevision, auditEventId: auditEvent.eventId, contentHash, blockIds: projectedBlocks.map((entry) => entry.blockId), assetCount: plan.derivatives.length };
      createReceipt({ transaction, receiptRef, requestId, command: 'publishDemoWebsite', uid, inputDigest, result: summary });
      return summary;
    });
    // (d) copies publiques d'une publication précédente qui ne sont plus référencées.
    const cleanedPaths = await retirePaths({ firestore, bucket, cartularyId, paths: plan.stalePaths || [], warnings });
    return { status: 'published', ...result, requestId, approvalId, uploadedPaths: uploaded, cleanedPaths, warnings, ok: true };
  } catch (error) {
    await rollback();
    throw new DemoPublicationError(error?.code || 'publication_failed', `${error?.message || String(error)} Copies publiques et dérivés déposés retirés (rolled_back).`, { rolledBack: true, rolledBackPaths: uploaded });
  }
};

export const revokeDemoPublication = async ({ firestore, bucket = null, plan, now = new Date().toISOString() }) => {
  assertApplicable(plan, 'revoke');
  const { cartularyId, publicCode, uid, requestId, expectedRevision } = plan;
  const occurredAt = now;
  const rootRef = firestore.doc(`cartularies/${cartularyId}`);
  const publicationRef = firestore.doc(`publications/${publicCode}`);
  const sealRef = firestore.doc(`seals/${publicCode}`);
  const receiptRef = rootRef.collection('commandReceipts').doc(requestId);
  const inputDigest = sha256Digest({ command: 'revokeDemoWebsite', cartularyId, expectedRevision });
  const result = await firestore.runTransaction(async (transaction) => {
    const [root, publication, seal, receipt, blocks, mediaAccess] = await Promise.all([
      transaction.get(rootRef), transaction.get(publicationRef), transaction.get(sealRef), transaction.get(receiptRef),
      transaction.get(publicationRef.collection('blocks')), transaction.get(publicationRef.collection('mediaAccess')),
    ]);
    if (!root.exists) fail('cartulary_not_found', 'Racine disparue pendant le retrait.');
    const rootData = root.data();
    if (rootData.revision !== expectedRevision) fail('revision_conflict', `Révision attendue ${expectedRevision}, révision courante ${rootData.revision} : relancez la simulation.`);
    if (receipt.exists) fail('request_reused', `Reçu ${requestId} déjà présent : relancez la simulation.`);
    if (!publication.exists || publication.data().status !== 'published') fail('publication_not_active', 'Aucune publication active à retirer.');
    const paths = storagePathsOf(blocks.docs);
    const revokedDigest = sha256Digest({ publicCode, previousContentHash: publication.data().contentHash, status: 'revoked', occurredAt });
    const { auditEvent, nextRevision } = writeAuditAndRoot({
      transaction, rootRef, rootData, requestId, uid, occurredAt, action: 'publication.revoked', resource: { type: 'publication', id: publicCode },
      afterDigest: revokedDigest, rootPatch: { publicationStatus: 'revoked' },
    });
    for (const entry of blocks.docs) transaction.delete(entry.ref);
    for (const entry of mediaAccess.docs) transaction.delete(entry.ref);
    const revokedAt = Timestamp.fromDate(new Date(occurredAt));
    transaction.update(publicationRef, {
      status: 'revoked', publicationStatus: 'revoked', publicationRevision: Number(publication.data().publicationRevision || 0) + 1, sourceRevision: nextRevision,
      blockIds: [], assetCount: 0, revokedAt, revokedAtIso: occurredAt, contentHash: revokedDigest,
    });
    if (seal.exists) transaction.update(sealRef, { status: 'revoked', revokedAt, revokedAtIso: occurredAt });
    const summary = { cartularyId, publicCode, revision: nextRevision, sourceRevision: nextRevision, auditEventId: auditEvent.eventId, contentHash: revokedDigest, revokedBlockCount: blocks.docs.length };
    createReceipt({ transaction, receiptRef, requestId, command: 'revokeDemoWebsite', uid, inputDigest, result: summary });
    return { ...summary, paths };
  });
  const warnings = [];
  if (!bucket) warnings.push({ code: 'storage_unavailable', message: 'Aucun bucket Storage : les copies publiques restent à supprimer (illisibles, la publication étant revoked).' });
  const cleanedPaths = await retirePaths({ firestore, bucket, cartularyId, paths: result.paths, warnings });
  const { paths, ...summary } = result;
  return { status: 'revoked', ...summary, requestId, retiredPaths: paths, cleanedPaths, warnings, ok: true };
};

/* ----------------------------------------------------------------------------------------------
 * Rapport et CLI
 * -------------------------------------------------------------------------------------------- */

/** Rapport JSON unique : chemins, compteurs, empreintes tronquées ; jamais d'octets ni de contenu. */
export const describeDemoPublicationRun = ({ plan, applied = null, dryRun = applied === null, projectId = null, usesEmulator = null }) => ({
  event: applied ? (applied.status === 'revoked' ? 'DEMO_PUBLICATION_REVOKED' : 'DEMO_PUBLICATION_APPLIED') : 'DEMO_PUBLICATION_PLAN',
  version: DEMO_PUBLICATION_VERSION,
  projectId, usesEmulator, dryRun, mode: plan.mode,
  cartularyId: plan.cartularyId, publicCode: plan.publicCode, object: plan.object, uid: plan.uid,
  root: plan.root, audit: plan.audit, publication: plan.publication, seal: plan.seal, storage: plan.storage,
  requestId: plan.requestId ?? null, approvalId: plan.approvalId ?? null, expectedRevision: plan.expectedRevision ?? null,
  publicationRevision: plan.publicationRevision ?? null, contentHash: shortHash(plan.contentHash),
  blocks: plan.blocks, blockCount: plan.blocks.length,
  derivatives: plan.derivatives.map((derivative) => ({ assetId: derivative.assetId, derivativeId: derivative.derivativeId, storagePath: derivative.storagePath, mimeType: derivative.mimeType, byteSize: derivative.byteSize, sourceByteSize: derivative.sourceByteSize, width: derivative.width, height: derivative.height, sha256: shortHash(derivative.sha256) })),
  derivativeCount: plan.derivatives.length, derivativeBytes: plan.derivatives.reduce((total, derivative) => total + derivative.byteSize, 0),
  previousPaths: plan.previousPaths, stalePaths: plan.stalePaths ?? [],
  alreadyPublished: plan.alreadyPublished,
  writes: plan.mode === 'revoke'
    ? [plan.root.path, `${plan.root.path}/auditEvents/*`, `${plan.root.path}/commandReceipts/${plan.requestId}`, plan.publication?.path, plan.seal?.path, ...plan.previousPaths]
    : plan.alreadyPublished || !plan.ok ? [] : [
      ...plan.derivatives.map((derivative) => derivative.storagePath),
      ...plan.derivatives.map((derivative) => `${plan.root.path}/assets/${derivative.assetId}/derivatives/${derivative.derivativeId}`),
      plan.root.path, `${plan.root.path}/auditEvents/*`, `${plan.root.path}/publicationApprovals/${plan.approvalId}`, `${plan.root.path}/commandReceipts/${plan.requestId}`,
      plan.publication.path, ...plan.blocks.map((entry) => `${plan.publication.path}/blocks/${entry.id}`), ...plan.derivatives.map((derivative) => `${plan.publication.path}/mediaAccess/${derivative.assetId}`), plan.seal.path,
    ],
  blockers: plan.blockers, warnings: [...plan.warnings, ...(applied?.warnings ?? [])],
  applied: applied ? { ...applied, contentHash: shortHash(applied.contentHash), warnings: undefined } : null,
  ok: applied ? applied.ok : plan.ok,
});

export const runDemoPublication = async ({ firestore, bucket = null, cartularyId, blockIds, includeVideo = false, videoTooling = {}, revoke = false, apply = false, fixturesRoot, projectId = null, usesEmulator = null, now }) => {
  const plan = await planDemoPublication({ firestore, bucket, cartularyId, blockIds, includeVideo, videoTooling, revoke, fixturesRoot });
  let applied = null;
  if (apply && plan.ok) applied = revoke ? await revokeDemoPublication({ firestore, bucket, plan, now }) : await applyDemoPublication({ firestore, bucket, plan, now });
  return { plan, applied, report: describeDemoPublicationRun({ plan, applied, dryRun: !apply, projectId, usesEmulator }) };
};

/**
 * CLI complet sans initialisation Firebase : `firestore` et `bucket` sont des instances ou des
 * fabriques appelées seulement après validation des arguments et des garde-fous distants.
 */
export const runDemoPublicationCli = async ({ argv = [], env = {}, firestore, bucket = null, stdout = process.stdout, stderr = process.stderr, fixturesRoot, now }) => {
  const failWith = (code, message, extra = {}) => {
    stderr.write(`${JSON.stringify({ event: 'DEMO_PUBLICATION_FAILED', code, message, ...extra })}\n`);
    return { exitCode: 1, report: null };
  };
  const parsed = parseDemoPublicationArgs(argv, env);
  if (!parsed.ok) return failWith(parsed.code, `${parsed.message}\n${DEMO_PUBLICATION_USAGE}`);
  const { options } = parsed;
  if (options.help) { stdout.write(`${DEMO_PUBLICATION_USAGE}\n`); return { exitCode: 0, report: null }; }
  if (!options.usesEmulator && !options.projectId) {
    return failWith('project_required', `Hors émulateur, GCLOUD_PROJECT ou FIREBASE_PROJECT_ID doit désigner explicitement le projet, même en simulation : aucun repli sur un projet distant par défaut.\n${DEMO_PUBLICATION_USAGE}`);
  }
  if (!options.usesEmulator && !options.allowRemote) {
    return failWith('remote_not_allowed', 'Publication interrompue : hors émulateur, --allow-remote est obligatoire même en simulation (identifiants Admin).');
  }
  try {
    const context = { projectId: options.projectId, usesEmulator: options.usesEmulator };
    const store = typeof firestore === 'function' ? await firestore(context) : firestore;
    if (!store) fail('firestore_unavailable', 'Aucune instance Firestore.');
    const storage = typeof bucket === 'function' ? await bucket(context) : bucket;
    const { report } = await runDemoPublication({
      firestore: store, bucket: storage, cartularyId: options.cartularyId, blockIds: options.blocks, includeVideo: options.includeVideo, videoTooling: options.videoTooling,
      revoke: options.revoke, apply: options.apply && options.confirmDemoPublication, fixturesRoot, projectId: options.projectId, usesEmulator: options.usesEmulator, now,
    });
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return { exitCode: report.ok ? 0 : 1, report };
  } catch (error) {
    return failWith(error?.code || 'publication_failed', error?.message || String(error), error?.rolledBack ? { rolledBack: true, rolledBackPaths: error.rolledBackPaths } : {});
  }
};
