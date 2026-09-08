import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import {
  buildRolexDossierState,
  buildRolexImportBundle,
  ROLEX_CARTULARY_ID,
  ROLEX_IMPORT_ACTOR_ID,
  ROLEX_IMPORT_DATE,
  ROLEX_IMPORT_REQUEST_ID,
  ROLEX_PUBLIC_CODE,
} from '../../src/migrations/rolexImport.ts';
import { verifyAuditChain } from './audit-verifier.mjs';
import { canonicalize, sha256Digest } from './canonical-json.mjs';
import { importCartularyBundle } from './import-cartulary-command.mjs';
import { markCartularySyncRequestFailed, processCartularySyncRequest } from './live-sync-command.mjs';
import { projectRegistryItem } from './projection-command.mjs';

/**
 * Seed du dossier Rolex du pilote (ADR-029), en deux temps.
 *
 * `planRolexDossier` lit et n'écrit jamais. Il détecte si la racine `cartularies/{id}` existe :
 * - absente → mode `create` : import du bundle + projection Registre avec l'acteur de la fixture,
 *   comme la séquence de seed locale (hors émulateur, seulement avec `--allow-create`) ;
 * - présente → mode `existing` (cas de la production, Cartulaire créé depuis le Registre) : ni
 *   import ni projection, propriétaire tiré de `accountHolderId`, jamais de repli sur la fixture.
 * Puis il compare chaque clé de `buildRolexDossierState()` au brouillon privé du propriétaire et
 * décide une action par clé. Il vérifie aussi les préconditions que la synchronisation exigera
 * (membership `legal_owner` actif avec `cartulary.edit` et le registre dans ses scopes, registre du
 * même tenant : `assertOwnerEditor` de live-sync-command.mjs) et l'état de la demande de
 * synchronisation. `applyRolexDossier` exécute ce plan : refus avant toute écriture si le plan est
 * `blocked`, brouillon créé s'il manque, une transaction par clé à écrire (révision relue, sinon
 * `raced`), puis une demande de synchronisation traitée localement ou attendue si la Cloud
 * Function déployée l'a réclamée.
 *
 * Règles de non-écrasement :
 * - une clé absente est créée ; une clé égale (comparaison canonique) est laissée (`unchanged`) ;
 * - une clé existante différente ou supprimée n'est réécrite qu'avec `--force --key <clé>`
 *   (`kept` sinon) ; `--force` seul est refusé ;
 * - en mode `existing`, les clés qui pilotent la projection Registre (montants, statut, titre)
 *   ne sont ni créées ni réécrites sans `--projection-keys` (`kept_projection`) ; avec
 *   `--projection-keys --key <clé>`, seules les clés de projection nommées sont concernées ;
 * - `cartularia-public-code` n'est jamais réécrite si elle contredit le code public de la racine ;
 * - une opération générique du lecteur en attente (`cartularia-generic-operation`) est signalée
 *   (`generic_operation_pending`, non simulée par l'aperçu) et bloque le plan si sa `baseRevision`
 *   n'est plus celle de la racine (`generic_operation_stale`) ; `first_authoritative_sync` prévient
 *   que la racine n'a pas encore de `liveStateDigest`.
 *
 * Demande de synchronisation : une demande `pending`/`processing` n'est jamais écrasée par défaut.
 * Si le plan doit synchroniser (écritures, `--resync` ou `sync_required`) alors qu'une demande est
 * en cours, il est `blocked` (`request_in_flight`, ok:false) et rien n'est écrit : une demande
 * bloquée (Cloud Function tuée après `claimQueuedOperation`, `pending` jamais déclenchée) ne peut
 * être remplacée par le navigateur (firestore.rules n'autorise le remplacement qu'après
 * `processed`/`failed`). Seul `--replace-stale-request` la remplace, et seulement si son
 * `requestedAt`/`processingStartedAt` a plus de STALE_SYNC_REQUEST_MS.
 *
 * Les documents d'état ne portent aucune trace d'auteur (huit champs, firestore.rules) et le
 * lecteur, la création et ce script produisent les mêmes `revision`/`clientUpdatedAt` : aucune
 * heuristique ne distingue une clé seedée d'une saisie du propriétaire, d'où la conservation par
 * défaut. Le rapport n'expose jamais une valeur d'état (numéro de série, prix : données Secret),
 * seulement des empreintes à clé aléatoire par exécution (non inversibles par force brute, égalité
 * vérifiable dans un même rapport), des tailles et des noms de champs. Le bloc `projection`, lui,
 * expose par construction les montants de la racine et de l'item Registre (D1) : le rapport est
 * une donnée Secret.
 */

export class RolexDossierCommandError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RolexDossierCommandError';
    this.code = code;
  }
}

/**
 * Hors de l'énumération de firestore.rules (`private_draft_synchronized`, `manual_retry`), qui ne
 * s'applique qu'aux écritures du navigateur : le script écrit avec l'Admin SDK et une raison
 * distincte garde la demande traçable comme seed ADR-029 (voir docs/ADR-029, §Conséquences).
 */
export const ROLEX_SYNC_REQUEST_REASON = 'rolex_dossier_seed_adr029';

/** Clés de la fixture relues par la synchronisation pour recalculer la racine et l'item Registre (live-sync-command.mjs l.238-286). */
export const PROJECTION_DRIVING_STATE_KEYS = Object.freeze([
  'cartularia-creation-profile',
  'cartularia-specification-groups',
  'cartularia-watch-status',
  'cartularia-purchase',
  'cartularia-purchase-expenses',
  'cartularia-retained-valuation',
]);

/** Champs de la racine et de l'item Registre recalculés depuis ces clés (live-sync-command.mjs l.364-408). */
export const PROJECTION_FIELDS = Object.freeze([
  'purchasePrice', 'costBasis', 'grossValuation', 'netValuation', 'valuationCurrency',
  'makerName', 'modelName', 'referenceCode', 'manufactureYear', 'patrimonialStatus',
]);

/**
 * Ancienneté au-delà de laquelle `--replace-stale-request` remplace une demande en cours :
 * syncCartularyToRegistry est déployée avec timeoutSeconds 120 et retry:false
 * (scripts/firebase-functions.mjs) ; une demande `pending`/`processing` plus vieille que 15 minutes
 * n'est plus traitée par personne.
 */
export const STALE_SYNC_REQUEST_MS = 15 * 60 * 1_000;

export const ROLEX_DOSSIER_USAGE = `Utilisation :
  node scripts/import-rolex-cartulary.mjs [--dry-run] [--allow-remote] [--projection-keys [--key <clé> …]]
                                          [--resync] [--force --key <clé> [--key <clé> …]] [--allow-create]
                                          [--replace-stale-request]

Options :
  --dry-run           lecture seule : calcule et affiche le plan, n'écrit rien (autorisé sans émulateur,
                      mais GCLOUD_PROJECT ou FIREBASE_PROJECT_ID reste obligatoire hors émulateur).
                      Code 1 si le plan est bloqué (create_not_allowed_remote, audit_chain_invalid,
                      owner_not_editor, registry_not_ready, generic_operation_stale, request_in_flight)
                      ou si une synchronisation est requise sans --resync (sync_required).
  --allow-remote      requis pour écrire hors émulateur, avec des identifiants Admin.
  --projection-keys   autorise la création des clés qui pilotent la projection Registre
                      (cartularia-creation-profile, -specification-groups, -watch-status, -purchase,
                      -purchase-expenses, -retained-valuation) ; sans ce drapeau : kept_projection.
                      Avec --key <clé> (répétable, sans --force) : seules les clés de projection nommées
                      sont créées, les autres restent kept_projection ; sans --key : toutes.
  --force --key <clé> réécrit uniquement la clé nommée si elle existe avec une autre valeur (ou
                      supprimée) ; --key est répétable ; --force sans --key est refusé ;
                      cartularia-public-code n'est jamais réécrite si elle contredit la racine ;
                      une clé de projection exige aussi --projection-keys ; dès qu’un --key est présent,
                      seules les clés de projection nommées sont créées ou réécrites, aucune si --key
                      ne nomme que des clés hors projection (projection_keys_without_effect).
  --resync            demande la synchronisation même sans écriture (demande précédente failed,
                      brouillon en avance sur root.liveStateDigest).
  --replace-stale-request
                      remplace une demande de synchronisation pending/processing bloquée depuis plus
                      de 15 minutes (requestedAt / processingStartedAt) ; sans ce drapeau, une demande
                      en cours bloque le plan (request_in_flight, rien n'est écrit).
  --allow-create      hors émulateur seulement : autorise le mode create (racine absente).
  --help, -h          cette aide.

Variables :
  CARTULARIA_OWNER_UID   facultatif : doit coïncider avec accountHolderId de la racine (sinon
                         owner_mismatch, rien n'est écrit) ou avec l'acteur de la fixture en mode create.
  GCLOUD_PROJECT / FIREBASE_PROJECT_ID
                         projet Firebase : OBLIGATOIRE hors émulateur, même en --dry-run (sinon
                         project_required, code 1, Firebase jamais initialisé : aucun repli implicite
                         sur un projet distant) ; sous émulateur, défaut cartularia-wave2-local.
  FIRESTORE_EMULATOR_HOST  présent → émulateur (seed local, mode create autorisé).

Modes :
  racine cartularies/{id} absente  → create : import + projection + brouillon + état + sync ;
  racine présente                  → existing : brouillon + état + sync, propriétaire = accountHolderId.
  Actions par clé : create, update, unchanged, kept, kept_projection, conflict_with_root, raced.
  En production, la racine Rolex a reçu son code public à la création depuis le Registre :
  cartularia-public-code est attendue en conflict_with_root (jamais écrite), ce n'est pas une anomalie.

Lecture du rapport :
  - premier passage en production (brouillon avec les 4 clés de création) : attendu create 6,
    kept_projection 6, conflict_with_root 1, kept 1 (cartularia-editable-copy), editor.ok true,
    sync.expected planned ;
  - second passage : unchanged 6, kept 1 (0 et unchanged 7 si cartularia-editable-copy a été forcée),
    kept_projection 6, conflict_with_root 1, sync skipped (no_state_change). Un « unchanged » plus
    élevé signifierait qu'une clé de projection ou le code public a été réécrit : anomalie ;
  - fixtureDigest / existingDigest sont des sha256 salés par exécution : deux rapports ne se comparent
    pas par leurs empreintes ; comparer les actions, differingFields et les tailles (…Bytes) ;
  - la synchronisation consomme le quota cartulary_sync du propriétaire (120 par heure) et
    l'événement d'audit cartulary.live_state.synced est attribué au propriétaire (actor.uid) : seule
    la reason rolex_dossier_seed_adr029 de la demande trace le seed ;
  - first_authoritative_sync : la racine n'a pas de liveStateDigest, la synchronisation du seed sera
    la première synchronisation autoritaire de TOUT le brouillon (médias legacy, todos, sections
    génériques), pas seulement des clés créées ;
  - generic_operation_pending : une saisie générique du lecteur attend sa synchronisation ; l'aperçu
    projection.afterPlan ne la simule pas (projection.applied peut différer) ; si sa baseRevision
    n'est plus celle de la racine, le plan est bloqué (generic_operation_stale) : la synchronisation
    échouerait en revision_conflict ;
  - au-delà du délai d'attente du verdict de la Cloud Function (150 s, fonction déployée à 120 s), la
    demande du seed est marquée failed (sync_timeout) ; relancer --dry-run puis --resync.

Production (identifiants de la session Firebase CLI) :
  GCLOUD_PROJECT=<projet> node scripts/run-with-firebase-cli-adc.mjs -- node scripts/import-rolex-cartulary.mjs --dry-run
  GCLOUD_PROJECT=<projet> node scripts/run-with-firebase-cli-adc.mjs -- node scripts/import-rolex-cartulary.mjs --allow-remote

Sortie : un objet JSON ROLEX_CARTULARY_SEED sur stdout (donnée Secret : le bloc projection porte les
montants de la racine) ; en erreur ROLEX_CARTULARY_SEED_FAILED sur stderr, code 1.`;

