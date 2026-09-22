const DATABASES = new Set(['registry', 'personal', 'bridge']);
const SCHEMA_VERSION = 'account-access@1.0.0';
const RECONCILIATION_VERSION = 'account-access-reconciliation@1.0.0';

export const ACCOUNT_ACCESS_RECONCILIATION_HELP = `Usage: node scripts/reconcile-account-access.mjs --project <firebase-project-id> --database <registry|personal|bridge> [--apply]
Pending recovery: add --resolve-pending --uid <uid> --operation-id <expected-id> --reason "reason" --operator "operator-reference"

Dry-run by default. --apply writes only Firestore account access barriers and existing registry mirrors.
The project is always explicit; no environment or .firebaserc default is used.
Authentication users, refresh tokens, private data, and other projects are never modified.
Pending operations or malformed records are skipped and require manual review.
Explicit pending recovery only marks an operation older than 10 minutes as failed, keeps
access suspended, and records an atomic audit. It never reactivates the account.
`;

export const parseAccountAccessReconcileArgs = (argv) => {
  const parsed = { apply: false, help: false, resolvePending: false, projectId: null, database: null };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') { parsed.help = true; continue; }
    if (argument === '--apply' || argument === '--resolve-pending') {
      if (seen.has(argument)) throw new Error(`Argument répété : ${argument}.`);
      seen.add(argument); parsed[argument === '--apply' ? 'apply' : 'resolvePending'] = true; continue;
    }
    const separator = argument.indexOf('=');
    const name = separator < 0 ? argument : argument.slice(0, separator);
    const optionKeys = { '--project': 'projectId', '--database': 'database', '--uid': 'uid', '--operation-id': 'expectedOperationId', '--reason': 'reason', '--operator': 'operator' };
    if (!Object.hasOwn(optionKeys, name)) throw new Error(`Argument inconnu : ${name}.`);
    if (seen.has(name)) throw new Error(`Argument répété : ${name}.`);
    seen.add(name);
    const value = separator < 0 ? argv[++index] : argument.slice(separator + 1);
    if (!value || value.startsWith('--')) throw new Error(`Valeur manquante : ${name}.`);
    parsed[optionKeys[name]] = value;
  }
  if (parsed.help) return parsed;
  validateTarget(parsed);
  if (parsed.resolvePending) validatePendingResolution(parsed);
  else if (['uid', 'expectedOperationId', 'reason', 'operator'].some((key) => parsed[key] !== undefined)) {
    throw new Error('Les paramètres de résolution ciblée exigent --resolve-pending.');
  }
  return parsed;
};

const validateTarget = ({ projectId, database }) => {
  if (typeof projectId !== 'string' || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)) {
    throw new Error('Projet Firebase explicite requis : --project <firebase-project-id>.');
  }
  if (!DATABASES.has(database)) throw new Error('Base explicite requise : --database registry|personal|bridge.');
};

const validatePendingResolution = ({ uid, expectedOperationId, reason, operator }) => {
  if (typeof uid !== 'string' || !uid || uid.length > 128 || uid.includes('/')) throw new Error('UID explicite requis pour résoudre une opération.');
  if (typeof expectedOperationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(expectedOperationId)) throw new Error('Identifiant d’opération attendu requis.');
  if (typeof reason !== 'string' || reason.trim().length < 8 || reason.length > 240) throw new Error('Motif explicite de 8 à 240 caractères requis.');
  if (typeof operator !== 'string' || operator.trim().length < 3 || operator.length > 120) throw new Error('Référence opérateur explicite de 3 à 120 caractères requise.');
};

const isBarrier = (value) => value && ['active', 'suspended'].includes(value.status)
  && Number.isInteger(value.validAfter) && value.validAfter >= 0;
const snapshotData = (snapshot) => snapshot?.exists ? snapshot.data() : null;
const sameBarrier = (value, expected) => value?.status === expected.status && value?.validAfter === expected.validAfter;

