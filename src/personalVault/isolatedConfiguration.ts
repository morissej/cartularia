type ConfigurationEnvironment = Record<string, string | boolean | undefined>;

export interface IsolatedFirebaseConfiguration {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
}

const value = (environment: ConfigurationEnvironment, name: string) => typeof environment[name] === 'string'
  ? (environment[name] as string).trim()
  : '';

/** No production fallback: an incomplete or shared configuration opens no session. */
export const resolveIsolatedVaultConfiguration = (environment: ConfigurationEnvironment) => {
  const emulatorMode = value(environment, 'VITE_PERSONAL_USE_FIREBASE_EMULATORS') === 'true';
  const registryProjectId = value(environment, 'VITE_REGISTRY_FIREBASE_PROJECT_ID')
    || value(environment, 'VITE_FIREBASE_PROJECT_ID')
    || 'studio-2614005370-a3e51';
  const read = (prefix: string, localProject: string): IsolatedFirebaseConfiguration | null => {
    const projectId = value(environment, `${prefix}_PROJECT_ID`);
    const apiKey = value(environment, `${prefix}_API_KEY`);
    const authDomain = value(environment, `${prefix}_AUTH_DOMAIN`);
    const appId = value(environment, `${prefix}_APP_ID`);
    if (projectId && apiKey && authDomain && appId) return {
      projectId, apiKey, authDomain, appId,
      storageBucket: value(environment, `${prefix}_STORAGE_BUCKET`) || undefined,
      messagingSenderId: value(environment, `${prefix}_MESSAGING_SENDER_ID`) || undefined,
    };
    // Local defaults are deliberately limited to an explicitly selected emulator mode.
    if (emulatorMode && !projectId && !apiKey && !authDomain && !appId) return {
      projectId: localProject,
      apiKey: `${localProject}-api-key`,
      authDomain: `${localProject}.firebaseapp.com`,
      appId: `1:000000000000:web:${localProject}`,
    };
    return null;
  };
  const personal = read('VITE_PERSONAL_FIREBASE', 'cartularia-personal-vault-local');
  const bridge = read('VITE_CODE_BRIDGE_FIREBASE', 'cartularia-code-bridge-local');
  const distinct = personal && bridge
    && new Set([registryProjectId, personal.projectId, bridge.projectId]).size === 3;
  return {
    emulatorMode,
    personal: distinct ? personal : null,
    bridge: distinct ? bridge : null,
    available: Boolean(distinct),
    reason: !personal || !bridge ? 'missing-configuration' : distinct ? null : 'shared-project',
  } as const;
};
