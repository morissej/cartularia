import { initializeApp } from 'firebase/app';
import { browserLocalPersistence, connectAuthEmulator, getAuth, setPersistence, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';

const defaultFirebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyCcBtXA-sqiX-P09NamO8CZ5gNPKaHx6jU',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'studio-2614005370-a3e51.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'studio-2614005370-a3e51',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'studio-2614005370-a3e51.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '27274402949',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:27274402949:web:fce503a37799f78eadddec',
};

const configuredBridge = {
  apiKey: import.meta.env.VITE_CODE_BRIDGE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_CODE_BRIDGE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_CODE_BRIDGE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_CODE_BRIDGE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_CODE_BRIDGE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_CODE_BRIDGE_FIREBASE_APP_ID,
};

const personalProjectId = import.meta.env.VITE_PERSONAL_FIREBASE_PROJECT_ID?.trim();
const registryProjectId = import.meta.env.VITE_REGISTRY_FIREBASE_PROJECT_ID?.trim();
const emulatorMode = import.meta.env.VITE_PERSONAL_USE_FIREBASE_EMULATORS === 'true';
const hasDedicatedConfiguration = Boolean(
  configuredBridge.apiKey && configuredBridge.authDomain && configuredBridge.projectId && configuredBridge.appId,
);

const bridgeConfig = hasDedicatedConfiguration ? configuredBridge : emulatorMode ? {
  apiKey: 'code-bridge-local-api-key',
  authDomain: 'cartularia-code-bridge-local.firebaseapp.com',
  projectId: 'cartularia-code-bridge-local',
  appId: '1:000000000000:web:code-bridge-local',
} : defaultFirebaseConfig;

const bridgeProjectId = bridgeConfig?.projectId?.trim();
if (hasDedicatedConfiguration && bridgeProjectId && (bridgeProjectId === personalProjectId || bridgeProjectId === registryProjectId)) {
  throw new Error('La base de correspondance doit utiliser un troisième projet Firebase distinct.');
}

export const codeBridgeIsConfigured = Boolean(bridgeConfig?.apiKey && bridgeConfig?.projectId);
const bridgeApp = bridgeConfig ? initializeApp(bridgeConfig, 'cartularia-code-bridge') : null;
export const codeBridgeAuth: Auth | null = bridgeApp ? getAuth(bridgeApp) : null;
export const codeBridgeDb: Firestore | null = bridgeApp ? getFirestore(bridgeApp) : null;

if (codeBridgeAuth) void setPersistence(codeBridgeAuth, browserLocalPersistence);

if (codeBridgeAuth && codeBridgeDb && emulatorMode) {
  const host = import.meta.env.VITE_PERSONAL_FIREBASE_EMULATOR_HOST || '127.0.0.1';
  connectAuthEmulator(codeBridgeAuth, `http://${host}:${Number(import.meta.env.VITE_CODE_BRIDGE_AUTH_EMULATOR_PORT || 19299)}`, { disableWarnings: true });
  connectFirestoreEmulator(codeBridgeDb, host, Number(import.meta.env.VITE_CODE_BRIDGE_FIRESTORE_EMULATOR_PORT || 8280));
}
