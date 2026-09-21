import { onAuthStateChanged } from 'firebase/auth';
import { personalAuth } from './firebase';

export const PERSONAL_VAULT_IDLE_MS = 30 * 60_000;
export const PERSONAL_VAULT_HIDDEN_MS = 15 * 60_000;
export const PERSONAL_VAULT_TOKEN_REFRESH_MS = 5 * 60_000;
export type PersonalVaultLockReason = 'authentication' | 'inactivity' | 'hidden';

export const personalVaultSessionMatches = (uid: string) => personalAuth?.currentUser?.uid === uid;

/** Only the dedicated Coffre Auth instance participates in this boundary. */
export function observePersonalVaultSession({ getUid, getGeneration, isOpening, onLock }: {
  getUid: () => string | null;
  getGeneration: () => number;
  isOpening: () => boolean;
  onLock: (reason: PersonalVaultLockReason) => void;
}) {
  let subscribed = true;
  let openingUid: string | null = null;
  let openingGeneration = getGeneration();
  let lastActivity = Date.now();
  let hiddenAt: number | null = document.hidden ? Date.now() : null;
  const active = () => Boolean(getUid() || isOpening());
  const check = () => {
    if (!active()) return false;
    if (hiddenAt !== null && Date.now() - hiddenAt >= PERSONAL_VAULT_HIDDEN_MS) {
      onLock('hidden'); return true;
    }
    if (Date.now() - lastActivity >= PERSONAL_VAULT_IDLE_MS) {
      onLock('inactivity'); return true;
    }
    return false;
  };
  let refreshing = false;
  const refreshToken = () => {
    const user = personalAuth?.currentUser;
    if (!subscribed || refreshing || isOpening() || !user || getUid() !== user.uid) return;
    const generation = getGeneration();
    refreshing = true;
    void user.getIdToken(true).catch((error: unknown) => {
      const revoked = ['auth/user-disabled', 'auth/user-token-expired', 'auth/invalid-user-token', 'auth/invalid-refresh-token', 'auth/id-token-revoked', 'auth/user-not-found'].includes((error as { code?: string }).code || '');
      if (revoked && subscribed && generation === getGeneration() && getUid() === user.uid && personalAuth?.currentUser?.uid === user.uid) onLock('authentication');
    }).finally(() => { refreshing = false; });
  };
  const focus = () => { if (!check()) refreshToken(); };
  const activity = () => { if (!check()) lastActivity = Date.now(); };
  const visibility = () => {
    if (check()) return;
    hiddenAt = document.hidden ? Date.now() : null;
    if (!document.hidden) { lastActivity = Date.now(); refreshToken(); }
  };
  const events = ['pointerdown', 'keydown', 'touchstart'] as const;
  events.forEach((event) => window.addEventListener(event, activity, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('focus', focus);
  window.addEventListener('pageshow', focus);
  const timer = window.setInterval(check, 1_000);
  const tokenTimer = window.setInterval(refreshToken, PERSONAL_VAULT_TOKEN_REFRESH_MS);
  const unsubscribe = personalAuth ? onAuthStateChanged(personalAuth, (next) => {
    if (!subscribed) return;
    const uid = getUid();
    if (!isOpening() || openingGeneration !== getGeneration()) openingUid = null;
    openingGeneration = getGeneration();
    if (isOpening() && next && !openingUid) openingUid = next.uid;
    if ((isOpening() && openingUid && next?.uid !== openingUid) || (uid && uid !== next?.uid) || (!next && isOpening())) onLock('authentication');
  }, () => { if (subscribed && active()) onLock('authentication'); }) : () => {};
  return () => {
    subscribed = false;
    unsubscribe(); window.clearInterval(timer); window.clearInterval(tokenTimer);
    events.forEach((event) => window.removeEventListener(event, activity, true));
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('focus', focus);
    window.removeEventListener('pageshow', focus);
  };
}
