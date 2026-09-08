import { createHash, randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { IWC_CARTULARY_ID } from '../../src/domain/cartularyIds.ts';
import {
  buildIwcCreationProfile,
  IWC_ORIGIN_TITLE,
  IWC_PUBLIC_CODE,
  IWC_SENSITIVITY_PRICES,
  IWC_UPDATE_DATE,
} from './iwc-dossier-values.mjs';

const IWC_UPDATE_DATE_LABEL = IWC_UPDATE_DATE.split('-').reverse().join('/');

/**
 * Complément des clés de profil du brouillon privé IWC (ADR-029), sans Storage ni dossier source.
 *
 * Règle « remplir les trous, ne jamais écraser » :
 *   - `cartularia-creation-profile`, `cartularia-public-code`, `cartularia-sensitivity-prices` :
 *     créées en révision 1 si absentes ; laissées et signalées (`skip_existing`) si présentes avec
 *     une autre valeur ou supprimées ;
 *   - `cartularia-editable-copy` : `originTitle` n'est fusionné (révision N+1, autres champs
 *     conservés octet pour octet) que s'il est absent ou vide ; la copie éditoriale n'est jamais
 *     créée par ce mode (elle relève de `update:iwc-dossier`).
 *
 * Cible : par défaut IWC_CARTULARY_ID ; un autre identifiant exige `--cartulary <id>`. Dans tous les
 * cas la racine doit porter le code public IWC (publicCode ou objectCode), ou, sans aucun code, un
 * makerName IWC ; sinon `not_iwc_cartulary`, aucune écriture.
 *
 * Le propriétaire est déduit de `cartularies/{id}.accountHolderId` : la synchronisation autoritaire
 * (assertOwnerEditor, live-sync-command.mjs) refuserait un brouillon sous un autre uid ; il est relu
 * dans la transaction d'application (`owner_changed` s'il a changé, `cartulary_gone` si la racine a
 * disparu ou est supprimée), ainsi que la garde de cible.
 *
 * Le membership organizations/{organizationId}/memberships/{uid} est lu (jamais écrit) pour signaler
 * (`owner_membership_missing`) qu'une synchronisation, demandée ici ou par le client, échouerait en
 * `permission_denied` après l'écriture des clés ; la demande passerait alors en `failed`.
 *
 * `--apply` est refusé sans écriture dès qu'une clé est contestée (`skip_existing`) ou que le plan
 * est bloqué, sauf `--allow-partial` qui n'écrit que les clés non contestées.
 *
 * La synchronisation n'est jamais exécutée en processus : au plus une demande `pending` tracée,
 * traitée par la Cloud Function syncCartularyToRegistry ou le worker sync:worker.
 *
 * Aucune valeur d'état n'est exposée dans le plan (numéro de série, prix d'achat : données Secret) :
 * seulement des digests tronqués, des tailles et des noms de champs. Le rapport porte en revanche
 * les montants de la racine (`root.valuation`, données Secret du Registre) : il est classé Secret.
 *
 * Effet monétaire du profil de création (live-sync-command.mjs) : sans montant sur la racine ni
 * état `cartularia-purchase` / `cartularia-retained-valuation` exploitable, la synchronisation
 * dérive purchasePrice, costBasis et grossValuation de `cartularia-creation-profile`
 * (purchasePrice, valuationMid) ; signalé par `creation_profile_drives_valuation`.
 */

export class IwcProfileKeysCommandError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'IwcProfileKeysCommandError';
    this.code = code;
    Object.assign(this, details);
  }
}

export const IWC_EDITABLE_COPY_KEY = 'cartularia-editable-copy';
export const IWC_PROFILE_KEYS = Object.freeze([
  'cartularia-creation-profile',
  'cartularia-public-code',
  'cartularia-sensitivity-prices',
  IWC_EDITABLE_COPY_KEY,
]);
/**
 * Hors de l'énumération client de firestore.rules (`private_draft_synchronized`, `manual_retry`,
 * réservée aux écritures du navigateur) : la demande est écrite par le SDK Admin, comme
 * `production_deployment_verification` dans request-cartulary-sync.mjs, et la raison spécifique
 * reste lisible dans cartularySyncRequests/{id} ; le préfixe du requestId la reporte dans
 * l'événement d'audit produit par la synchronisation.
 */
export const IWC_PROFILE_SYNC_REASON = 'iwc_profile_keys_adr029';
/** Clés d'état lues (jamais écrites) pour qualifier l'effet monétaire du profil de création. */
export const IWC_VALUATION_STATE_KEYS = Object.freeze(['cartularia-purchase', 'cartularia-purchase-expenses', 'cartularia-retained-valuation']);
/** Montants de la racine consultés par la synchronisation avant de retomber sur le profil de création. */
export const ROOT_VALUATION_FIELDS = Object.freeze(['purchasePrice', 'costBasis', 'grossValuation', 'netValuation']);
export const REPORT_CLASSIFICATION = 'Secret';
/** Marqueur de describeDifference : même contenu JSON sous une autre sérialisation (espaces, notation des nombres). */
export const SAME_CONTENT_MARKER = '(sérialisation différente, contenu identique)';
const WRITE_ACTIONS = new Set(['create', 'merge_origin_title']);
const SYNC_BUSY_STATUSES = new Set(['pending', 'processing']);
const IWC_MAKER_PATTERN = /IWC/i;
const SAFE_CARTULARY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{5,159}$/;

const SIMPLE_VALUES = new Map([
  ['cartularia-creation-profile', () => buildIwcCreationProfile()],
  ['cartularia-public-code', () => IWC_PUBLIC_CODE],
  ['cartularia-sensitivity-prices', () => [...IWC_SENSITIVITY_PRICES]],
]);