const PUBLIC_CODE_STATE_KEY = 'cartularia-public-code';
const EDITABLE_COPY_STATE_KEY = 'cartularia-editable-copy';
/** Marqueur écrit par le lecteur unique avec chaque saisie générique (src/services/genericCartulary.ts l.76-88). */
const GENERIC_OPERATION_STATE_KEY = 'cartularia-generic-operation';
const GENERIC_DRAFT_STATE_KEYS = Object.freeze({ sections: 'cartularia-generic-sections', media: 'cartularia-generic-media' });
const GENERIC_OPERATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,160}$/;
const DRAFT_RETENTION_POLICY_VERSION = 'inactive-plus-2y-v1';
const IN_FLIGHT_SYNC_STATUSES = new Set(['pending', 'processing']);
const WRITE_ACTIONS = new Set(['create', 'update']);
/**
 * Attente du verdict de la Cloud Function quand elle a réclamé la demande avant le script :
 * syncCartularyToRegistry est déployée avec timeoutSeconds 120 (scripts/firebase-functions.mjs) ;
 * au-delà de 150 s la demande est marquée failed (sync_timeout). Sans risque de double traitement :
 * la transaction finale de processCartularySyncRequest relit status === 'processing' et rend
 * superseded si la fonction termine après le marquage.
 */
const DEFAULT_POLL_TIMEOUT_MS = 150_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DIGEST_LENGTH = 12;
const FIXTURE_STATE_KEYS = Object.freeze([...buildRolexDossierState().keys()]);
/** Clés exclues du brouillon relu par la synchronisation (live-sync-command.mjs l.12-19). */
const REGISTRY_FORBIDDEN_STATE_KEYS = new Set([
  'cartularia-owner-fields',
  'cartularia-owner-type',
  'cartularia-owner-documents',
  'cartularia-transmission-recipients',
  'cartularia-storage-locations',
  'cartularia-storage-description',
]);
const BOOLEAN_FLAGS = new Map([
  ['--dry-run', 'dryRun'],
  ['--force', 'force'],
  ['--allow-remote', 'allowRemote'],
  ['--projection-keys', 'projectionKeys'],
  ['--resync', 'resync'],
  ['--allow-create', 'allowCreate'],
  ['--replace-stale-request', 'replaceStaleRequest'],
]);
/** Expectations du plan qui rendent ok:false en simulation et refusent l'application avant toute écriture. */
const BLOCKING_EXPECTATIONS = new Set(['blocked', 'required']);
const FAILED_SYNC_STATUSES = new Set(['failed', 'timeout', 'superseded', 'not_requested', 'blocked']);
const BLOCK_MESSAGES = {
  create_not_allowed_remote: 'Mode create refusé hors émulateur sans --allow-create : rien n’est écrit.',
  audit_chain_invalid: 'La chaîne d’audit de la racine est invalide : rien n’est écrit.',
  owner_not_editor: 'Le propriétaire n’est pas éditeur légal actif du registre (membership) : la synchronisation serait refusée (permission_denied) ; rien n’est écrit.',
  registry_not_ready: 'Le registre de la racine est absent ou hors tenant : la synchronisation serait refusée ; rien n’est écrit.',
  request_in_flight: 'Une demande de synchronisation est en cours (pending/processing) : elle bloquerait la synchronisation du seed ; rien n’est écrit. Attendez son issue ou, si elle est bloquée depuis plus de 15 minutes, relancez avec --replace-stale-request.',
  generic_operation_stale: 'Une saisie générique du lecteur est en attente avec une baseRevision qui n’est plus celle de la racine : la synchronisation échouerait en revision_conflict ; rien n’est écrit. Le propriétaire doit recharger le Cartulaire et réenregistrer sa saisie (ou la retirer) avant le seed.',
  generic_operation_invalid: 'Le marqueur cartularia-generic-operation du brouillon est invalide : la synchronisation échouerait (invalid_generic_operation) ; rien n’est écrit.',
  sync_required: 'Aucune écriture n’est prévue mais une synchronisation est nécessaire : relancez avec --resync.',
};

const defaultSleep = (milliseconds) => new Promise((resolve) => { setTimeout(resolve, milliseconds); });
const fail = (code, message) => { throw new RolexDossierCommandError(code, message); };
const draftPathFor = (ownerUid) => `privateDrafts/${ownerUid}/cartularies/${ROLEX_CARTULARY_ID}`;
const rootPublicCode = (rootData) => rootData?.objectCode || rootData?.publicCode || null;
const truncateDigest = (digest) => digest.slice('sha256:'.length, 'sha256:'.length + DIGEST_LENGTH);
/**
 * Empreinte à clé : le nonce (aléatoire par exécution, jamais exposé) entre dans le haché, sinon une
 * valeur Secret à faible entropie (date + prix, statut énuméré, code public) se retrouverait par
 * force brute depuis les 12 hex du rapport.
 */
const keyedDigest = (nonce, value) => truncateDigest(sha256Digest({ nonce, value }));
const toMillis = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  // Timestamp désérialisé sans prototype ({ seconds, nanoseconds } ou { _seconds, _nanoseconds }).
  const seconds = typeof value.seconds === 'number' ? value.seconds : typeof value._seconds === 'number' ? value._seconds : null;
  if (seconds !== null) return seconds * 1_000 + Math.floor((value.nanoseconds ?? value._nanoseconds ?? 0) / 1_000_000);
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};
/** Ancienneté d'une demande en cours : processingStartedAt pour processing, requestedAt pour pending (updatedAt en repli). */
const syncRequestAgeMs = (data, nowMs) => {
  if (!data || !IN_FLIGHT_SYNC_STATUSES.has(data.status)) return null;
  const startedAt = toMillis(data.status === 'processing' ? data.processingStartedAt ?? data.updatedAt ?? data.requestedAt : data.requestedAt ?? data.updatedAt);
  return startedAt === null ? null : Math.max(0, nowMs - startedAt);
};
const isStaleSyncRequest = (data, nowMs) => {
  const age = syncRequestAgeMs(data, nowMs);
  return age !== null && age >= STALE_SYNC_REQUEST_MS;
};

/* ----------------------------------------------------------------------------------------------
 * Arguments (fonction pure)
 * -------------------------------------------------------------------------------------------- */

const usageError = (code, message) => ({ ok: false, code, message });

/**
 * `--key <clé>` sert deux drapeaux : avec `--force`, les clés à réécrire ; avec `--projection-keys`,
 * les seules clés de projection à créer (sans `--key`, toutes). Hors émulateur, le projet doit être
 * explicite (GCLOUD_PROJECT ou FIREBASE_PROJECT_ID), même en `--dry-run` : aucun repli sur un projet
 * distant par défaut ; sous émulateur, `cartularia-wave2-local` reste le défaut du seed local.
 */
