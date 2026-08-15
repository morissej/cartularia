import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectStorageEmulator, getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

const emulatorState = globalThis as typeof globalThis & {
  __cartulariaFirebaseEmulatorsConnected?: boolean;
};

if (import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true' && !emulatorState.__cartulariaFirebaseEmulatorsConnected) {
  const host = import.meta.env.VITE_FIREBASE_EMULATOR_HOST || '127.0.0.1';
  const authPort = Number(import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_PORT || 9099);
  const firestorePort = Number(import.meta.env.VITE_FIREBASE_FIRESTORE_EMULATOR_PORT || 8080);
  const storagePort = Number(import.meta.env.VITE_FIREBASE_STORAGE_EMULATOR_PORT || 9199);

  connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, firestorePort);
  connectStorageEmulator(storage, host, storagePort);
  emulatorState.__cartulariaFirebaseEmulatorsConnected = true;
}

export default app;