const fullDigestOf = (value) => (typeof value === 'string' ? `sha256:${createHash('sha256').update(value).digest('hex')}` : null);
/** Digest tronqué (12 hex) exposé dans le plan : identifie une valeur sans la révéler. */
export const shortDigestOf = (value) => (typeof value === 'string' ? createHash('sha256').update(value).digest('hex').slice(0, 12) : null);
const bytesOf = (value) => (typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0);
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const kindOf = (value) => (Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value);
const parseJson = (value) => {
  if (typeof value !== 'string') return { ok: false, parsed: undefined };
  try {
    return { ok: true, parsed: JSON.parse(value) };
  } catch {
    return { ok: false, parsed: undefined };
  }
};
/**
 * Noms des champs de premier niveau qui diffèrent (objets), longueurs (tableaux), ou nature de la
 * différence (scalaires, types, JSON illisible). Jamais les valeurs. Une sérialisation différente
 * d'un contenu identique (JSON.stringify(JSON.parse(existing)) === JSON.stringify(expected)) est
 * distinguée par SAME_CONTENT_MARKER : l'action reste skip_existing, le client comparant les chaînes
 * (syncModel.ts, sameState) et non le contenu.
 */
export const describeDifference = (existingSerialized, expected) => {
  if (typeof existingSerialized !== 'string') return ['(valeur absente ou non textuelle)'];
  const { ok, parsed: existing } = parseJson(existingSerialized);
  if (!ok) return ['(JSON illisible)'];
  if (JSON.stringify(existing) === JSON.stringify(expected)) return [SAME_CONTENT_MARKER];
  const existingKind = kindOf(existing);
  const expectedKind = kindOf(expected);
  if (existingKind !== expectedKind) return [`(type: ${existingKind} ≠ ${expectedKind})`];
  if (Array.isArray(existing)) {
    return existing.length === expected.length
      ? [`length=${existing.length} (contenu différent)`]
      : [`length=${existing.length} (attendu ${expected.length})`];
  }
  if (isPlainObject(existing)) {
    return [...new Set([...Object.keys(existing), ...Object.keys(expected)])]
      .filter((field) => JSON.stringify(existing[field]) !== JSON.stringify(expected[field]))
      .sort();
  }
  return [`(valeur ${existingKind} différente)`];
};
const isoOf = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  return null;
};
const syncRequestSummary = (data) => ({
  exists: Boolean(data),
  status: data?.status ?? null,
  outcome: data?.outcome ?? null,
  requestId: data?.requestId ?? null,
  reason: data?.reason ?? null,
  processedAt: isoOf(data?.processedAt),
});
const assertSyncIdle = (data, stage) => {
  if (data && SYNC_BUSY_STATUSES.has(data.status)) {
    throw new IwcProfileKeysCommandError('sync_in_progress', `Une synchronisation ${data.status} (${data.requestId ?? 'sans requestId'}) est en cours (constatée ${stage === 'transaction' ? 'dans la transaction d’application' : 'à la lecture du contexte'}) : écrire maintenant rendrait son digest périmé. Attendez son traitement.`, { stage, syncStatus: data.status, syncRequestId: data.requestId ?? null });
  }
};
const assertDraftActive = (draft, ownerUid, cartularyId) => {
  if (!draft.exists || draft.data()?.status !== 'active') {
    throw new IwcProfileKeysCommandError('draft_not_ready', `Le brouillon privé actif privateDrafts/${ownerUid}/cartularies/${cartularyId} est introuvable ; ce script ne le crée jamais.`);
  }
};

const textOf = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/**
 * Garde de cible : la racine doit être le Cartulaire IWC. Avec un code de marque (publicCode ou
 * objectCode), l'un des deux doit être IWC_PUBLIC_CODE ; sans aucun code, makerName doit
 * correspondre à /IWC/i. Renvoie le critère retenu.
 */
export const assertIwcTarget = (cartularyId, data) => {
  const codes = { publicCode: textOf(data.publicCode), objectCode: textOf(data.objectCode) };
  const presentCodes = Object.entries(codes).filter(([, value]) => value !== null);
  if (presentCodes.length > 0) {
    const match = presentCodes.find(([, value]) => value === IWC_PUBLIC_CODE);
    if (!match) {
      throw new IwcProfileKeysCommandError('not_iwc_cartulary', `Cartulaire ${cartularyId} : ${presentCodes.map(([field, value]) => `${field}=${value}`).join(', ')} ne correspond pas au code public IWC (${IWC_PUBLIC_CODE}) ; aucune écriture.`);
    }
    return { matchedBy: match[0] };
  }
  const makerName = textOf(data.makerName);
  if (!makerName || !IWC_MAKER_PATTERN.test(makerName)) {
    throw new IwcProfileKeysCommandError('not_iwc_cartulary', `Cartulaire ${cartularyId} sans publicCode ni objectCode et makerName=${makerName ?? 'absent'} : pas le Cartulaire IWC ; aucune écriture.`);
  }
  return { matchedBy: 'makerName' };
};

/**
 * Montants de la racine tels que la synchronisation les consulte (`moneyBaseline.x ?? profil`) :
 * `present` liste les champs non nuls ; les valeurs sont des données Secret (rapport classé Secret).
 */
export const describeRootValuation = (data) => {
  const amounts = Object.fromEntries(ROOT_VALUATION_FIELDS.map((field) => [field, data[field] ?? null]));
  return {
    ...amounts,
    valuationCurrency: data.valuationCurrency ?? null,
    present: ROOT_VALUATION_FIELDS.filter((field) => amounts[field] !== null),
  };
};