export const parseRolexDossierArgs = (argv = [], env = {}) => {
  const usesEmulator = Boolean(env.FIRESTORE_EMULATOR_HOST);
  const explicitProject = [env.GCLOUD_PROJECT, env.FIREBASE_PROJECT_ID].find((value) => typeof value === 'string' && value.trim()) ?? null;
  const options = {
    help: false,
    dryRun: false,
    force: false,
    keys: [],
    forceKeys: [],
    projectionOnlyKeys: [],
    projectionScoped: false,
    allowRemote: false,
    projectionKeys: false,
    resync: false,
    allowCreate: false,
    replaceStaleRequest: false,
    ownerUidOverride: typeof env.CARTULARIA_OWNER_UID === 'string' && env.CARTULARIA_OWNER_UID.trim() ? env.CARTULARIA_OWNER_UID.trim() : null,
    projectId: explicitProject ? explicitProject.trim() : usesEmulator ? 'cartularia-wave2-local' : null,
    usesEmulator,
  };
  const unknown = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (BOOLEAN_FLAGS.has(argument)) {
      options[BOOLEAN_FLAGS.get(argument)] = true;
    } else if (argument === '--key' || argument.startsWith('--key=')) {
      const value = argument === '--key' ? argv[index + 1] : argument.slice('--key='.length);
      if (argument === '--key') index += 1;
      if (typeof value !== 'string' || !value || value.startsWith('--')) return usageError('invalid_argument', '--key attend le nom d’une clé d’état.');
      options.keys.push(value);
    } else {
      unknown.push(argument);
    }
  }
  if (options.help) return { ok: true, options };
  if (unknown.length) return usageError('invalid_argument', `Option inconnue : ${unknown.join(' ')}.`);
  options.keys = [...new Set(options.keys)];
  const unknownKeys = options.keys.filter((key) => !FIXTURE_STATE_KEYS.includes(key));
  if (unknownKeys.length) return usageError('unknown_state_key', `Clé hors de la fixture Rolex : ${unknownKeys.join(' ')}.`);
  if (options.force && options.keys.length === 0) return usageError('force_requires_key', '--force exige au moins un --key <clé> : la réécriture globale est interdite.');
  if (!options.force && options.keys.length > 0) {
    if (!options.projectionKeys) return usageError('key_requires_force', '--key n’a d’effet qu’avec --force (réécriture) ou --projection-keys (clés de projection à créer).');
    const nonProjection = options.keys.filter((key) => !PROJECTION_DRIVING_STATE_KEYS.includes(key));
    if (nonProjection.length) return usageError('key_requires_force', `Sans --force, --key ne peut nommer que des clés de projection : ${nonProjection.join(' ')}.`);
  }
  options.forceKeys = options.force ? [...options.keys] : [];
  options.projectionOnlyKeys = options.projectionKeys ? options.keys.filter((key) => PROJECTION_DRIVING_STATE_KEYS.includes(key)) : [];
  // Dès qu’un --key accompagne --projection-keys, la création de clés de projection est limitée aux clés
  // de projection nommées : aucune si --key ne nomme que des clés hors projection.
  options.projectionScoped = options.projectionKeys && options.keys.length > 0;
  return { ok: true, options };
};

/* ----------------------------------------------------------------------------------------------
 * Comparaison clé par clé (sans jamais exposer une valeur)
 * -------------------------------------------------------------------------------------------- */

const INVALID_JSON = Symbol('invalid_json');
const parseStoredValue = (existing) => {
  if (!existing || existing.deleted === true || typeof existing.value !== 'string') return null;
  try {
    return JSON.parse(existing.value);
  } catch {
    return INVALID_JSON;
  }
};
const kindOf = (value) => (Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value);
const sameJson = (left, right) => canonicalize(left) === canonicalize(right);

/** Champs de premier niveau qui diffèrent (noms seulement) ; pour un tableau, les deux longueurs. */
const describeDifference = (existingValue, fixtureValue) => {
  if (existingValue === INVALID_JSON) return { differingFields: ['<invalid-json>'] };
  const existingKind = kindOf(existingValue);
  const fixtureKind = kindOf(fixtureValue);
  if (existingKind !== fixtureKind) return { differingFields: ['<type>'], existingType: existingKind, fixtureType: fixtureKind };
  if (existingKind === 'array') {
    const differing = existingValue.length !== fixtureValue.length
      ? ['length']
      : existingValue.flatMap((item, index) => (sameJson(item, fixtureValue[index]) ? [] : [`[${index}]`]));
    return { differingFields: differing, existingLength: existingValue.length, fixtureLength: fixtureValue.length };
  }
  if (existingKind === 'object') {
    const keys = [...new Set([...Object.keys(existingValue), ...Object.keys(fixtureValue)])].sort();
    return {
      differingFields: keys.filter((key) => !(key in existingValue) || !(key in fixtureValue) || !sameJson(existingValue[key], fixtureValue[key])),
    };
  }
  return { differingFields: sameJson(existingValue, fixtureValue) ? [] : ['value'] };
};

const planStateEntry = ({ key, value, serialized, existing, rootData, mode, forceKeys, projectionKeys, projectionOnlyKeys, projectionScoped = false, digestNonce }) => {
  const drivesProjection = PROJECTION_DRIVING_STATE_KEYS.includes(key);
  // --projection-keys seul : toutes les clés de projection ; avec --key : seules les clés de projection nommées
  // (aucune si --key ne nomme que des clés hors projection).
  const projectionRestricted = projectionScoped || projectionOnlyKeys.length > 0;
  const projectionAllowed = projectionKeys && (!projectionRestricted || projectionOnlyKeys.includes(key));
  const existingValue = parseStoredValue(existing);
  const base = {
    key,
    drivesProjection,
    forced: forceKeys.includes(key),
    fixtureDigest: keyedDigest(digestNonce, value),
    fixtureBytes: Buffer.byteLength(serialized, 'utf8'),
    existingDigest: existingValue === null || existingValue === INVALID_JSON ? null : keyedDigest(digestNonce, existingValue),
    existingBytes: existing && typeof existing.value === 'string' ? Buffer.byteLength(existing.value, 'utf8') : null,
    differingFields: null,
    existing: existing
      ? { revision: Number(existing.revision || 0), clientUpdatedAt: Number(existing.clientUpdatedAt || 0), deleted: existing.deleted === true }
      : null,
    serialized,
  };
  if (existing && existing.deleted !== true && existingValue !== null) Object.assign(base, describeDifference(existingValue, value));
  if (key === PUBLIC_CODE_STATE_KEY && rootData) {
    const code = rootPublicCode(rootData);
    if (code && code !== ROLEX_PUBLIC_CODE) return { ...base, action: 'conflict_with_root', rootPublicCode: code };
  }
  const equal = Boolean(existing) && existing.deleted !== true && existingValue !== INVALID_JSON && existingValue !== null && sameJson(existingValue, value);
  if (equal) return { ...base, action: 'unchanged' };
  if (mode === 'existing' && drivesProjection && !projectionAllowed) return { ...base, action: 'kept_projection' };
  if (!existing) return { ...base, action: 'create' };
  return { ...base, action: forceKeys.includes(key) ? 'update' : 'kept' };
};

const summarize = (values) => {
  const summary = { create: 0, update: 0, unchanged: 0, kept: 0, kept_projection: 0, conflict_with_root: 0, raced: 0 };
  for (const value of values) summary[value] = (summary[value] || 0) + 1;
  return summary;
};

/* ----------------------------------------------------------------------------------------------
 * Empreinte du brouillon (même calcul que loadDraft, live-sync-command.mjs l.109-141)
 * -------------------------------------------------------------------------------------------- */

const computeDraftDigest = ({ stateDocs, binaryDocs }) => sha256Digest({
  state: stateDocs
    .filter((document) => !REGISTRY_FORBIDDEN_STATE_KEYS.has(document.id))
    .map((document) => ({ key: document.id, ...document.data() }))
    .map((record) => ({
      key: record.key,
      value: record.deleted === true ? null : record.value,
      deleted: record.deleted === true,
      revision: Number(record.revision || 0),
      clientUpdatedAt: Number(record.clientUpdatedAt || 0),
    }))
    .sort((left, right) => left.key.localeCompare(right.key)),
  binaries: binaryDocs
    .map((document) => ({ binaryId: document.id, ...document.data() }))
    .filter((record) => record.kind !== 'owner_document')
    .map((record) => ({
      binaryId: record.binaryId,
      deleted: record.deleted === true,
      revision: Number(record.revision || 0),
      sha256: record.sha256 || null,
      storagePath: record.storagePath || null,
      size: Number(record.size || 0),
    }))
    .sort((left, right) => left.binaryId.localeCompare(right.binaryId)),
});

/* ----------------------------------------------------------------------------------------------
 * Opération générique en attente (miroir de live-sync-command.mjs l.227-236 et l.275-281)
 * -------------------------------------------------------------------------------------------- */

/**
 * Le lecteur unique écrit `cartularia-generic-sections` (ou `-media`) et le marqueur
 * `cartularia-generic-operation` { kind, token } dans la même transaction, puis demande une
 * synchronisation (src/services/genericCartulary.ts). Tant que `root.lastGenericOperationToken`
 * n'égale pas le token, l'opération est en attente : la synchronisation l'appliquera (une édition
 * de value.retained.amount force grossValuation et met netValuation à null), ce que l'aperçu de
 * projection ne simule pas. Si `baseRevision` n'est plus la révision de la racine, la
 * synchronisation échouerait en revision_conflict (generic-sections-command.mjs l.8-11,
 * generic-media-command.mjs l.12). Rien ici n'expose une valeur : seulement le genre, les fieldId
 * édités, les compteurs et les révisions.
 */
