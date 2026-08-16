import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { connectFirestoreEmulator, doc, getDoc, getFirestore } from 'firebase/firestore';
import { connectStorageEmulator, getBytes, getStorage, ref } from 'firebase/storage';
import { IWC_CARTULARY_ID } from '../src/domain/cartularyIds.ts';

if (!process.argv.includes('--local')) {
  throw new Error('Vérification interrompue : ajoutez --local pour confirmer l’usage exclusif des émulateurs.');
}

const values = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .filter((line) => line && !line.startsWith('#') && line.includes('='))
  .map((line) => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1)];
  }));
const app = initializeApp({
  apiKey: values.VITE_FIREBASE_API_KEY,
  authDomain: values.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID || values.VITE_FIREBASE_PROJECT_ID,
  storageBucket: values.VITE_FIREBASE_STORAGE_BUCKET,
  appId: values.VITE_FIREBASE_APP_ID,
});
const auth = getAuth(app);
const firestore = getFirestore(app);
const storage = getStorage(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
connectStorageEmulator(storage, '127.0.0.1', 9199);

await signInWithEmailAndPassword(auth, 'owner.wave1@cartularia.test', 'Cartularia-Wave1-Local!');
const root = await getDoc(doc(firestore, 'cartularies', IWC_CARTULARY_ID));
const item = await getDoc(doc(firestore, 'registries', 'reg_collection_privee', 'items', IWC_CARTULARY_ID));
const primaryAssetId = item.data()?.primaryAssetId || root.data()?.primaryAssetId;
if (!root.exists() || !item.exists() || typeof primaryAssetId !== 'string') {
  throw new Error('Cartulaire, projection Registre ou média principal absent.');
}
const asset = await getDoc(doc(firestore, 'cartularies', IWC_CARTULARY_ID, 'assets', primaryAssetId));
const storagePath = asset.data()?.storagePath;
if (!asset.exists() || typeof storagePath !== 'string') throw new Error('Chemin Firebase Storage du média principal absent.');
const bytes = await getBytes(ref(storage, storagePath));
if (bytes.byteLength < 1) throw new Error('Original Storage vide.');

console.log(JSON.stringify({
  event: 'LIVE_CONNECTION_VERIFIED',
  cartularyId: IWC_CARTULARY_ID,
  cartularyRevision: root.data().revision,
  registrySourceRevision: item.data().sourceRevision,
  primaryAssetId,
  storagePath,
  storageBytesRead: bytes.byteLength,
  signedInUid: auth.currentUser?.uid,
}, null, 2));