/** Vue de la racine pour le rapport : identifiants de rattachement et drapeaux, sans jeton d'opération. */
const describeRoot = (root, data, ownerUid) => ({
  id: root.id,
  revision: Number(data.revision || 0),
  accountHolderId: ownerUid,
  organizationId: textOf(data.organizationId),
  registryId: textOf(data.registryId),
  publicCode: textOf(data.publicCode),
  objectCode: textOf(data.objectCode),
  makerName: textOf(data.makerName),
  schemaId: data.schemaId ?? null,
  schemaVersion: data.schemaVersion ?? null,
  valuationCurrency: data.valuationCurrency ?? null,
  valuation: describeRootValuation(data),
  hasLiveStateDigest: typeof data.liveStateDigest === 'string',
  hasLegacyMediaDigest: typeof data.legacyMediaDigest === 'string',
  hasLegacyCollectionDigest: typeof data.legacyCollectionDigest === 'string',
});

const ownerOf = (data) => textOf(data.accountHolderId);

/**
 * Précondition de synchronisation, lue seulement : mêmes critères que assertOwnerEditor
 * (live-sync-command.mjs) sur organizations/{organizationId}/memberships/{uid}. `missing` liste les
 * critères non satisfaits ; `ok` vaut true quand la synchronisation serait acceptée.
 */
export const describeOwnerMembership = ({ membership, ownerUid, organizationId, registryId }) => {
  const path = organizationId ? `organizations/${organizationId}/memberships/${ownerUid}` : null;
  const data = membership?.exists ? membership.data() : null;
  const missing = [];
  if (!organizationId) missing.push('organizationId absent de la racine');
  if (!data) missing.push('membership absent');
  else {
    if (data.uid !== ownerUid) missing.push('uid différent');
    if (data.status !== 'active') missing.push(`status=${data.status ?? 'absent'}`);
    if (!Array.isArray(data.roles) || !data.roles.includes('legal_owner')) missing.push('rôle legal_owner');
    if (!Array.isArray(data.permissions) || !data.permissions.includes('cartulary.edit')) missing.push('permission cartulary.edit');
    if (!registryId || !Array.isArray(data.scopes?.registryIds) || !data.scopes.registryIds.includes(registryId)) missing.push('registryId hors scopes.registryIds');
  }
  return { path, exists: Boolean(data), ok: missing.length === 0, missing };
};

/** Propriétaire déduit de la racine (après garde de cible) ; une surcharge n'est acceptée que si elle est identique. */
export const resolveIwcOwner = async ({ firestore, cartularyId = IWC_CARTULARY_ID, overrideUid = null }) => {
  const root = await firestore.doc(`cartularies/${cartularyId}`).get();
  if (!root.exists) throw new IwcProfileKeysCommandError('cartulary_not_found', `Cartulaire ${cartularyId} introuvable dans cartularies/.`);
  const data = root.data();
  if (data.deletedAt) throw new IwcProfileKeysCommandError('cartulary_deleted', `Cartulaire ${cartularyId} supprimé.`);
  const target = assertIwcTarget(cartularyId, data);
  const ownerUid = ownerOf(data);
  if (!ownerUid) throw new IwcProfileKeysCommandError('owner_unknown', `Cartulaire ${cartularyId} sans accountHolderId : propriétaire indéterminable.`);
  const requested = textOf(overrideUid);
  if (requested && requested !== ownerUid) {
    // Les deux uid restent hors du message (journaux de session) : disponibles sur l'erreur.
    throw new IwcProfileKeysCommandError('owner_mismatch', 'CARTULARIA_OWNER_UID diffère de accountHolderId de la racine : la synchronisation refuserait ce brouillon (assertOwnerEditor, live-sync-command.mjs). Retirez la surcharge ou corrigez-la.', { requestedUid: requested, rootOwnerUid: ownerUid });
  }
  const described = describeRoot(root, data, ownerUid);
  const membership = described.organizationId
    ? await firestore.doc(`organizations/${described.organizationId}/memberships/${ownerUid}`).get()
    : null;
  return {
    ownerUid,
    ownerSource: requested ? 'env' : 'root',
    target: { cartularyId, isDefaultId: cartularyId === IWC_CARTULARY_ID, matchedBy: target.matchedBy },
    root: described,
    membership: describeOwnerMembership({ membership, ownerUid, organizationId: described.organizationId, registryId: described.registryId }),
  };
};

const asNonNegativeNumber = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);
/** Ce que la synchronisation lirait de chaque clé monétaire (stateValue : supprimée ou illisible = absente). */
const VALUATION_STATE_EFFECTIVE = {
  'cartularia-purchase': (value) => isPlainObject(value) && asNonNegativeNumber(value.purchasePrice) !== null,
  'cartularia-purchase-expenses': (value) => Array.isArray(value),
  'cartularia-retained-valuation': (value) => isPlainObject(value) && asNonNegativeNumber(value.amount) !== null,
};

/**
 * Présence des clés monétaires du brouillon, sans leur valeur : `present` = document non supprimé
 * au JSON lisible (ce que stateValue de live-sync-command.mjs retient) ; `effective` = le champ que
 * la synchronisation lit (purchasePrice, amount, tableau) est exploitable, sinon elle retombe sur
 * la racine puis sur cartularia-creation-profile.
 */
export const describeValuationKeys = (records) => Object.fromEntries(IWC_VALUATION_STATE_KEYS.map((key) => {
  const record = records.get(key) ?? null;
  const { ok, parsed } = record && record.deleted !== true ? parseJson(record.value) : { ok: false, parsed: undefined };
  const present = ok && parsed !== null && parsed !== undefined;
  return [key, { present, effective: present && VALUATION_STATE_EFFECTIVE[key](parsed) }];
}));

