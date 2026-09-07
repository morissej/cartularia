import { getApps, initializeApp } from 'firebase/app';
import { getToken, initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';

const projectId = (import.meta.env.VITE_PERSONAL_RECOVERY_FUNCTIONS_PROJECT_ID || import.meta.env.VITE_FIREBASE_PROJECT_ID || '').trim();
const region = (import.meta.env.VITE_PERSONAL_RECOVERY_FUNCTIONS_REGION || 'us-central1').trim();
const emulatorMode = import.meta.env.VITE_PERSONAL_USE_FIREBASE_EMULATORS === 'true';
const siteKey = (import.meta.env.VITE_PERSONAL_RECOVERY_APP_CHECK_SITE_KEY || import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY || '').trim();
const name = 'cartularia-personal-recovery-transport';
// This transport has no Firebase Auth instance and never reuses a Registry session.
const transportApp = projectId && siteKey && !emulatorMode
  ? getApps().find((app) => app.name === name) || initializeApp({
    projectId,
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  }, name)
  : null;
const appCheck = transportApp ? initializeAppCheck(transportApp, {
  provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true,
}) : null;

export const callPersonalRecovery = async <Response,>(command: string, data: object): Promise<Response> => {
  if (!/^[a-z][a-zA-Z]+$/.test(command) || !/^[a-z0-9-]+$/.test(projectId) || !/^[a-z0-9-]+$/.test(region)) throw new Error('Service de secours indisponible.');
  const origin = emulatorMode
    ? `http://${import.meta.env.VITE_FIREBASE_EMULATOR_HOST || '127.0.0.1'}:${import.meta.env.VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT || '5001'}/${projectId}/${region}`
    : `https://${region}-${projectId}.cloudfunctions.net`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // These recovery endpoints authorize with signatures/recent dedicated sessions.
  // App Check is additional telemetry here; its outage must not strand a valid kit.
  if (appCheck) {
    try { headers['X-Firebase-AppCheck'] = (await getToken(appCheck)).token; }
    catch { /* No token, credential or provider error is logged. */ }
  }
  const response = await fetch(`${origin}/${command}`, {
    method: 'POST', headers, credentials: 'omit', body: JSON.stringify({ data }),
  });
  const result = await response.json() as { result?: Response; data?: Response; error?: { status?: string; message?: string } };
  if (!response.ok || result.error) {
    const code = String(result.error?.status || 'unavailable').toLocaleLowerCase('en').replaceAll('_', '-');
    throw Object.assign(new Error('Opération de secours non confirmée.'), { code: `functions/${code}` });
  }
  if (!('result' in result) && !('data' in result)) throw new Error('Réponse de secours invalide.');
  return (result.result ?? result.data) as Response;
};
