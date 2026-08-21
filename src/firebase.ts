import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectStorageEmulator, getStorage } from "firebase/storage";
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { installSessionLock } from './security/sessionSecurity';

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
const usesFirebaseEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true';
const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY?.trim();

// App Check starts in monitoring mode: the SDK sends tokens, while enforcement
// remains disabled service by service in the Firebase console.
export const appCheck = !usesFirebaseEmulators && appCheckSiteKey
  ? initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    })
  : null;

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, 'us-central1');

if (!usesFirebaseEmulators) installSessionLock(auth);

const emulatorState = globalThis as typeof globalThis & {
  __cartulariaFirebaseEmulatorsConnected?: boolean;
};

if (usesFirebaseEmulators && !emulatorState.__cartulariaFirebaseEmulatorsConnected) {
  const host = import.meta.env.VITE_FIREBASE_EMULATOR_HOST || '127.0.0.1';
  const authPort = Number(import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_PORT || 9099);
  const firestorePort = Number(import.meta.env.VITE_FIREBASE_FIRESTORE_EMULATOR_PORT || 8080);
  const storagePort = Number(import.meta.env.VITE_FIREBASE_STORAGE_EMULATOR_PORT || 9199);
  const functionsPort = Number(import.meta.env.VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT || 5001);

  connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, firestorePort);
  connectStorageEmulator(storage, host, storagePort);
  connectFunctionsEmulator(functions, host, functionsPort);
  emulatorState.__cartulariaFirebaseEmulatorsConnected = true;
}

export default app;
