import { initializeApp } from 'firebase/app';
import { browserLocalPersistence, connectAuthEmulator, getAuth, setPersistence, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { resolveIsolatedVaultConfiguration } from './isolatedConfiguration';

const isolation = resolveIsolatedVaultConfiguration(import.meta.env);
const bridgeConfig = isolation.bridge;
const emulatorMode = isolation.emulatorMode;
export const codeBridgeIsConfigured = isolation.available;
const bridgeApp = bridgeConfig ? initializeApp(bridgeConfig, 'cartularia-code-bridge') : null;
export const codeBridgeAuth: Auth | null = bridgeApp ? getAuth(bridgeApp) : null;
export const codeBridgeDb: Firestore | null = bridgeApp ? getFirestore(bridgeApp) : null;

export const bridgePersistenceReady = codeBridgeAuth ? setPersistence(codeBridgeAuth, browserLocalPersistence) : Promise.resolve();

if (codeBridgeAuth && codeBridgeDb && emulatorMode) {
  const host = import.meta.env.VITE_PERSONAL_FIREBASE_EMULATOR_HOST || '127.0.0.1';
  connectAuthEmulator(codeBridgeAuth, `http://${host}:${Number(import.meta.env.VITE_CODE_BRIDGE_AUTH_EMULATOR_PORT || 19299)}`, { disableWarnings: true });
  connectFirestoreEmulator(codeBridgeDb, host, Number(import.meta.env.VITE_CODE_BRIDGE_FIRESTORE_EMULATOR_PORT || 8280));
}
