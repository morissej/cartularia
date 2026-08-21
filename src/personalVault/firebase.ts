import { initializeApp } from 'firebase/app';
import { browserSessionPersistence, connectAuthEmulator, getAuth, setPersistence, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';

const config = {
  apiKey: import.meta.env.VITE_PERSONAL_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_PERSONAL_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_PERSONAL_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_PERSONAL_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_PERSONAL_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_PERSONAL_FIREBASE_APP_ID,
};

const registryProjectId = import.meta.env.VITE_REGISTRY_FIREBASE_PROJECT_ID?.trim();
const personalProjectId = config.projectId?.trim();

if (registryProjectId && personalProjectId && registryProjectId === personalProjectId) {
  throw new Error('Le Coffre personnel doit utiliser un projet Firebase distinct du Registre.');
}

export const personalVaultIsConfigured = Boolean(
  config.apiKey && config.authDomain && config.projectId && config.appId,
);

const app = personalVaultIsConfigured ? initializeApp(config, 'cartularia-personal-vault') : null;
export const personalAuth: Auth | null = app ? getAuth(app) : null;
export const personalDb: Firestore | null = app ? getFirestore(app) : null;

if (personalAuth) void setPersistence(personalAuth, browserSessionPersistence);

if (personalAuth && personalDb && import.meta.env.VITE_PERSONAL_USE_FIREBASE_EMULATORS === 'true') {
  const host = import.meta.env.VITE_PERSONAL_FIREBASE_EMULATOR_HOST || '127.0.0.1';
  connectAuthEmulator(personalAuth, `http://${host}:${Number(import.meta.env.VITE_PERSONAL_AUTH_EMULATOR_PORT || 19299)}`, { disableWarnings: true });
  connectFirestoreEmulator(personalDb, host, Number(import.meta.env.VITE_PERSONAL_FIRESTORE_EMULATOR_PORT || 8280));
}