/** Brouillon actif, les quatre documents state/{clé} (plan) et les trois clés monétaires (lecture seule), et l'état de la demande de synchro. */
export const loadIwcProfileContext = async ({ firestore, ownerUid, cartularyId }) => {
  const draftRef = firestore.doc(`privateDrafts/${ownerUid}/cartularies/${cartularyId}`);
  const [draft, syncRequest, ...stateDocuments] = await Promise.all([
    draftRef.get(),
    firestore.doc(`cartularySyncRequests/${cartularyId}`).get(),
    ...[...IWC_PROFILE_KEYS, ...IWC_VALUATION_STATE_KEYS].map((key) => draftRef.collection('state').doc(key).get()),
  ]);
  assertDraftActive(draft, ownerUid, cartularyId);
  const syncData = syncRequest.exists ? syncRequest.data() : null;
  assertSyncIdle(syncData, 'context');
  const draftData = draft.data();
  const records = new Map(stateDocuments
    .filter((document) => document.exists)
    .map((document) => [document.id, { key: document.id, ...document.data() }]));
  return {
    draft: {
      status: draftData.status,
      retentionPolicyVersion: draftData.retentionPolicyVersion ?? null,
      lastActiveAt: isoOf(draftData.lastActiveAt),
      valuationKeys: describeValuationKeys(records),
    },
    // Seules les quatre clés de profil entrent dans le plan (et dans la relecture transactionnelle).
    states: new Map(IWC_PROFILE_KEYS.filter((key) => records.has(key)).map((key) => [key, records.get(key)])),
    syncRequest: syncRequestSummary(syncData),
  };
};

const describeExisting = (record) => (record
  ? { revision: Number(record.revision || 0), deleted: record.deleted === true, digest: fullDigestOf(record.value), bytes: bytesOf(record.value) }
  : { revision: 0, deleted: null, digest: null, bytes: 0 });

const planSimpleKey = (key, record) => {
  const expected = SIMPLE_VALUES.get(key)();
  const serialized = JSON.stringify(expected);
  const current = describeExisting(record);
  const base = {
    key,
    exists: Boolean(record),
    current,
    existingDigest: shortDigestOf(record?.value),
    existingBytes: current.bytes,
    expectedDigest: shortDigestOf(serialized),
    expectedBytes: bytesOf(serialized),
    blocking: false,
  };
  if (!record) {
    return { ...base, action: 'create', nextRevision: 1, nextValue: serialized, differingFields: [], note: 'clé absente : création en révision 1' };
  }
  if (record.deleted !== true && record.value === serialized) {
    return { ...base, action: 'noop', nextRevision: current.revision, differingFields: [], note: 'valeur attendue déjà en place' };
  }
  const differingFields = record.deleted === true ? ['(clé supprimée)'] : describeDifference(record.value, expected);
  return {
    ...base,
    action: 'skip_existing',
    nextRevision: current.revision,
    differingFields,
    note: record.deleted === true
      ? 'clé supprimée côté client : laissée telle quelle, à arbitrer manuellement'
      : differingFields[0] === SAME_CONTENT_MARKER
        ? 'même contenu sous une autre sérialisation : laissée telle quelle (le client compare les chaînes), à arbitrer manuellement'
        : 'valeur différente déjà en place : laissée telle quelle, à arbitrer manuellement',
  };
};

const planEditableCopy = (record) => {
  const current = describeExisting(record);
  const base = {
    key: IWC_EDITABLE_COPY_KEY,
    exists: Boolean(record),
    current,
    existingDigest: shortDigestOf(record?.value),
    existingBytes: current.bytes,
    expectedDigest: null,
    expectedBytes: null,
    differingFields: [],
  };
  if (!record || record.deleted === true) {
    return { ...base, action: 'missing_editable_copy', nextRevision: current.revision, blocking: true, note: 'copie éditoriale absente ou supprimée : le mode profil ne la recrée pas (update:iwc-dossier requis)' };
  }
  const { ok, parsed: existing } = parseJson(record.value);
  if (!ok || !isPlainObject(existing)) {
    return { ...base, action: 'invalid_editable_copy', nextRevision: current.revision, blocking: true, note: 'copie éditoriale illisible (JSON invalide ou non objet) : aucune écriture' };
  }
  const currentTitle = typeof existing.originTitle === 'string' ? existing.originTitle.trim() : '';
  if (currentTitle) {
    const expectedDiffers = currentTitle !== IWC_ORIGIN_TITLE;
    return {
      ...base,
      action: 'keep_origin_title',
      nextRevision: current.revision,
      blocking: false,
      expectedDiffers,
      differingFields: expectedDiffers ? ['originTitle'] : [],
      note: expectedDiffers ? 'originTitle déjà renseigné avec une autre valeur : conservé' : 'originTitle attendu déjà en place',
    };
  }
  // originTitle en tête, comme buildIwcEditableCopy() : la sérialisation rejoint celle du 29/08/2026
  // quand les autres champs sont identiques ; l'ordre relatif des autres champs est conservé.
  const { originTitle: _empty, ...rest } = existing;
  const nextValue = JSON.stringify({ originTitle: IWC_ORIGIN_TITLE, ...rest });
  return {
    ...base,
    action: 'merge_origin_title',
    nextRevision: current.revision + 1,
    nextValue,
    expectedDigest: shortDigestOf(nextValue),
    expectedBytes: bytesOf(nextValue),
    differingFields: ['originTitle'],
    blocking: false,
    note: 'originTitle absent ou vide : fusionné, autres champs inchangés',
  };
};

/** Plan pur : aucune lecture ni écriture. `states` : Map clé → document state/{clé} (ou absent). */
export const planIwcProfileKeys = ({ states, now = Date.now }) => {
  const entries = [
    ...[...SIMPLE_VALUES.keys()].map((key) => planSimpleKey(key, states.get(key) ?? null)),
    planEditableCopy(states.get(IWC_EDITABLE_COPY_KEY) ?? null),
  ];
  return {
    plannedAt: new Date(now()).toISOString(),
    entries,
    writes: entries.filter((entry) => WRITE_ACTIONS.has(entry.action)).length,
    skipped: entries.filter((entry) => entry.action === 'skip_existing').length,
    blocked: entries.some((entry) => entry.blocking),
  };
};