const describeGenericOperation = ({ existingStates, rootData }) => {
  const marker = parseStoredValue(existingStates.get(GENERIC_OPERATION_STATE_KEY) ?? null);
  if (marker === null) return null;
  if (marker === INVALID_JSON) return { valid: false, kind: null, draftKey: null, baseRevision: null, rootRevision: rootData.revision ?? null, stale: true, fieldIds: [], changeCount: null };
  const kind = typeof marker === 'string' ? marker : typeof marker === 'object' ? marker.kind ?? null : null;
  const token = typeof marker === 'object' && marker ? marker.token ?? null : sha256Digest(marker);
  const valid = ['media', 'sections'].includes(kind) && (typeof marker !== 'object' || (Object.keys(marker).every((key) => ['kind', 'token'].includes(key)) && GENERIC_OPERATION_TOKEN_PATTERN.test(token || '')));
  if (valid && token === rootData.lastGenericOperationToken) return null;
  const draftKey = GENERIC_DRAFT_STATE_KEYS[kind] ?? null;
  const draft = draftKey ? parseStoredValue(existingStates.get(draftKey) ?? null) : null;
  const draftObject = draft && draft !== INVALID_JSON && typeof draft === 'object' && !Array.isArray(draft) ? draft : null;
  const baseRevision = Number.isInteger(draftObject?.baseRevision) ? draftObject.baseRevision : null;
  const rootRevision = rootData.revision ?? null;
  return {
    valid,
    kind,
    draftKey,
    baseRevision,
    rootRevision,
    stale: baseRevision === null || baseRevision !== rootRevision,
    fieldIds: kind === 'sections' && Array.isArray(draftObject?.edits) ? draftObject.edits.flatMap((edit) => (typeof edit?.fieldId === 'string' ? [edit.fieldId] : [])) : [],
    changeCount: kind === 'media' && draftObject ? (Array.isArray(draftObject.changes) ? draftObject.changes.length : 0) + (Array.isArray(draftObject.removeIds) ? draftObject.removeIds.length : 0) : null,
  };
};

/* ----------------------------------------------------------------------------------------------
 * Préconditions de la synchronisation (miroir de assertOwnerEditor, live-sync-command.mjs l.90-107)
 * -------------------------------------------------------------------------------------------- */

const describeOwnerEditor = ({ membership, registry, organizationId, registryId, ownerUid }) => {
  const data = membership?.exists ? membership.data() : null;
  const registryData = registry?.exists ? registry.data() : null;
  const checks = {
    membershipExists: Boolean(data),
    membershipActive: data?.status === 'active' && data?.uid === ownerUid,
    legalOwner: Array.isArray(data?.roles) && data.roles.includes('legal_owner'),
    cartularyEdit: Array.isArray(data?.permissions) && data.permissions.includes('cartulary.edit'),
    registryInScope: Boolean(registryId) && Array.isArray(data?.scopes?.registryIds) && data.scopes.registryIds.includes(registryId),
    registryExists: Boolean(registryData),
    registrySameTenant: Boolean(registryData) && registryData.organizationId === organizationId,
  };
  const membershipOk = checks.membershipExists && checks.membershipActive && checks.legalOwner && checks.cartularyEdit && checks.registryInScope;
  const registryOk = checks.registryExists && checks.registrySameTenant;
  return {
    organizationId: organizationId ?? null,
    registryId: registryId ?? null,
    membershipPath: organizationId ? `organizations/${organizationId}/memberships/${ownerUid}` : null,
    ...checks,
    ok: membershipOk && registryOk,
    blockReason: !registryOk ? 'registry_not_ready' : !membershipOk ? 'owner_not_editor' : null,
  };
};

/* ----------------------------------------------------------------------------------------------
 * Aperçu de la projection (miroir de live-sync-command.mjs l.258-286, hors sections génériques)
 * -------------------------------------------------------------------------------------------- */

const asText = (value, fallback) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
};
const asYear = (value, fallback) => {
  const match = String(value ?? '').match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : fallback;
};
const asNonNegativeNumber = (value, fallback = null) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback);
const specificationValue = (groups, id, label) => {
  if (!Array.isArray(groups)) return null;
  for (const group of groups) {
    if (!Array.isArray(group?.items)) continue;
    const item = group.items.find((candidate) => candidate?.id === id || candidate?.label === label);
    if (typeof item?.value === 'string' && item.value.trim()) return item.value.trim();
  }
  return null;
};

export const previewProjection = ({ rootData, itemData = null, states }) => {
  const state = (key) => (states.has(key) ? states.get(key) : null);
  const moneyBaseline = { ...(itemData ?? {}), ...rootData };
  const patrimonialStatus = asText(state('cartularia-watch-status'), rootData.patrimonialStatus || 'Patrimonial');
  const purchaseState = state('cartularia-purchase');
  const purchase = purchaseState || {};
  const purchaseExpenses = state('cartularia-purchase-expenses');
  const retainedValuationState = state('cartularia-retained-valuation');
  const retainedValuation = retainedValuationState || {};
  const creationProfile = state('cartularia-creation-profile') || {};
  const purchasePrice = asNonNegativeNumber(purchase.purchasePrice, moneyBaseline.purchasePrice ?? creationProfile.purchasePrice ?? null);
  const costBasis = !purchaseState && !Array.isArray(purchaseExpenses)
    ? (moneyBaseline.costBasis ?? purchasePrice)
    : purchasePrice === null ? null : purchasePrice + (Array.isArray(purchaseExpenses) ? purchaseExpenses.reduce((sum, expense) => sum + (asNonNegativeNumber(expense?.amount, 0) || 0), 0) : 0);
  const grossValuation = asNonNegativeNumber(retainedValuation.amount, moneyBaseline.grossValuation ?? creationProfile.valuationMid ?? null);
  const saleCostAmount = asNonNegativeNumber(retainedValuation.saleCostAmount, 0) || 0;
  const netValuation = !retainedValuationState ? (moneyBaseline.netValuation ?? null) : grossValuation === null ? null : Math.max(0, grossValuation - saleCostAmount);
  const valuationCurrency = asText(creationProfile.currency, rootData.valuationCurrency || rootData.currency || 'EUR');
  const specifications = rootData.assetType === 'watch' ? state('cartularia-specification-groups') : null;
  return {
    purchasePrice,
    costBasis,
    grossValuation,
    netValuation,
    valuationCurrency,
    makerName: asText(specificationValue(specifications, 'brand', 'Marque'), rootData.makerName ?? null),
    modelName: asText(specificationValue(specifications, 'model', 'Modèle'), rootData.modelName ?? null),
    referenceCode: asText(specificationValue(specifications, 'reference', 'Numéro de référence'), rootData.referenceCode ?? null),
    manufactureYear: asYear(specificationValue(specifications, 'year', 'Année de fabrication'), rootData.manufactureYear ?? null),
    patrimonialStatus,
  };
};

const pickProjectionFields = (data) => Object.fromEntries(PROJECTION_FIELDS.map((field) => [field, data?.[field] ?? null]));
const differingProjectionFields = (left, right) => PROJECTION_FIELDS.filter((field) => !sameJson(left?.[field] ?? null, right?.[field] ?? null));

const buildProjectionBlock = ({ rootData, itemData, existingStates, entries }) => {
  const baseStates = new Map();
  for (const [key, record] of existingStates) {
    const parsed = parseStoredValue(record);
    if (parsed !== null && parsed !== INVALID_JSON) baseStates.set(key, parsed);
  }
  const fixture = buildRolexDossierState();
  const afterPlanStates = new Map(baseStates);
  for (const entry of entries) if (WRITE_ACTIONS.has(entry.action)) afterPlanStates.set(entry.key, fixture.get(entry.key));
  const fixtureStates = new Map(baseStates);
  for (const [key, value] of fixture) fixtureStates.set(key, value);
  const current = pickProjectionFields(rootData);
  const afterPlan = previewProjection({ rootData, itemData, states: afterPlanStates });
  const ifFixture = previewProjection({ rootData, itemData, states: fixtureStates });
  return {
    classification: 'Secret',
    fields: [...PROJECTION_FIELDS],
    current,
    registryItem: itemData ? pickProjectionFields(itemData) : null,
    afterPlan,
    ifFixture,
    changesAfterPlan: differingProjectionFields(current, afterPlan),
    changesIfFixture: differingProjectionFields(current, ifFixture),
    applied: null,
    note: 'Aperçu calculé comme live-sync-command.mjs (montants, titre, année, statut) à partir du brouillon après le plan (y compris les clés déjà poussées par le propriétaire et non synchronisées) ; les sections génériques et une opération générique en attente (cartularia-generic-operation, voir genericOperationPending) ne sont pas simulées. Ce bloc porte les montants de la racine : donnée Secret.',
  };
};

/* ----------------------------------------------------------------------------------------------
 * Plan (lecture seule)
 * -------------------------------------------------------------------------------------------- */

