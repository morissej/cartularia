import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
const usesEmulator = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
const allowRemote = process.argv.includes('--allow-remote');
const checkOnly = process.argv.includes('--check');
const uidFlagIndex = process.argv.indexOf('--uid');
const uid = uidFlagIndex >= 0 ? String(process.argv[uidFlagIndex + 1] || '').trim() : '';

if (!projectId) throw new Error('GCLOUD_PROJECT ou FIREBASE_PROJECT_ID est requis.');
if (!uid) throw new Error('Utilisez --uid <identifiant Firebase Auth>.');
if (!usesEmulator && !allowRemote) {
  throw new Error('Modification distante refusée sans --allow-remote.');
}

const app = getApps()[0] || initializeApp({
  projectId,
  ...(usesEmulator ? {} : { credential: applicationDefault() }),
});
const auth = getAuth(app);
const user = await auth.getUser(uid);
const alreadyAdministrator = user.customClaims?.cartulariaAdmin === true;

if (!checkOnly && !alreadyAdministrator) {
  await auth.setCustomUserClaims(uid, {
    ...(user.customClaims || {}),
    cartulariaAdmin: true,
  });
}

console.log(JSON.stringify({
  projectId,
  uid,
  exists: true,
  cartulariaAdmin: checkOnly ? alreadyAdministrator : true,
  changed: !checkOnly && !alreadyAdministrator,
}, null, 2));