/** Vue du plan pour la sortie CLI : ni valeur, ni digest complet (seuls les digests tronqués restent). */
export const describeIwcProfilePlan = (plan) => ({
  ...plan,
  entries: plan.entries.map(({ nextValue: _value, current, ...entry }) => ({
    ...entry,
    currentRevision: current.revision,
    currentDeleted: current.deleted,
  })),
});

const requestIdFor = (nowMs) => `iwc_profile_keys_${new Date(nowMs).toISOString().slice(0, 10).replaceAll('-', '')}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;

const contestedSummary = (plan) => plan.entries
  .filter((entry) => entry.blocking || entry.action === 'skip_existing')
  .map((entry) => `${entry.key} (${entry.action})`)
  .join(', ');

/**
 * Application transactionnelle : relecture de la racine (propriétaire et cible), du brouillon, des
 * quatre documents et de la demande de synchro ; refus si l'un d'eux a changé depuis le plan
 * (owner_changed, revision_conflict) ou si une synchro est en cours ; écritures de la forme poussée
 * par le client (cloudDraft.ts) pour que celui-ci les tire.
 *
 * Sans `allowPartial`, tout plan contesté (clé skip_existing) ou bloqué est refusé sans écriture.
 */
export const applyIwcProfileKeys = async ({
  firestore,
  cartularyId,
  ownerUid,
  plan,
  dryRun = false,
  requestSync = false,
  allowPartial = false,
  now = Date.now,
  requestId = null,
  serverTimestamp = () => FieldValue.serverTimestamp(),
}) => {
  const writes = plan.entries.filter((entry) => WRITE_ACTIONS.has(entry.action));
  const keys = writes.map((entry) => entry.key);
  const contested = plan.blocked || plan.skipped > 0;
  const status = contested ? 'partial' : 'complete';
  if (dryRun) return { status: 'planned', completeness: status, writes: writes.length, keys, syncRequested: false, requestId: null };
  if (contested && !allowPartial) {
    throw new IwcProfileKeysCommandError(plan.blocked ? 'plan_blocked' : 'keys_contested', `${plan.blocked ? 'Plan bloqué' : 'Clé(s) contestée(s)'}, aucune écriture : ${contestedSummary(plan)}. Relancez avec --allow-partial pour n'écrire que les clés non contestées.`);
  }
  if (writes.length === 0) return { status: 'applied', completeness: status, writes: 0, keys: [], syncRequested: false, requestId: null };

  const rootRef = firestore.doc(`cartularies/${cartularyId}`);
  const draftRef = firestore.doc(`privateDrafts/${ownerUid}/cartularies/${cartularyId}`);
  const syncRequestRef = firestore.doc(`cartularySyncRequests/${cartularyId}`);
  const effectiveRequestId = requestId || requestIdFor(now());
  return firestore.runTransaction(async (transaction) => {
    const [root, draft, syncRequest, ...stateSnapshots] = await Promise.all([
      transaction.get(rootRef),
      transaction.get(draftRef),
      transaction.get(syncRequestRef),
      ...plan.entries.map((entry) => transaction.get(draftRef.collection('state').doc(entry.key))),
    ]);
    if (!root.exists || root.data()?.deletedAt) {
      throw new IwcProfileKeysCommandError('cartulary_gone', `Cartulaire ${cartularyId} ${root.exists ? 'supprimé' : 'disparu'} entre le plan et l'application : aucune écriture.`);
    }
    const rootData = root.data();
    // Garde de cible relue : une racine devenue étrangère entre le plan et l'application est refusée.
    assertIwcTarget(cartularyId, rootData);
    const currentOwner = ownerOf(rootData);
    if (currentOwner !== ownerUid) {
      throw new IwcProfileKeysCommandError('owner_changed', 'accountHolderId a changé entre le plan et l’application : aucune écriture dans le brouillon du propriétaire planifié, relancez --dry-run.', { plannedOwnerUid: ownerUid, currentOwnerUid: currentOwner });
    }
    assertDraftActive(draft, ownerUid, cartularyId);
    assertSyncIdle(syncRequest.exists ? syncRequest.data() : null, 'transaction');
    plan.entries.forEach((entry, index) => {
      const snapshot = stateSnapshots[index];
      const current = describeExisting(snapshot.exists ? snapshot.data() : null);
      // `exists` est subsumé par `deleted` (null pour un document absent, booléen sinon) : gardé
      // pour la lisibilité, il ne peut pas être le seul critère déclencheur.
      if (
        snapshot.exists !== entry.exists
        || current.revision !== entry.current.revision
        || current.deleted !== entry.current.deleted
        || current.digest !== entry.current.digest
      ) {
        throw new IwcProfileKeysCommandError('revision_conflict', `${entry.key} a changé entre le plan et l'application (révision ${entry.current.revision} → ${current.revision}, supprimé ${entry.current.deleted} → ${current.deleted}, digest ${entry.current.digest === current.digest ? 'identique' : 'différent'}) : relancez --dry-run.`);
      }
    });

    const clientUpdatedAt = now();
    for (const entry of writes) {
      transaction.set(draftRef.collection('state').doc(entry.key), {
        ownerUid,
        cartularyId,
        key: entry.key,
        value: entry.nextValue,
        deleted: false,
        revision: entry.nextRevision,
        clientUpdatedAt,
        updatedAt: serverTimestamp(),
      });
    }
    // Même signal d'activité que le client (retention inactive-plus-2y-v1) ; update() échoue si le
    // brouillon a disparu.
    transaction.update(draftRef, { lastActiveAt: serverTimestamp(), updatedAt: serverTimestamp() });
    if (requestSync) {
      // set() sans merge : la demande précédente (outcome, processedAt, …) est remplacée intégralement.
      transaction.set(syncRequestRef, {
        requestDocumentId: cartularyId,
        requestId: effectiveRequestId,
        ownerUid,
        cartularyId,
        reason: IWC_PROFILE_SYNC_REASON,
        status: 'pending',
        requestedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return { status: 'applied', completeness: status, writes: writes.length, keys, syncRequested: requestSync, requestId: requestSync ? effectiveRequestId : null };
  });
};

/**
 * Champs de la racine que la prochaine synchronisation dériverait de cartularia-creation-profile
 * (live-sync-command.mjs : `purchase.purchasePrice` → `moneyBaseline.purchasePrice ?? profil.purchasePrice`,
 * `retainedValuation.amount` → `moneyBaseline.grossValuation ?? profil.valuationMid`). Vide quand le
 * profil ne sera pas présent après l'opération (clé supprimée côté client) ou quand la racine ou le
 * brouillon fournissent déjà les montants. La projection, aussi consultée par la synchronisation,
 * n'est pas lue ici : au pire un avertissement de trop.
 */
export const creationProfileValuationEffects = ({ root, plan, draft }) => {
  const valuation = root?.valuation;
  const keys = draft?.valuationKeys;
  if (!valuation || !keys) return [];
  const profileEntry = plan.entries.find((entry) => entry.key === 'cartularia-creation-profile');
  const profilePresentAfter = Boolean(profileEntry) && (profileEntry.action === 'create' || profileEntry.current?.deleted === false);
  if (!profilePresentAfter) return [];
  const effects = [];
  if (valuation.purchasePrice === null && !keys['cartularia-purchase'].effective) effects.push('purchasePrice', 'costBasis');
  if (valuation.grossValuation === null && !keys['cartularia-retained-valuation'].effective) effects.push('grossValuation');
  return effects;
};

/** Avertissements d'exploitation dérivés de la racine, du brouillon, du membership et du plan (sortie CLI, testables). */
export const iwcProfileWarnings = ({ root, plan, requestSync = false, membership = null, draft = null }) => {
  const warnings = [];
  if (membership && !membership.ok) {
    warnings.push({ code: 'owner_membership_missing', message: `Précondition de synchronisation non remplie (${membership.path ?? 'membership indéterminable'} : ${membership.missing.join(', ')}) : toute synchronisation, demandée par --request-sync ou par le client, échouerait en permission_denied (assertOwnerEditor, live-sync-command.mjs) après l’écriture des clés et la demande passerait en failed ; rétablir le membership avant --apply --request-sync.` });
  }
  const valuationEffects = creationProfileValuationEffects({ root, plan, draft });
  if (valuationEffects.length > 0) {
    const missingKeys = IWC_VALUATION_STATE_KEYS.filter((key) => key !== 'cartularia-purchase-expenses' && !draft.valuationKeys[key].effective);
    warnings.push({
      code: 'creation_profile_drives_valuation',
      fields: valuationEffects,
      missingKeys,
      message: `La racine ne porte aucun montant (${valuationEffects.join(', ')}) et le brouillon n’a pas d’état exploitable pour ${missingKeys.join(', ')} : à la prochaine synchronisation, ces champs de la racine et de la projection du Registre seront dérivés de cartularia-creation-profile (purchasePrice, valuationMid ; live-sync-command.mjs) et non d’une saisie du propriétaire. Vérifier avec lui, avant --apply, que les montants du dossier du ${IWC_UPDATE_DATE_LABEL} sont ceux à inscrire au Registre ; sinon lui faire saisir achat et valeur retenue dans le client avant la synchronisation.`,
    });
  }
  const profileSchemaVersion = buildIwcCreationProfile().schemaVersion;
  if (root.valuationCurrency !== 'EUR') {
    warnings.push({ code: 'valuation_currency_switch', message: `La racine porte valuationCurrency=${root.valuationCurrency ?? 'absent'} ; cartularia-creation-profile.currency ('EUR') prendra le pas sur la devise de la projection à la prochaine synchronisation (live-sync-command.mjs).` });
  }
  if (!root.hasLegacyMediaDigest) {
    warnings.push({ code: 'legacy_media_digest_missing', message: 'La racine ne porte pas legacyMediaDigest : la prochaine synchronisation re-patchera tous les actifs à valeurs identiques et posera legacyCollectionDigest (aucun retrait attendu).' });
  }
  if (root.schemaVersion && root.schemaVersion !== profileSchemaVersion) {
    warnings.push({ code: 'schema_version_declared_differs', message: `Le profil déclare schemaVersion ${profileSchemaVersion} alors que la racine est en ${root.schemaVersion} : sans effet fonctionnel, la remontée relève de schema:upgrade (ADR-031).` });
  }
  if (plan.writes > 0) {
    warnings.push({ code: 'next_sync_increments_revision', message: 'Toute écriture d’état change le digest du brouillon : la prochaine synchronisation (via --request-sync, ou demandée par le client à la prochaine session du propriétaire) produira revision + 1 et un événement d’audit irréversible.' });
    warnings.push({ code: 'owner_local_copy_conflict', message: 'Côté propriétaire, une copie locale non poussée (cartularia-sensitivity-prices est persistée au montage, cartularia-editable-copy à chaque édition) sera signalée « conflict » par le client (syncModel.ts) : le propriétaire devra choisir la version cloud ou locale à sa prochaine session.' });
    if (!requestSync) {
      warnings.push({ code: 'audit_attribution_without_request_sync', message: 'Sans --request-sync, la prochaine synchronisation sera demandée par le client (reason private_draft_synchronized) : la trace d’audit ne portera pas la raison de cette opération. Recommandé : --request-sync (reason iwc_profile_keys_adr029, requestId préfixé iwc_profile_keys_).' });
    }
  }
  if (plan.skipped > 0) {
    warnings.push({ code: 'keys_skipped', message: `${plan.skipped} clé(s) déjà présente(s) avec une autre valeur ou supprimée(s) : laissée(s) telle(s) quelle(s), à arbitrer manuellement (--apply refusé sans --allow-partial).` });
  }
  if (plan.blocked) {
    const blockedEntry = plan.entries.find((entry) => entry.blocking);
    warnings.push({ code: 'editable_copy_blocked', message: `${IWC_EDITABLE_COPY_KEY} : ${blockedEntry?.action ?? 'bloquée'} ; originTitle ne sera pas fusionné (--apply refusé sans --allow-partial ; avec --allow-partial seules les clés simples non contestées sont écrites, la copie éditoriale relève de update:iwc-dossier).` });
  }
  return warnings;
};

export const IWC_PROFILE_KEYS_USAGE = [
  'Utilisation : node scripts/update-iwc-profile-keys.mjs (--dry-run | --apply) [--request-sync] [--allow-partial] [--cartulary <id>] [--allow-remote]',
  '  --dry-run          plan seulement, aucune écriture (lit Firestore : --allow-remote requis hors émulateur)',
  '  --apply            applique le plan dans une transaction ; refusé sans écriture si une clé est contestée (skip_existing) ou si le plan est bloqué',
  '  --allow-partial    avec --apply : n’écrit que les clés non contestées, les autres restent à arbitrer (code de sortie 0) ;',
  '                     avec --dry-run : prévisualise cet état partiel (code de sortie 0 au lieu de 1).',
  '                     Contrôle après --apply --allow-partial : --dry-run --allow-partial (code 0, writes=0, clés contestées',
  '                     toujours listées skip_existing) ; --dry-run seul rend 1 tant qu’une clé contestée subsiste.',
  `  --request-sync     avec --apply : dépose une demande cartularySyncRequests/{id} pending (reason ${IWC_PROFILE_SYNC_REASON}) ;`,
  '                     recommandé pour que la trace d’audit porte la raison de l’opération (sinon la synchro suivante est attribuée au client).',
  '                     Précondition lue, jamais écrite : organizations/{organizationId}/memberships/{uid} actif, rôle legal_owner,',
  '                     permission cartulary.edit, registryId dans scopes.registryIds ; sinon avertissement owner_membership_missing',
  '                     et la demande passerait en failed après l’écriture des clés (le client peut la redéposer).',
  '                     Demande pending jamais traitée (Cloud Function syncCartularyToRegistry absente ou en échec) : la traiter avec',
  '                     le worker du dépôt, npm run sync:worker -- --allow-remote, lancé comme ce script via',
  '                     GCLOUD_PROJECT=<projet> node scripts/run-with-firebase-cli-adc.mjs -- node scripts/run-cartulary-sync-worker.mjs --allow-remote',
  '                     (il traite toute demande pending du projet) ; il écoute cartularySyncRequests status=pending, journalise CARTULARY_SYNC ou',
  '                     CARTULARY_SYNC_FAILED (demande processed ou failed) et s’arrête par Ctrl-C ; ne jamais réécrire la demande à la main.',
  `  --cartulary <id>   cible explicite (une seule fois) ; défaut ${IWC_CARTULARY_ID}. La racine doit porter le code public IWC (${IWC_PUBLIC_CODE})`,
  '                     ou, sans aucun code, un makerName IWC ; sinon not_iwc_cartulary, aucune écriture. CARTULARIA_CARTULARY_ID n’est pas lu.',
  '  --allow-remote     obligatoire dès que FIRESTORE_EMULATOR_HOST est absent',
  '                     Identifiants hors émulateur : applicationDefault() ne lit pas la session Firebase CLI ; lancer',
  '                     GCLOUD_PROJECT=<projet> node scripts/run-with-firebase-cli-adc.mjs -- node scripts/update-iwc-profile-keys.mjs …',
  '                     (jeton de la session firebase login) ou définir GOOGLE_APPLICATION_CREDENTIALS, sinon « Could not load the default credentials ».',
  '  --help             cette aide',
  'Environnement : GCLOUD_PROJECT ou FIREBASE_PROJECT_ID (hors émulateur), CARTULARIA_OWNER_UID (surcharge vérifiée contre accountHolderId).',
  'Codes de sortie : 0 = plan ou application menés à terme ; 1 = erreur ou plan contesté/bloqué sans --allow-partial (rien n’a été écrit).',
  'Le rapport ne contient jamais de valeur d’état (numéro de série, prix d’achat) : digests tronqués, tailles et noms de champs seulement ;',
  'il porte en revanche les montants de la racine (root.valuation : purchasePrice, costBasis, grossValuation, netValuation, valuationCurrency)',
  `et la présence des clés monétaires du brouillon (draft.valuationKeys) : rapport classé ${REPORT_CLASSIFICATION}, à ne pas coller dans un journal partagé.`,
  'Avertissement creation_profile_drives_valuation : sans montant sur la racine ni cartularia-purchase / cartularia-retained-valuation',
  'exploitable, la prochaine synchronisation dérive purchasePrice, costBasis et grossValuation de cartularia-creation-profile',
  '(purchasePrice, valuationMid) : faire valider ces montants par le propriétaire avant --apply.',
  'target.matchedBy vaut publicCode, objectCode ou makerName selon la racine (les trois sont acceptables).',
  'Risque côté propriétaire : une copie locale non poussée (cartularia-sensitivity-prices persistée au montage, cartularia-editable-copy',
  'éditée) sera signalée « conflict » par le client à sa prochaine session ; prévenir le propriétaire avant --apply.',
].join('\n');

const OPTION_FLAGS = new Set(['--dry-run', '--apply', '--request-sync', '--allow-partial', '--allow-remote', '--help']);

/** Analyse pure des arguments et de l'environnement : aucune lecture Firestore, erreurs renvoyées en données. */
export const parseIwcProfileKeysArgs = (argv = [], env = {}) => {
  const flags = new Set();
  const errors = [];
  let cartularyId = IWC_CARTULARY_ID;
  let cartularySource = 'default';
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (OPTION_FLAGS.has(argument)) {
      flags.add(argument);
      continue;
    }
    let requested = null;
    if (argument === '--cartulary') {
      requested = argv[index + 1];
      index += 1;
    } else if (argument.startsWith('--cartulary=')) {
      requested = argument.slice('--cartulary='.length);
    } else {
      errors.push(`Drapeau inconnu : ${argument}`);
      continue;
    }
    if (typeof requested !== 'string' || !SAFE_CARTULARY_ID.test(requested)) {
      errors.push(`--cartulary attend un identifiant valide (reçu : ${requested ?? 'rien'})`);
      continue;
    }
    if (cartularySource === 'flag') {
      errors.push('--cartulary ne peut être passé qu’une seule fois (cible ambiguë).');
      continue;
    }
    cartularyId = requested;
    cartularySource = 'flag';
  }
  const help = flags.has('--help');
  const dryRun = flags.has('--dry-run');
  const apply = flags.has('--apply');
  const requestSync = flags.has('--request-sync');
  const allowPartial = flags.has('--allow-partial');
  const allowRemote = flags.has('--allow-remote');
  const usesEmulator = Boolean(env.FIRESTORE_EMULATOR_HOST);
  const projectId = env.GCLOUD_PROJECT || env.FIREBASE_PROJECT_ID || (usesEmulator ? 'cartularia-wave2-local' : null);
  if (!help) {
    if (dryRun === apply) errors.push('Choisissez exactement un mode : --dry-run ou --apply.');
    if (!usesEmulator && !allowRemote) errors.push('Interrompu : hors émulateur, --allow-remote est requis même en --dry-run (le plan lit Firestore).');
    if (!projectId) errors.push('GCLOUD_PROJECT ou FIREBASE_PROJECT_ID est requis hors émulateur.');
  }
  return {
    ok: errors.length === 0,
    errors,
    help,
    options: {
      dryRun,
      apply,
      requestSync,
      allowPartial,
      allowRemote,
      usesEmulator,
      projectId,
      cartularyId,
      cartularySource,
      overrideUid: textOf(env.CARTULARIA_OWNER_UID),
    },
  };
};

/**
 * Exécution complète du CLI hors initialisation Firebase : analyse, résolution, plan, application,
 * rapport JSON sur stdout. Renvoie { exitCode, report }.
 */
export const runIwcProfileKeysCli = async ({ argv = [], env = {}, firestore, stdout, stderr, now = Date.now, requestId = null }) => {
  const parsed = parseIwcProfileKeysArgs(argv, env);
  if (parsed.help) {
    stdout.write(`${IWC_PROFILE_KEYS_USAGE}\n`);
    return { exitCode: 0, report: null };
  }
  if (!parsed.ok) {
    stderr.write(`${parsed.errors.join('\n')}\n${IWC_PROFILE_KEYS_USAGE}\n`);
    return { exitCode: 1, report: null };
  }
  const { dryRun, requestSync, allowPartial, usesEmulator, projectId, cartularyId, cartularySource, overrideUid } = parsed.options;
  const emit = (report) => {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report;
  };
  let plan = null;
  try {
    const owner = await resolveIwcOwner({ firestore, cartularyId, overrideUid });
    const context = await loadIwcProfileContext({ firestore, ownerUid: owner.ownerUid, cartularyId });
    plan = planIwcProfileKeys({ states: context.states, now });
    const result = await applyIwcProfileKeys({ firestore, cartularyId, ownerUid: owner.ownerUid, plan, dryRun, requestSync, allowPartial, now, requestId });
    const contested = plan.blocked || plan.skipped > 0;
    const report = emit({
      event: dryRun ? 'IWC_PROFILE_KEYS_PLAN' : 'IWC_PROFILE_KEYS_APPLIED',
      classification: REPORT_CLASSIFICATION,
      projectId,
      usesEmulator,
      cartularyId,
      cartularySource,
      target: owner.target,
      ownerUid: owner.ownerUid,
      ownerSource: owner.ownerSource,
      ownerMembership: owner.membership,
      root: owner.root,
      draft: context.draft,
      syncRequest: context.syncRequest,
      plan: describeIwcProfilePlan(plan),
      dryRun,
      allowPartial,
      writes: result.writes,
      keys: result.keys,
      completeness: result.completeness,
      requestSyncFlag: requestSync,
      syncRequested: result.syncRequested,
      requestId: result.requestId,
      warnings: iwcProfileWarnings({ root: owner.root, plan, requestSync, membership: owner.membership, draft: context.draft }),
    });
    return { exitCode: contested && !allowPartial ? 1 : 0, report };
  } catch (error) {
    if (!(error instanceof IwcProfileKeysCommandError)) throw error;
    // Le plan calculé (sans valeur) accompagne un refus survenu après lui : keys_contested,
    // plan_blocked, revision_conflict, owner_changed, cartulary_gone, sync_in_progress (transaction).
    const report = emit({
      event: 'IWC_PROFILE_KEYS_FAILED',
      classification: REPORT_CLASSIFICATION,
      projectId,
      usesEmulator,
      cartularyId,
      cartularySource,
      code: error.code,
      stage: error.stage ?? null,
      message: error.message,
      written: false,
      plan: plan ? describeIwcProfilePlan(plan) : null,
    });
    return { exitCode: 1, report };
  }
};