const resolveOwner = ({ mode, rootData, ownerUidOverride }) => {
  const override = typeof ownerUidOverride === 'string' && ownerUidOverride.trim() ? ownerUidOverride.trim() : null;
  if (mode === 'create') {
    if (override && override !== ROLEX_IMPORT_ACTOR_ID) {
      fail('owner_mismatch', `La racine n’existe pas : l’import créerait le Cartulaire au nom de ${ROLEX_IMPORT_ACTOR_ID} (fixture), pas de ${override}.`);
    }
    return { uid: ROLEX_IMPORT_ACTOR_ID, source: override ? 'env' : 'fixture' };
  }
  const holder = typeof rootData.accountHolderId === 'string' && rootData.accountHolderId ? rootData.accountHolderId : null;
  if (!holder) fail('owner_unknown', 'La racine existe mais ne désigne aucun accountHolderId ; aucun repli sur l’acteur de la fixture.');
  if (override && override !== holder) {
    fail('owner_mismatch', `CARTULARIA_OWNER_UID (${override}) ne correspond pas au propriétaire de la racine (${holder}) : la synchronisation serait refusée.`);
  }
  return { uid: holder, source: override ? 'env' : 'root' };
};

export const planRolexDossier = async ({
  firestore,
  ownerUidOverride = null,
  forceKeys = [],
  projectionKeys = false,
  projectionOnlyKeys = [],
  projectionScoped = false,
  resync = false,
  createAllowed = true,
  replaceStaleRequest = false,
  now = () => Date.now(),
  digestNonce = randomUUID(),
}) => {
  const cartularyId = ROLEX_CARTULARY_ID;
  const rootRef = firestore.doc(`cartularies/${cartularyId}`);
  const root = await rootRef.get();
  const rootData = root.exists ? root.data() : null;
  if (rootData?.deletedAt) fail('cartulary_deleted', `Le Cartulaire ${cartularyId} est supprimé.`);
  const mode = root.exists ? 'existing' : 'create';
  const owner = resolveOwner({ mode, rootData, ownerUidOverride });
  const draftRef = firestore.doc(draftPathFor(owner.uid));
  const envelope = buildRolexImportBundle().envelope;
  const organizationId = mode === 'existing' ? rootData.organizationId ?? null : envelope.organizationId;
  const registryId = mode === 'existing' ? rootData.registryId ?? null : envelope.registryId;
  const [draft, stateSnapshot, binarySnapshot, syncRequest, auditSnapshot, registryItem, membership, registry] = await Promise.all([
    draftRef.get(),
    draftRef.collection('state').get(),
    draftRef.collection('binaries').get(),
    firestore.doc(`cartularySyncRequests/${cartularyId}`).get(),
    root.exists ? rootRef.collection('auditEvents').get() : Promise.resolve(null),
    root.exists && registryId ? firestore.doc(`registries/${registryId}/items/${cartularyId}`).get() : Promise.resolve(null),
    organizationId ? firestore.doc(`organizations/${organizationId}/memberships/${owner.uid}`).get() : Promise.resolve(null),
    registryId ? firestore.doc(`registries/${registryId}`).get() : Promise.resolve(null),
  ]);

  const draftData = draft.exists ? draft.data() : null;
  if (draftData?.status === 'deleted') fail('draft_deleted', `Le brouillon ${draftRef.path} a été supprimé par son propriétaire ; il n’est pas réactivé.`);
  if (draftData && draftData.status !== 'active') fail('draft_not_ready', `Le brouillon ${draftRef.path} est dans l’état « ${draftData.status} » ; seul un brouillon actif est complété.`);
  if (draftData && typeof draftData.ownerUid === 'string' && draftData.ownerUid !== owner.uid) {
    fail('draft_owner_mismatch', `Le brouillon ${draftRef.path} appartient à ${draftData.ownerUid}, pas à ${owner.uid}.`);
  }

  const existingStates = new Map(stateSnapshot.docs.map((document) => [document.id, document.data()]));
  const entries = [...buildRolexDossierState()].map(([key, value]) => planStateEntry({
    key, value, serialized: JSON.stringify(value), existing: existingStates.get(key) ?? null, rootData, mode, forceKeys, projectionKeys, projectionOnlyKeys, projectionScoped, digestNonce,
  }));
  const genericOperationPending = mode === 'existing' ? describeGenericOperation({ existingStates, rootData }) : null;
  const summary = summarize(entries.map((entry) => entry.action));
  const keysWith = (action) => entries.filter((entry) => entry.action === action).map((entry) => entry.key);

  const audit = root.exists
    ? (() => {
      const chain = verifyAuditChain({
        events: auditSnapshot.docs.map((document) => document.data()),
        integrityHead: rootData.integrityHead,
        integritySequence: rootData.integritySequence,
      });
      return { valid: chain.valid, eventCount: chain.eventCount, errors: chain.errors };
    })()
    : null;
  const editor = describeOwnerEditor({ membership, registry, organizationId, registryId, ownerUid: owner.uid });
  const projection = mode === 'existing'
    ? buildProjectionBlock({ rootData, itemData: registryItem?.exists ? registryItem.data() : null, existingStates, entries })
    : null;

  const draftDigest = computeDraftDigest({ stateDocs: stateSnapshot.docs, binaryDocs: binarySnapshot.docs });
  const rootLiveStateDigest = typeof rootData?.liveStateDigest === 'string' ? rootData.liveStateDigest : null;
  const draftOutOfSync = Boolean(rootLiveStateDigest) && draftDigest !== rootLiveStateDigest;
  const syncRequestData = syncRequest.exists ? syncRequest.data() : null;
  const nowMs = now();
  const syncRequestPlan = {
    exists: syncRequest.exists,
    status: syncRequestData?.status ?? null,
    requestId: syncRequestData?.requestId ?? null,
    reason: syncRequestData?.reason ?? null,
    inFlight: IN_FLIGHT_SYNC_STATUSES.has(syncRequestData?.status),
    ageMs: syncRequestAgeMs(syncRequestData, nowMs),
    stale: isStaleSyncRequest(syncRequestData, nowMs),
    failed: syncRequestData?.status === 'failed',
    errorCode: syncRequestData?.status === 'failed' ? syncRequestData.errorCode ?? null : null,
    errorMessage: syncRequestData?.status === 'failed' ? syncRequestData.errorMessage ?? null : null,
  };
  const syncRequired = syncRequestPlan.failed || draftOutOfSync;
  const writes = summary.create + summary.update;
  const wantsSync = writes > 0 || resync || syncRequired;
  const createBlocked = mode === 'create' && !createAllowed;
  // Une opération générique dont la baseRevision n'est plus celle de la racine ferait échouer la synchronisation (revision_conflict) : bloqué avant toute écriture.
  const genericBlockReason = genericOperationPending && wantsSync
    ? (!genericOperationPending.valid ? 'generic_operation_invalid' : genericOperationPending.stale ? 'generic_operation_stale' : null)
    : null;
  const firstAuthoritativeSync = mode === 'existing' && !rootLiveStateDigest && wantsSync;
  const sync = createBlocked ? { expected: 'blocked', reason: 'create_not_allowed_remote' }
    : audit && !audit.valid ? { expected: 'blocked', reason: 'audit_chain_invalid' }
      : !editor.ok ? { expected: 'blocked', reason: editor.blockReason }
        : genericBlockReason ? { expected: 'blocked', reason: genericBlockReason }
          : wantsSync && syncRequestPlan.inFlight
            ? (replaceStaleRequest && syncRequestPlan.stale ? { expected: 'planned', reason: 'replace_stale_request' } : { expected: 'blocked', reason: 'request_in_flight' })
            : writes > 0 ? { expected: 'planned', reason: null }
              : resync ? { expected: 'planned', reason: 'resync' }
                : syncRequired ? { expected: 'required', reason: 'sync_required' }
                  : syncRequestPlan.inFlight ? { expected: 'skipped', reason: 'request_in_flight' }
                    : { expected: 'skipped', reason: 'no_state_change' };

  const warnings = [];
  if (createBlocked) {
    warnings.push({ code: 'create_not_allowed_remote', message: 'La racine n’existe pas dans ce projet : le mode create (import + projection au nom de la fixture) est refusé hors émulateur sans --allow-create ; rien ne sera écrit.' });
  }
  if (audit && !audit.valid) {
    warnings.push({ code: 'audit_chain_invalid', errors: audit.errors, message: 'La chaîne d’audit de la racine est invalide : la synchronisation serait refusée ; l’application n’écrira rien.' });
  }
  if (!editor.ok) {
    warnings.push({ code: editor.blockReason, editor, message: BLOCK_MESSAGES[editor.blockReason] });
  }
  if (genericOperationPending) {
    const blocking = sync.expected === 'blocked' && sync.reason === genericBlockReason;
    const { valid, stale, kind, fieldIds, changeCount, baseRevision, rootRevision } = genericOperationPending;
    const described = kind === 'sections' ? `sections génériques (${fieldIds.length ? fieldIds.join(', ') : 'aucun fieldId lisible'})` : kind === 'media' ? `médias génériques (${changeCount ?? 0} changement(s))` : 'genre inconnu';
    warnings.push({
      code: 'generic_operation_pending',
      kind,
      fieldIds,
      changeCount,
      baseRevision,
      rootRevision,
      stale,
      valid,
      blocking,
      message: !valid
        ? BLOCK_MESSAGES.generic_operation_invalid
        : stale
          ? `Opération générique du lecteur en attente (${described}) avec baseRevision ${baseRevision ?? 'absente'} ≠ révision ${rootRevision} de la racine. ${BLOCK_MESSAGES.generic_operation_stale}`
          : `Opération générique du lecteur en attente (${described}, baseRevision ${baseRevision}) : l’aperçu de projection ne simule pas cette édition. La synchronisation demandée par le seed l’appliquera aussi (une édition de value.retained.amount force grossValuation et met netValuation à null) : projection.applied peut différer de projection.afterPlan.`,
    });
  }
  if (syncRequestPlan.inFlight) {
    const blocking = sync.expected === 'blocked' && sync.reason === 'request_in_flight';
    warnings.push({
      code: 'sync_request_in_flight',
      requestId: syncRequestPlan.requestId,
      status: syncRequestPlan.status,
      ageMs: syncRequestPlan.ageMs,
      stale: syncRequestPlan.stale,
      blocking,
      replace: sync.reason === 'replace_stale_request',
      message: sync.reason === 'replace_stale_request'
        ? `La demande en cours a plus de ${STALE_SYNC_REQUEST_MS / 60_000} minutes : --replace-stale-request la remplacera par une nouvelle demande du seed.`
        : blocking
          ? `${BLOCK_MESSAGES.request_in_flight}${replaceStaleRequest ? ` (--replace-stale-request sans effet : ancienneté ${syncRequestPlan.ageMs === null ? 'inconnue' : `${Math.round(syncRequestPlan.ageMs / 1_000)} s`} < ${STALE_SYNC_REQUEST_MS / 60_000} min).` : ''}`
          : 'Une demande de synchronisation est en cours ; rien n’est à synchroniser : elle n’est pas écrasée et aucune nouvelle demande ne sera émise.',
    });
  }
  if (syncRequestPlan.failed) {
    warnings.push({ code: 'sync_request_failed', requestId: syncRequestPlan.requestId, errorCode: syncRequestPlan.errorCode, errorMessage: syncRequestPlan.errorMessage, message: 'La dernière demande de synchronisation a échoué : la racine et l’item Registre ne reflètent peut-être pas le brouillon.' });
  }
  if (draftOutOfSync) {
    warnings.push({
      code: 'draft_out_of_sync',
      draftDigest: truncateDigest(draftDigest),
      rootLiveStateDigest: truncateDigest(rootLiveStateDigest),
      changesAfterPlan: projection?.changesAfterPlan ?? [],
      message: `L’empreinte du brouillon diffère de root.liveStateDigest : le brouillon est en avance sur la racine (modifications du propriétaire non synchronisées). La synchronisation demandée par le seed les appliquera aussi${projection?.changesAfterPlan?.length ? ` ; champs de projection qui changeront : ${projection.changesAfterPlan.join(', ')}` : ''}. Voir projection.afterPlan.`,
    });
  }
  if (sync.expected === 'required') {
    warnings.push({ code: 'sync_required', message: `${BLOCK_MESSAGES.sync_required} Sans --resync : ok:false.` });
  }
  if (firstAuthoritativeSync) {
    warnings.push({
      code: 'first_authoritative_sync',
      message: 'La racine n’a pas de liveStateDigest : la synchronisation du seed sera la première synchronisation autoritaire de TOUT le brouillon du propriétaire (médias legacy cartularia-media-assets-v3, todos, sections génériques, alias, codes de rangement), pas seulement des clés créées. Contrôlez projection.afterPlan et draft.digest avant d’exécuter.',
    });
  }
  if (summary.kept) {
    warnings.push({ code: 'keys_kept_without_force', keys: keysWith('kept'), message: 'Ces clés existent avec une valeur différente de la fixture (ou sont supprimées) ; elles ne sont réécrites qu’avec --force --key <clé>, après contrôle des champs différents.' });
  }
  if (summary.kept_projection) {
    warnings.push({ code: 'projection_keys_kept', keys: keysWith('kept_projection'), message: 'Ces clés pilotent la projection Registre (montants, titre, année, statut) ; elles ne sont ni créées ni réécrites sans --projection-keys. Voir le bloc projection.' });
  }
  if (projectionKeys && projectionScoped && projectionOnlyKeys.length === 0) {
    warnings.push({ code: 'projection_keys_without_effect', keys: [], message: '--projection-keys sans clé de projection dans --key : aucune clé de projection n’est créée ni réécrite (les clés nommées ne pilotent pas la projection).' });
  }
  if (summary.conflict_with_root) {
    warnings.push({ code: 'public_code_conflict_with_root', rootPublicCode: rootPublicCode(rootData), fixturePublicCode: ROLEX_PUBLIC_CODE, message: 'Le code public de la racine diffère de la fixture : cartularia-public-code n’est jamais écrite dans ce cas, même avec --force --key. Attendu en production (code généré à la création depuis le Registre) : ce n’est pas une anomalie.' });
  }
  const forcedUpdates = entries.filter((entry) => entry.action === 'update');
  if (forcedUpdates.length) {
    warnings.push({
      code: 'keys_forced',
      keys: forcedUpdates.map((entry) => ({ key: entry.key, differingFields: entry.differingFields, existingDeleted: entry.existing?.deleted ?? null })),
      message: forcedUpdates.some((entry) => entry.key === EDITABLE_COPY_STATE_KEY)
        ? 'Ces clés seront remplacées par la fixture (révision +1). cartularia-editable-copy en fait partie : les textes du propriétaire (heroSummary, originParagraphs, watchDescription, conditionSummary…) seront perdus.'
        : 'Ces clés seront remplacées par la fixture (révision +1) ; la valeur actuelle du propriétaire est perdue.',
    });
  }
  const ineffectiveForceKeys = forceKeys.filter((key) => entries.find((entry) => entry.key === key)?.action !== 'update');
  if (ineffectiveForceKeys.length) {
    warnings.push({ code: 'force_key_without_effect', keys: ineffectiveForceKeys.map((key) => ({ key, action: entries.find((entry) => entry.key === key)?.action ?? null })), message: '--key sans effet sur ces clés (absente, égale, conflit avec la racine, ou clé de projection sans --projection-keys).' });
  }
  const projectionWrites = entries.filter((entry) => WRITE_ACTIONS.has(entry.action) && entry.drivesProjection).map((entry) => entry.key);
  if (mode === 'existing' && projectionWrites.length) {
    warnings.push({ code: 'projection_will_change', keys: projectionWrites, message: 'À la synchronisation, la racine et l’item Registre seront recalculés depuis ces clés : comparez projection.current et projection.afterPlan.' });
  }

  return {
    cartularyId,
    mode,
    flags: { forceKeys: [...forceKeys], force: forceKeys.length > 0, projectionKeys, projectionOnlyKeys: [...projectionOnlyKeys], projectionScoped, resync, createAllowed, replaceStaleRequest },
    owner,
    root: {
      exists: root.exists,
      revision: rootData?.revision ?? null,
      accountHolderId: rootData?.accountHolderId ?? null,
      organizationId,
      registryId,
      publicCode: rootData?.publicCode ?? null,
      objectCode: rootData?.objectCode ?? null,
      schemaVersion: rootData ? `${rootData.schemaId}@${rootData.schemaVersion}` : null,
      integritySequence: rootData?.integritySequence ?? null,
      integrityHead: rootData?.integrityHead ?? null,
      liveStateDigest: rootLiveStateDigest,
    },
    audit,
    editor,
    draft: { path: draftRef.path, exists: draft.exists, status: draftData?.status ?? null, action: draft.exists ? 'unchanged' : 'create', digest: draftDigest, outOfSync: draftOutOfSync },
    state: { summary, entries },
    projection,
    genericOperationPending,
    firstAuthoritativeSync,
    syncRequest: syncRequestPlan,
    syncRequired,
    sync,
    warnings,
  };
};