/** Produce metadata only; never copy profile or membership content into a report. */
export const planAccountAccessReconciliation = ({ user, database, accessSnapshot, profileSnapshot, membershipSnapshot }) => {
  const access = snapshotData(accessSnapshot);
  const profile = snapshotData(profileSnapshot);
  const membership = snapshotData(membershipSnapshot);
  if (access?.operationStatus === 'pending') return { decision: 'manual', reason: 'pending_operation' };
  if (accessSnapshot?.exists && (!isBarrier(access)
    || (access.schemaVersion !== undefined && access.schemaVersion !== SCHEMA_VERSION)
    || (access.operationStatus !== undefined && !['completed', 'failed'].includes(access.operationStatus))
    || (access.operationStatus === 'failed' && access.status !== 'suspended'))) {
    return { decision: 'manual', reason: 'malformed_account_access' };
  }
  if (database === 'registry' && profileSnapshot?.exists && (typeof profile?.status !== 'string' || !profile.status)) {
    return { decision: 'manual', reason: 'malformed_registry_profile' };
  }
  const mirrors = [profile?.accountAccess, membership?.accountAccess].filter((value) => value !== undefined);
  if (mirrors.some((value) => !isBarrier(value))) return { decision: 'manual', reason: 'malformed_access_mirror' };
  const authCutoff = user.tokensValidAfterTime ? Date.parse(user.tokensValidAfterTime) / 1000 : 0;
  if (!Number.isFinite(authCutoff) || authCutoff < 0) return { decision: 'manual', reason: 'malformed_auth_cutoff' };
  const status = user.disabled === true || access?.status === 'suspended'
    || mirrors.some((mirror) => mirror.status === 'suspended')
    || (database === 'registry' && profileSnapshot?.exists && profile.status !== 'active')
    ? 'suspended' : 'active';
  const validAfter = Math.max(Math.floor(authCutoff), access?.validAfter ?? 0, ...mirrors.map((mirror) => mirror.validAfter));
  const barrier = { status, validAfter };
  const closeRegistryProfile = database === 'registry' && profileSnapshot?.exists && status === 'suspended' && profile.status === 'active';
  const writeAccess = !sameBarrier(access, barrier);
  const writeProfile = database === 'registry' && profileSnapshot?.exists && (!sameBarrier(profile.accountAccess, barrier) || closeRegistryProfile);
  const writeMembership = database === 'registry' && membershipSnapshot?.exists && !sameBarrier(membership.accountAccess, barrier);
  return {
    decision: writeAccess || writeProfile || writeMembership ? 'change' : 'unchanged',
    reason: accessSnapshot?.exists ? 'reconcile_existing_barrier' : 'initialize_legacy_barrier',
    barrier, writeAccess, writeProfile, writeMembership, closeRegistryProfile,
  };
};

/**
 * One explicitly selected Auth/Firestore project only. Auth reads are repeated for every
 * transaction attempt; Firestore guards and mirrors participate in the same commit.
 * No transaction can span Auth and Firestore: direct console Auth changes still require
 * a subsequent reconciliation. Normal P2 administration writes its barrier first.
 */
export const reconcileAccountAccess = async ({
  auth, firestore, projectId, database, apply = false, pageSize = 1000, now = () => Date.now(),
}) => {
  validateTarget({ projectId, database });
  if (typeof apply !== 'boolean') throw new Error('Le mode apply doit être explicite.');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new Error('Taille de page invalide.');
  if (!auth?.listUsers || !auth?.getUser || !firestore?.doc || (apply && !firestore?.runTransaction)) {
    throw new Error('Clients Auth et Firestore du projet requis.');
  }
  for (const actualProject of [auth.app?.options?.projectId, firestore.projectId].filter(Boolean)) {
    if (actualProject !== projectId) throw new Error('Le client Firebase ne correspond pas au projet demandé.');
  }
  const results = [];
  const pageTokens = new Set();
  let pageToken;
  do {
    const page = await auth.listUsers(pageSize, pageToken);
    for (const listedUser of page.users) {
      const uid = listedUser.uid;
      if (typeof uid !== 'string' || !uid || uid.includes('/')) {
        results.push({ uid: null, decision: 'error', reason: 'invalid_uid' });
        continue;
      }
      const references = {
        access: firestore.doc(`accountAccess/${uid}`),
        profile: database === 'registry' ? firestore.doc(`users/${uid}`) : null,
        membership: database === 'registry' ? firestore.doc(`communityMemberships/${uid}`) : null,
      };
      const operation = async (transaction) => {
        const user = await auth.getUser(uid);
        const read = (reference) => reference ? (transaction ? transaction.get(reference) : reference.get()) : null;
        const [accessSnapshot, profileSnapshot, membershipSnapshot] = await Promise.all([
          read(references.access), read(references.profile), read(references.membership),
        ]);
        const plan = planAccountAccessReconciliation({ user, database, accessSnapshot, profileSnapshot, membershipSnapshot });
        if (apply && plan.decision === 'change') {
          const reconciledAt = new Date(now()).toISOString();
          if (plan.writeAccess) transaction.set(references.access, {
            schemaVersion: SCHEMA_VERSION, ...plan.barrier,
            reconciliationVersion: RECONCILIATION_VERSION, reconciledAt,
          }, { merge: true });
          if (plan.writeProfile) transaction.update(references.profile, {
            accountAccess: plan.barrier,
            ...(plan.closeRegistryProfile ? { status: 'suspended', updatedAt: reconciledAt } : {}),
          });
          if (plan.writeMembership) transaction.update(references.membership, { accountAccess: plan.barrier });
        }
        return {
          uid, decision: plan.decision === 'change' ? (apply ? 'applied' : 'would_change') : plan.decision,
          reason: plan.reason,
          ...(plan.barrier ? { status: plan.barrier.status, validAfter: plan.barrier.validAfter } : {}),
        };
      };
      try {
        results.push(apply ? await firestore.runTransaction(operation) : await operation(null));
      } catch (error) {
        results.push({ uid, decision: 'error', reason: typeof error?.code === 'string' ? error.code : 'operation_failed' });
      }
    }
    pageToken = page.pageToken;
    if (pageToken && pageTokens.has(pageToken)) throw new Error('Pagination Auth incohérente : curseur répété.');
    if (pageToken) pageTokens.add(pageToken);
  } while (pageToken);
  const counts = { examined: results.length, applied: 0, would_change: 0, unchanged: 0, manual: 0, error: 0 };
  for (const result of results) counts[result.decision] += 1;
  return { projectId, database, mode: apply ? 'apply' : 'dry-run', counts, results };
};
import { randomUUID } from 'node:crypto';

