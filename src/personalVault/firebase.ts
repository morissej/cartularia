import { initializeApp } from 'firebase/app';
import { browserSessionPersistence, connectAuthEmulator, getAuth, setPersistence, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';

const defaultFirebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyCcBtXA-sqiX-P09NamO8CZ5gNPKaHx6jU',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'studio-2614005370-a3e51.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'studio-2614005370-a3e51',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'studio-2614005370-a3e51.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '27274402949',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:27274402949:web:fce503a37799f78eadddec',
};

const configuredPersonal = {
  apiKey: import.meta.env.VITE_PERSONAL_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_PERSONAL_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_PERSONAL_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_PERSONAL_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_PERSONAL_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_PERSONAL_FIREBASE_APP_ID,
};

const registryProjectId = import.meta.env.VITE_REGISTRY_FIREBASE_PROJECT_ID?.trim();
const emulatorMode = import.meta.env.VITE_PERSONAL_USE_FIREBASE_EMULATORS === 'true';
const hasDedicatedConfiguration = Boolean(
  configuredPersonal.apiKey && configuredPersonal.authDomain && configuredPersonal.projectId && configuredPersonal.appId,
);

const config = hasDedicatedConfiguration ? configuredPersonal : emulatorMode ? {
  apiKey: 'personal-vault-local-api-key',
  authDomain: 'cartularia-personal-vault-local.firebaseapp.com',
  projectId: 'cartularia-personal-vault-local',
  appId: '1:000000000000:web:personal-vault-local',
} : defaultFirebaseConfig;

const personalProjectId = config?.projectId?.trim();

if (hasDedicatedConfiguration && registryProjectId && personalProjectId && registryProjectId === personalProjectId) {
  throw new Error('Le Coffre personnel doit utiliser un projet Firebase distinct du Registre.');
}

export const personalVaultIsConfigured = Boolean(config?.apiKey && config?.projectId);

const app = personalVaultIsConfigured && config ? initializeApp(config, 'cartularia-personal-vault') : null;
export const personalAuth: Auth | null = app ? getAuth(app) : null;
export const personalDb: Firestore | null = app ? getFirestore(app) : null;

if (personalAuth) void setPersistence(personalAuth, browserSessionPersistence);

if (personalAuth && personalDb && emulatorMode) {
  const host = import.meta.env.VITE_PERSONAL_FIREBASE_EMULATOR_HOST || '127.0.0.1';
  connectAuthEmulator(personalAuth, `http://${host}:${Number(import.meta.env.VITE_PERSONAL_AUTH_EMULATOR_PORT || 19299)}`, { disableWarnings: true });
  connectFirestoreEmulator(personalDb, host, Number(import.meta.env.VITE_PERSONAL_FIRESTORE_EMULATOR_PORT || 8280));
}