/* ----------------------------------------------------------------------------------------------
 * Application
 * -------------------------------------------------------------------------------------------- */

const waitForSyncOutcome = async ({ firestore, cartularyId, requestId, ignoredReason, now, sleep, pollTimeoutMs, pollIntervalMs, markSyncRequestFailed }) => {
  const requestRef = firestore.doc(`cartularySyncRequests/${cartularyId}`);
  const deadline = now() + pollTimeoutMs;
  for (;;) {
    const snapshot = await requestRef.get();
    const data = snapshot.exists ? snapshot.data() : null;
    if (!data || data.requestId !== requestId) return { status: 'superseded', reason: ignoredReason, requestId, processedBy: 'remote' };
    if (data.status === 'processed') {
      return { status: 'processed', outcome: data.outcome ?? null, revision: data.sourceRevision ?? null, auditEventId: data.auditEventId ?? null, requestId, processedBy: 'remote', reason: ignoredReason };
    }
    if (data.status === 'failed') {
      return { status: 'failed', code: data.errorCode ?? null, message: data.errorMessage ?? null, requestId, processedBy: 'remote', reason: ignoredReason };
    }
    if (now() >= deadline) {
      // Délai dépassé : la demande n'est pas laissée pending/processing (elle bloquerait toute relance
      // en request_in_flight pendant 15 minutes) ; elle est marquée failed, ce que la relance signale
      // (sync_request_failed → sync_required → --resync). Sans double traitement : la transaction
      // finale de processCartularySyncRequest relit status === 'processing' et rend superseded.
      await markSyncRequestFailed({ firestore, requestDocumentId: cartularyId, requestId, error: { code: 'sync_timeout', message: `Verdict de la synchronisation non reçu après ${Math.round(pollTimeoutMs / 1_000)} s (demande ${data.status}).` } });
      const after = await requestRef.get();
      const afterData = after.exists ? after.data() : null;
      const markedFailed = Boolean(afterData && afterData.requestId === requestId && afterData.status === 'failed');
      return { status: 'timeout', requestStatus: data.status, markedFailed, requestId, processedBy: 'remote', reason: ignoredReason };
    }
    await sleep(pollIntervalMs);
  }
};

