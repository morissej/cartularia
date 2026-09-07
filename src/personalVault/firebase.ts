import { initializeApp } from 'firebase/app';
import { browserSessionPersistence, connectAuthEmulator, getAuth, setPersistence, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { resolveIsolatedVaultConfiguration } from './isolatedConfiguration';

const isolation = resolveIsolatedVaultConfiguration(import.meta.env);
const config = isolation.personal;
const emulatorMode = isolation.emulatorMode;
export const personalVaultIsConfigured = isolation.available;
export const personalVaultProjectId = config?.projectId || null;

const app = personalVaultIsConfigured && config ? initializeApp(config, 'cartularia-personal-vault') : null;
export const personalAuth: Auth | null = app ? getAuth(app) : null;
export const personalDb: Firestore | null = app ? getFirestore(app) : null;

export const personalPersistenceReady = personalAuth ? setPersistence(personalAuth, browserSessionPersistence) : Promise.resolve();

if (personalAuth && personalDb && emulatorMode) {
  const host = import.meta.env.VITE_PERSONAL_FIREBASE_EMULATOR_HOST || '127.0.0.1';
  connectAuthEmulator(personalAuth, `http://${host}:${Number(import.meta.env.VITE_PERSONAL_AUTH_EMULATOR_PORT || 19299)}`, { disableWarnings: true });
  connectFirestoreEmulator(personalDb, host, Number(import.meta.env.VITE_PERSONAL_FIRESTORE_EMULATOR_PORT || 8280));
}