const timestampMillis = (value) => {
  try {
    if (value && typeof value.toMillis === 'function') return value.toMillis();
    if (value && typeof value.toDate === 'function') return value.toDate().getTime();
    if (typeof value === 'string') return Date.parse(value);
    if (value instanceof Date) return value.getTime();
  } catch { return NaN; }
  return NaN;
};

/** Recover a crashed administrative operation without granting access or touching Auth. */
export const resolveStaleAccountAccessOperation = async ({
  firestore, projectId, database, uid, expectedOperationId, reason, operator,
  apply = false, now = () => Date.now(),
}) => {
  validateTarget({ projectId, database });
  validatePendingResolution({ uid, expectedOperationId, reason, operator });
  if (typeof apply !== 'boolean') throw new Error('Le mode apply doit être explicite.');
  if (!firestore?.doc || (apply && !firestore?.runTransaction)) throw new Error('Client Firestore requis.');
  if (firestore.projectId && firestore.projectId !== projectId) throw new Error('Le client Firestore ne correspond pas au projet demandé.');
  const reference = firestore.doc(`accountAccess/${uid}`);
  const reconciliationId = randomUUID();
  const auditReference = firestore.doc(`accountAccessReconciliations/${reconciliationId}`);
  const operation = async (transaction) => {
    const snapshot = transaction ? await transaction.get(reference) : await reference.get();
    const current = snapshotData(snapshot);
    const manual = (code) => ({ uid, decision: 'manual', reason: code });
    if (!snapshot.exists || !isBarrier(current)) return manual('malformed_or_missing_account_access');
    if (current.operationId !== expectedOperationId) return manual('operation_id_mismatch');
    if (current.operationStatus !== 'pending' || current.status !== 'suspended') return manual('operation_not_pending_and_closed');
    const updatedAtMs = timestampMillis(current.updatedAt);
    const nowMs = now();
    if (!Number.isFinite(updatedAtMs) || !Number.isFinite(nowMs) || updatedAtMs > nowMs) return manual('unverifiable_pending_age');
    if (nowMs - updatedAtMs <= 10 * 60 * 1000) return manual('pending_operation_too_recent');
    if (apply) {
      const reconciledAt = new Date(nowMs).toISOString();
      // CAS is provided by the transaction read. A retry rechecks identity and server age.
      transaction.set(reference, {
        status: 'suspended', validAfter: current.validAfter, operationStatus: 'failed',
        failureCode: 'stale_operation_reconciled', reconciliationId,
        reconciliationVersion: RECONCILIATION_VERSION, reconciledAt,
      }, { merge: true });
      transaction.set(auditReference, {
        schemaVersion: RECONCILIATION_VERSION, action: 'pending.fail_closed',
        projectId, database, targetUid: uid, expectedOperationId,
        actor: { kind: 'cli', operator: operator.trim() }, reason: reason.trim(),
        previousUpdatedAt: new Date(updatedAtMs).toISOString(),
        status: 'suspended', validAfter: current.validAfter, createdAt: reconciledAt,
      });
    }
    return { uid, decision: apply ? 'applied' : 'would_change', reason: 'stale_pending_fail_closed',
      status: 'suspended', validAfter: current.validAfter, expectedOperationId,
      ...(apply ? { reconciliationId } : {}),
    };
  };
  const result = apply ? await firestore.runTransaction(operation) : await operation(null);
  const counts = { examined: 1, applied: 0, would_change: 0, unchanged: 0, manual: 0, error: 0 };
  counts[result.decision] = 1;
  return { projectId, database, mode: apply ? 'apply' : 'dry-run', operation: 'resolve-pending', counts, results: [result] };
};