const queueAndProcessSync = async ({ firestore, plan, occurredAt, now, requestId, sleep, pollTimeoutMs, pollIntervalMs, processSyncRequest, markSyncRequestFailed }) => {
  const { cartularyId } = plan;
  const requestRef = firestore.doc(`cartularySyncRequests/${cartularyId}`);
  const syncRequestId = requestId || `sync_seed_rolex_${now().toString(36)}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const queued = await firestore.runTransaction(async (transaction) => {
    const current = await transaction.get(requestRef);
    const data = current.exists ? current.data() : null;
    let replacedRequestId = null;
    if (data && IN_FLIGHT_SYNC_STATUSES.has(data.status)) {
      // Ancienneté relue dans la transaction : seule une demande bloquée depuis STALE_SYNC_REQUEST_MS est remplacée, et seulement sur drapeau explicite.
      if (!(plan.flags.replaceStaleRequest === true && isStaleSyncRequest(data, now()))) {
        return { queued: false, requestId: data.requestId ?? null, requestStatus: data.status, ageMs: syncRequestAgeMs(data, now()) };
      }
      replacedRequestId = data.requestId ?? null;
    }
    transaction.set(requestRef, {
      requestDocumentId: cartularyId,
      requestId: syncRequestId,
      ownerUid: plan.owner.uid,
      cartularyId,
      reason: ROLEX_SYNC_REQUEST_REASON,
      status: 'pending',
      requestedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { queued: true, requestId: syncRequestId, replacedRequestId };
  });
  if (!queued.queued) return { status: 'blocked', reason: 'request_in_flight', requestId: queued.requestId, requestStatus: queued.requestStatus, ageMs: queued.ageMs };
  const replaced = queued.replacedRequestId ? { replacedRequestId: queued.replacedRequestId } : {};
  try {
    const result = await processSyncRequest({ firestore, requestDocumentId: cartularyId, occurredAt });
    if (result.status !== 'ignored') {
      return { status: result.status, outcome: result.outcome ?? null, revision: result.revision ?? null, auditEventId: result.auditEventId ?? null, requestId: syncRequestId, processedBy: 'script', ...replaced };
    }
    // La Cloud Function déployée a réclamé la demande avant nous : on attend son verdict.
    return { ...await waitForSyncOutcome({ firestore, cartularyId, requestId: syncRequestId, ignoredReason: result.reason, now, sleep, pollTimeoutMs, pollIntervalMs, markSyncRequestFailed }), ...replaced };
  } catch (error) {
    await markSyncRequestFailed({ firestore, requestDocumentId: cartularyId, requestId: syncRequestId, error });
    return { status: 'failed', code: error?.code || 'sync_failed', message: String(error?.message || error).slice(0, 500), requestId: syncRequestId, processedBy: 'script', ...replaced };
  }
};

export const applyRolexDossier = async ({
  firestore,
  plan,
  occurredAt = new Date().toISOString(),
  now = () => Date.now(),
  requestId = null,
  sleep = defaultSleep,
  pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  processSyncRequest = processCartularySyncRequest,
  markSyncRequestFailed = markCartularySyncRequestFailed,
}) => {
  const { cartularyId } = plan;
  const rootRef = firestore.doc(`cartularies/${cartularyId}`);
  const root = await rootRef.get();
  if (root.exists !== plan.root.exists || (root.exists && root.data().revision !== plan.root.revision)) {
    fail('plan_stale', 'Le Cartulaire a changé depuis le calcul du plan ; relancez la simulation.');
  }
  if (plan.sync.expected === 'blocked') fail(plan.sync.reason, BLOCK_MESSAGES[plan.sync.reason] ?? `Plan bloqué (${plan.sync.reason}) : rien n’est écrit.`);
  const draftRef = firestore.doc(plan.draft.path);
  const draftBefore = await draftRef.get();
  if (draftBefore.exists && draftBefore.data().status !== 'active') fail('draft_not_ready', `Le brouillon ${draftRef.path} n’est plus actif (« ${draftBefore.data().status} ») : rien n’est écrit.`);
  if (draftBefore.exists !== plan.draft.exists) fail('plan_stale', 'Le brouillon a changé depuis le calcul du plan ; relancez la simulation.');

  let imported = null;
  let projected = null;
  if (plan.mode === 'create') {
    const importResult = await importCartularyBundle({
      firestore,
      bundle: buildRolexImportBundle(),
      requestId: ROLEX_IMPORT_REQUEST_ID,
      actorId: ROLEX_IMPORT_ACTOR_ID,
      expectedRevision: 0,
      occurredAt: ROLEX_IMPORT_DATE,
    });
    const projectionResult = importResult.replayed
      ? { revision: importResult.revision, replayed: true, auditEventId: null }
      : await projectRegistryItem({
        firestore,
        cartularyId,
        actorId: ROLEX_IMPORT_ACTOR_ID,
        requestId: `project_${ROLEX_IMPORT_REQUEST_ID}`,
        expectedRevision: importResult.revision,
        occurredAt: ROLEX_IMPORT_DATE,
      });
    imported = { revision: importResult.revision, replayed: importResult.replayed === true, auditEventId: importResult.auditEventId ?? null };
    projected = { revision: projectionResult.revision, replayed: projectionResult.replayed === true, auditEventId: projectionResult.auditEventId ?? null };
  }

  const draftAction = await firestore.runTransaction(async (transaction) => {
    const current = await transaction.get(draftRef);
    if (current.exists) {
      if (current.data().status !== 'active') fail('draft_not_ready', `Le brouillon ${draftRef.path} n’est plus actif.`);
      return 'unchanged';
    }
    transaction.create(draftRef, {
      ownerUid: plan.owner.uid,
      cartularyId,
      status: 'active',
      retentionPolicyVersion: DRAFT_RETENTION_POLICY_VERSION,
      purgeAfter: null,
      lastActiveAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return 'create';
  });

  const results = [];
  for (const entry of plan.state.entries) {
    if (!WRITE_ACTIONS.has(entry.action)) {
      results.push({ key: entry.key, result: entry.action, revision: entry.existing?.revision ?? null });
      continue;
    }
    const reference = draftRef.collection('state').doc(entry.key);
    // Une transaction par clé, comme le lecteur : la révision est relue ; si elle a bougé, la clé est sautée.
    results.push(await firestore.runTransaction(async (transaction) => {
      const [current, currentDraft] = await Promise.all([transaction.get(reference), transaction.get(draftRef)]);
      if (!currentDraft.exists || currentDraft.data().status !== 'active') fail('draft_not_ready', `Le brouillon ${draftRef.path} n’est plus actif : écriture de ${entry.key} refusée.`);
      const currentRevision = current.exists ? Number(current.data().revision || 0) : null;
      const currentDeleted = current.exists ? current.data().deleted === true : null;
      if (current.exists !== Boolean(entry.existing) || currentRevision !== (entry.existing?.revision ?? null) || currentDeleted !== (entry.existing?.deleted ?? null)) {
        return { key: entry.key, result: 'raced', revision: currentRevision };
      }
      const revision = (currentRevision ?? 0) + 1;
      const clientUpdatedAt = now();
      if (!Number.isFinite(clientUpdatedAt) || clientUpdatedAt <= 0) fail('invalid_clock', 'clientUpdatedAt doit être un nombre strictement positif.');
      transaction.set(reference, {
        ownerUid: plan.owner.uid,
        cartularyId,
        key: entry.key,
        value: entry.serialized,
        deleted: false,
        revision,
        clientUpdatedAt,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { key: entry.key, result: entry.action, revision };
    }));
  }

  const written = results.filter((result) => WRITE_ACTIONS.has(result.result));
  const raced = results.filter((result) => result.result === 'raced');
  const shouldSync = written.length > 0 || plan.flags.resync === true;
  const sync = shouldSync
    ? await queueAndProcessSync({ firestore, plan, occurredAt, now, requestId, sleep, pollTimeoutMs, pollIntervalMs, processSyncRequest, markSyncRequestFailed })
    : plan.syncRequired ? { status: 'not_requested', reason: 'sync_required' } : { status: 'skipped', reason: 'no_state_change' };

  // Bloc projection après exécution (D1, « dry-run et exécution ») : champs réellement portés par la racine et l'item Registre.
  let projection = null;
  if (plan.mode === 'existing') {
    const [rootAfter, itemAfter] = await Promise.all([
      rootRef.get(),
      plan.root.registryId ? firestore.doc(`registries/${plan.root.registryId}/items/${cartularyId}`).get() : Promise.resolve(null),
    ]);
    const rootFields = rootAfter.exists ? pickProjectionFields(rootAfter.data()) : null;
    projection = {
      root: rootFields,
      registryItem: itemAfter?.exists ? pickProjectionFields(itemAfter.data()) : null,
      revision: rootAfter.exists ? rootAfter.data().revision ?? null : null,
      changesFromCurrent: rootFields ? differingProjectionFields(plan.projection?.current, rootFields) : null,
      matchesAfterPlan: rootFields ? differingProjectionFields(plan.projection?.afterPlan, rootFields).length === 0 : null,
    };
  }

  const warnings = [];
  if (raced.length) {
    warnings.push({ code: 'keys_raced', keys: raced.map((result) => result.key), message: 'Ces clés ont été modifiées par le lecteur entre le plan et l’application : non écrites (raced). Le plan n’est pas entièrement appliqué : relancez --dry-run puis décidez clé par clé (ok:false).' });
  }
  if (sync.status === 'blocked') {
    warnings.push({ code: 'sync_request_in_flight', blocking: true, requestId: sync.requestId, status: sync.requestStatus, ageMs: sync.ageMs, message: `Une demande de synchronisation est apparue entre le plan et l’application : la synchronisation du seed n’a pas été demandée alors que ${written.length ? `${written.length} clé(s) ont été écrites` : 'elle était requise'} (ok:false). Attendez son issue puis relancez --dry-run (sync_required attendu, puis --resync), ou --replace-stale-request si elle est bloquée depuis plus de ${STALE_SYNC_REQUEST_MS / 60_000} minutes.` });
  }
  if (sync.status === 'timeout') {
    warnings.push({ code: 'sync_timeout', requestId: sync.requestId, requestStatus: sync.requestStatus, markedFailed: sync.markedFailed, message: sync.markedFailed
      ? `Verdict de la Cloud Function non reçu dans le délai (${Math.round(pollTimeoutMs / 1_000)} s) : la demande du seed a été marquée failed (sync_timeout) ; les clés écrites restent. Relancez --dry-run (sync_required attendu) puis --resync.`
      : 'Verdict de la Cloud Function non reçu dans le délai et la demande n’a pas pu être marquée failed (déjà traitée ou remplacée entre-temps) : relancez --dry-run pour connaître son état.' });
  }
  if (plan.genericOperationPending && projection && projection.matchesAfterPlan === false) {
    warnings.push({ code: 'projection_differs_from_preview', changesFromCurrent: projection.changesFromCurrent, message: 'La racine ne correspond pas à projection.afterPlan : attendu, une opération générique du lecteur était en attente et la synchronisation l’a appliquée (voir generic_operation_pending).' });
  }

  return {
    mode: plan.mode,
    imported,
    projected,
    draft: draftAction,
    state: { summary: summarize(results.map((result) => result.result)), results },
    sync,
    projection,
    warnings,
  };
};

/* ----------------------------------------------------------------------------------------------
 * Rapport et CLI
 * -------------------------------------------------------------------------------------------- */

/** Rapport JSON unique (sans les valeurs sérialisées de la fixture ni celles du propriétaire, sans le nonce des empreintes). */
export const describeRolexDossierRun = ({ plan, applied = null, dryRun = applied === null, projectId = null, usesEmulator = null }) => {
  const resultsByKey = new Map((applied?.state.results ?? []).map((result) => [result.key, result]));
  const ok = applied
    ? !FAILED_SYNC_STATUSES.has(applied.sync.status) && applied.state.summary.raced === 0
    : !BLOCKING_EXPECTATIONS.has(plan.sync.expected);
  return {
    event: 'ROLEX_CARTULARY_SEED',
    classification: 'Secret',
    projectId,
    usesEmulator,
    dryRun,
    flags: plan.flags,
    force: plan.flags.force,
    mode: plan.mode,
    cartularyId: plan.cartularyId,
    owner: plan.owner,
    root: plan.root,
    audit: plan.audit,
    editor: plan.editor,
    imported: applied?.imported ?? null,
    projected: applied?.projected ?? null,
    draft: { path: plan.draft.path, exists: plan.draft.exists, digest: plan.draft.digest, outOfSync: plan.draft.outOfSync, action: applied ? applied.draft : plan.draft.action },
    notes: {
      digests: 'fixtureDigest/existingDigest : sha256 salés par une clé aléatoire propre à cette exécution, tronqués à 12 hex ; comparables entre eux dans ce rapport seulement, jamais entre deux rapports : comparer les actions, differingFields et les tailles (fixtureBytes/existingBytes).',
      secondPass: 'Second passage attendu en production : unchanged 6, kept 1 (0 et unchanged 7 si cartularia-editable-copy a été forcée), kept_projection 6, conflict_with_root 1, sync skipped (no_state_change). Un unchanged plus élevé signifie qu’une clé de projection ou le code public a été réécrit : anomalie.',
      sync: 'La synchronisation consomme le quota cartulary_sync du propriétaire (120 par heure) et l’événement d’audit cartulary.live_state.synced est attribué au propriétaire (actor.uid = accountHolderId) : seule la reason rolex_dossier_seed_adr029 de la demande cartularySyncRequests trace le seed.',
    },
    genericOperationPending: plan.genericOperationPending ?? null,
    firstAuthoritativeSync: plan.firstAuthoritativeSync ?? false,
    state: {
      digestNote: 'fixtureDigest/existingDigest : sha256 salés par exécution, tronqués à 12 hex ; comparables entre eux dans ce rapport seulement (voir notes.digests).',
      summary: plan.state.summary,
      applied: applied ? applied.state.summary : null,
      entries: plan.state.entries.map(({ serialized: _serialized, ...entry }) => ({
        ...entry,
        result: resultsByKey.get(entry.key)?.result ?? null,
        revision: resultsByKey.get(entry.key)?.revision ?? null,
      })),
    },
    projection: plan.projection ? { ...plan.projection, applied: applied?.projection ?? null } : null,
    syncRequest: plan.syncRequest,
    syncRequired: plan.syncRequired,
    sync: applied ? applied.sync : { status: 'dry_run', expected: plan.sync.expected, reason: plan.sync.reason },
    warnings: [...plan.warnings, ...(applied?.warnings ?? [])],
    ok,
  };
};

export const runRolexDossier = async ({
  firestore,
  ownerUidOverride = null,
  dryRun = false,
  forceKeys = [],
  projectionKeys = false,
  projectionOnlyKeys = [],
  projectionScoped = false,
  resync = false,
  createAllowed = true,
  replaceStaleRequest = false,
  digestNonce = undefined,
  projectId = null,
  usesEmulator = null,
  now = () => Date.now(),
  ...applyOptions
}) => {
  const plan = await planRolexDossier({ firestore, ownerUidOverride, forceKeys, projectionKeys, projectionOnlyKeys, projectionScoped, resync, createAllowed, replaceStaleRequest, now, ...(digestNonce ? { digestNonce } : {}) });
  const applied = dryRun ? null : await applyRolexDossier({ firestore, plan, now, ...applyOptions });
  return { plan, applied, report: describeRolexDossierRun({ plan, applied, dryRun, projectId, usesEmulator }) };
};

/**
 * CLI complet sans initialisation Firebase : `firestore` est une instance ou une fabrique
 * (appelée seulement après validation des arguments et des garde-fous distants, avec les options
 * analysées : `{ projectId, usesEmulator, … }`). Gère aussi --help. Hors émulateur, le projet doit
 * être explicite même en --dry-run (project_required) : sans cela, le rapport lirait un projet
 * distant choisi par défaut avec les identifiants ADC de la session.
 */
export const runRolexDossierCli = async ({
  argv = [],
  env = {},
  firestore,
  stdout = process.stdout,
  stderr = process.stderr,
  processSyncRequest = processCartularySyncRequest,
  markSyncRequestFailed = markCartularySyncRequestFailed,
  sleep = defaultSleep,
  now = () => Date.now(),
  occurredAt = undefined,
  requestId = null,
  digestNonce = undefined,
  pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}) => {
  const failWith = (code, message) => {
    stderr.write(`${JSON.stringify({ event: 'ROLEX_CARTULARY_SEED_FAILED', code, message })}\n`);
    return { exitCode: 1, report: null };
  };
  const parsed = parseRolexDossierArgs(argv, env);
  if (!parsed.ok) return failWith(parsed.code, `${parsed.message}\n${ROLEX_DOSSIER_USAGE}`);
  const { options } = parsed;
  if (options.help) {
    stdout.write(`${ROLEX_DOSSIER_USAGE}\n`);
    return { exitCode: 0, report: null };
  }
  if (!options.usesEmulator && !options.allowRemote && !options.dryRun) {
    return failWith('remote_not_allowed', 'Seed interrompu : utilisez l’émulateur Firestore, --dry-run (lecture seule) ou passez explicitement --allow-remote avec des identifiants Admin.');
  }
  if (!options.usesEmulator && !options.projectId) {
    return failWith('project_required', `Hors émulateur, GCLOUD_PROJECT ou FIREBASE_PROJECT_ID doit désigner explicitement le projet, même en --dry-run : aucun repli sur un projet distant par défaut.\n${ROLEX_DOSSIER_USAGE}`);
  }
  try {
    const store = typeof firestore === 'function' ? await firestore({ projectId: options.projectId, usesEmulator: options.usesEmulator }) : firestore;
    if (!store) fail('firestore_unavailable', 'Aucune instance Firestore.');
    const { report } = await runRolexDossier({
      firestore: store,
      ownerUidOverride: options.ownerUidOverride,
      dryRun: options.dryRun,
      forceKeys: options.forceKeys,
      projectionKeys: options.projectionKeys,
      projectionOnlyKeys: options.projectionOnlyKeys,
      projectionScoped: options.projectionScoped,
      resync: options.resync,
      createAllowed: options.usesEmulator || options.allowCreate,
      replaceStaleRequest: options.replaceStaleRequest,
      projectId: options.projectId,
      usesEmulator: options.usesEmulator,
      processSyncRequest,
      markSyncRequestFailed,
      sleep,
      now,
      digestNonce,
      ...(occurredAt ? { occurredAt } : {}),
      requestId,
      pollTimeoutMs,
      pollIntervalMs,
    });
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return { exitCode: report.ok ? 0 : 1, report };
  } catch (error) {
    return failWith(error?.code || 'seed_failed', error?.message || String(error));
  }
};
