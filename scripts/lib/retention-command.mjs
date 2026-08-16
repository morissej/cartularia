import { Timestamp } from 'firebase-admin/firestore';

export const PRIVATE_RETENTION_POLICY_VERSION = 'inactive-plus-2y-v1';
export const PRIVATE_RETENTION_YEARS = 2;

const asDate = (value) => {
  if (value instanceof Date) return new Date(value.getTime());
  if (value && typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new TypeError('Date de conservation invalide.');
  return parsed;
};

export const addCalendarYears = (value, years = PRIVATE_RETENTION_YEARS) => {
  const source = asDate(value);
  const result = new Date(source.getTime());
  const sourceMonth = result.getUTCMonth();
  result.setUTCFullYear(result.getUTCFullYear() + years);
  if (result.getUTCMonth() !== sourceMonth) result.setUTCDate(0);
  return result;
};

export const evaluatePrivateRetention = ({ status, inactiveAt, purgeAfter, now = new Date() }) => {
  if (status !== 'inactive' || !inactiveAt) return { eligible: false, reason: 'account_not_inactive', purgeAfter: null };
  const deadline = purgeAfter ? asDate(purgeAfter) : addCalendarYears(inactiveAt);
  return {
    eligible: deadline.getTime() <= asDate(now).getTime(),
    reason: deadline.getTime() <= asDate(now).getTime() ? 'retention_elapsed' : 'retention_running',
    purgeAfter: deadline,
  };
};

export const markAccountInactive = async ({ firestore, uid, inactiveAt = new Date() }) => {
  const inactiveDate = asDate(inactiveAt);
  const purgeDate = addCalendarYears(inactiveDate);
  const inactiveTimestamp = Timestamp.fromDate(inactiveDate);
  const purgeTimestamp = Timestamp.fromDate(purgeDate);
  const user = firestore.doc(`users/${uid}`);
  const cartularies = await firestore.doc(`privateDrafts/${uid}`).collection('cartularies').get();
  const batch = firestore.batch();
  batch.set(user, {
    status: 'inactive',
    inactiveAt: inactiveTimestamp,
    purgeAfter: purgeTimestamp,
    retentionPolicyVersion: PRIVATE_RETENTION_POLICY_VERSION,
    updatedAt: Timestamp.now(),
  }, { merge: true });
  for (const cartulary of cartularies.docs) {
    batch.set(cartulary.ref, {
      inactiveAt: inactiveTimestamp,
      purgeAfter: purgeTimestamp,
      retentionPolicyVersion: PRIVATE_RETENTION_POLICY_VERSION,
      updatedAt: Timestamp.now(),
    }, { merge: true });
  }
  await batch.commit();
  return { uid, inactiveAt: inactiveDate.toISOString(), purgeAfter: purgeDate.toISOString(), cartularyCount: cartularies.size };
};

const deleteStorageObjects = async (bucket, paths, dryRun) => {
  if (!bucket || dryRun) return;
  await Promise.all([...new Set(paths)].map((path) => bucket.file(path).delete({ ignoreNotFound: true })));
};

export const purgeAccountPrivateDrafts = async ({ firestore, bucket = null, uid, now = new Date(), dryRun = true }) => {
  const userSnapshot = await firestore.doc(`users/${uid}`).get();
  if (!userSnapshot.exists) return { uid, eligible: false, reason: 'user_not_found', cartularies: [], storageObjects: [] };
  const decision = evaluatePrivateRetention({ ...userSnapshot.data(), now });
  if (!decision.eligible) return { uid, ...decision, cartularies: [], storageObjects: [] };

  const cartularies = await firestore.doc(`privateDrafts/${uid}`).collection('cartularies').get();
  const storageObjects = [];
  for (const cartulary of cartularies.docs) {
    const binaries = await cartulary.ref.collection('binaries').get();
    for (const binary of binaries.docs) {
      const storagePath = binary.data().storagePath;
      if (typeof storagePath === 'string' && storagePath.startsWith(`private-drafts/${uid}/`)) storageObjects.push(storagePath);
    }
  }

  if (!dryRun) {
    await deleteStorageObjects(bucket, storageObjects, false);
    for (const cartulary of cartularies.docs) await firestore.recursiveDelete(cartulary.ref);
    await firestore.doc(`users/${uid}`).set({
      privateDraftsPurgedAt: Timestamp.now(),
      privateDataStatus: 'purged',
      updatedAt: Timestamp.now(),
    }, { merge: true });
  }

  return {
    uid,
    eligible: true,
    reason: decision.reason,
    purgeAfter: decision.purgeAfter.toISOString(),
    cartularies: cartularies.docs.map((document) => document.id),
    storageObjects: [...new Set(storageObjects)].sort(),
    dryRun,
  };
};

export const purgeDuePrivateDrafts = async ({ firestore, bucket = null, now = new Date(), dryRun = true }) => {
  const due = await firestore.collection('users').where('purgeAfter', '<=', Timestamp.fromDate(asDate(now))).get();
  const reports = [];
  for (const user of due.docs) {
    reports.push(await purgeAccountPrivateDrafts({ firestore, bucket, uid: user.id, now, dryRun }));
  }
  return reports;
};
