import {
  EmailAuthProvider,
  getIdTokenResult,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import { requestPrivateSessionLock } from './privateSessionEvents.ts';
import { isDemoCartularyId } from '../data/demoCartularies.ts';

export const SESSION_IDLE_TIMEOUT_MS = 30 * 60_000;
export const SESSION_HIDDEN_TIMEOUT_MS = 15 * 60_000;
export const SESSION_CHECK_INTERVAL_MS = 30_000;
export const STEP_UP_MAX_AGE_MS = 5 * 60_000;
export const SESSION_LOCK_STORAGE_KEY = 'cartularia-session-lock-v1';
const SESSION_LOCK_SCREEN_ID = 'cartularia-session-lock-screen';

export type SessionLockReason = 'idle' | 'hidden' | null;

export const sessionLockReason = ({
  now,
  lastActivityAt,
  hiddenAt,
  idleTimeoutMs = SESSION_IDLE_TIMEOUT_MS,
  hiddenTimeoutMs = SESSION_HIDDEN_TIMEOUT_MS,
}: {
  now: number;
  lastActivityAt: number;
  hiddenAt: number | null;
  idleTimeoutMs?: number;
  hiddenTimeoutMs?: number;
}): SessionLockReason => {
  if (hiddenAt !== null && now - hiddenAt >= hiddenTimeoutMs) return 'hidden';
  if (now - lastActivityAt >= idleTimeoutMs) return 'idle';
  return null;
};

export const authenticationIsRecent = (
  authTime: string | undefined,
  now = Date.now(),
  maxAgeMs = STEP_UP_MAX_AGE_MS,
) => {
  if (!authTime) return false;
  const authenticatedAt = Date.parse(authTime);
  return Number.isFinite(authenticatedAt)
    && now >= authenticatedAt
    && now - authenticatedAt <= maxAgeMs;
};

export const userAuthenticationIsRecent = async (
  user: User,
  maxAgeMs = STEP_UP_MAX_AGE_MS,
) => {
  const token = await getIdTokenResult(user);
  return authenticationIsRecent(token.authTime, Date.now(), maxAgeMs);
};

export const reauthenticatePasswordUser = async (user: User, password: string) => {
  if (!user.email || !user.providerData.some((provider) => provider.providerId === 'password')) {
    throw new Error('password_reauthentication_unavailable');
  }
  const credential = EmailAuthProvider.credential(user.email, password);
  await reauthenticateWithCredential(user, credential);
  await user.getIdToken(true);
};

export interface SessionLockOptions {
  idleTimeoutMs?: number;
  hiddenTimeoutMs?: number;
  checkIntervalMs?: number;
  now?: () => number;
}

const readLockMarker = () => {
  try {
    return window.localStorage.getItem(SESSION_LOCK_STORAGE_KEY) === 'locked';
  } catch {
    return false;
  }
};

const writeLockMarker = (locked: boolean) => {
  try {
    if (locked) window.localStorage.setItem(SESSION_LOCK_STORAGE_KEY, 'locked');
    else window.localStorage.removeItem(SESSION_LOCK_STORAGE_KEY);
  } catch {
    // A storage-disabled browser still receives the in-memory lock screen.
  }
};

export const clearSessionLockAfterAuthentication = () => {
  document.getElementById(SESSION_LOCK_SCREEN_ID)?.remove();
  writeLockMarker(false);
};

const showSessionLockScreen = () => {
  writeLockMarker(true);
  requestPrivateSessionLock();
  const pathname = window.location.pathname.replace(/\/$/, '');
  const parameters = new URLSearchParams(window.location.search);
  const privateRoute = pathname === '/cartulary' || pathname === '/cartulary-view'
    || pathname === '/registry' || pathname.startsWith('/registry/') || pathname === '/administration'
    || (pathname === '/watch-website' && parameters.get('preview') === 'local');
  if (!privateRoute || isDemoCartularyId(parameters.get('cartularyId') || '') || document.getElementById(SESSION_LOCK_SCREEN_ID)) return;

  const overlay = document.createElement('div');
  overlay.id = SESSION_LOCK_SCREEN_ID;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'cartularia-session-lock-title');
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483647',
    'display:grid',
    'place-items:center',
    'padding:24px',
    'background:#1a1815',
    'color:#f7f3eb',
    'font-family:system-ui,sans-serif',
  ].join(';');

  const panel = document.createElement('section');
  panel.style.cssText = 'width:min(520px,100%);display:grid;gap:16px;padding:32px;border:1px solid #d7cdbd;background:#24211d';
  const eyebrow = document.createElement('span');
  eyebrow.textContent = 'CARTULARIA · SÉCURITÉ';
  eyebrow.style.cssText = 'font-size:11px;letter-spacing:.12em;color:#d7cdbd';
  const title = document.createElement('h1');
  title.id = 'cartularia-session-lock-title';
  title.textContent = 'Session verrouillée';
  title.style.cssText = 'margin:0;font:600 28px/1.2 Georgia,serif';
  const explanation = document.createElement('p');
  explanation.textContent = 'Votre session privée a été verrouillée après une période d’inactivité. Les brouillons déjà enregistrés sur cet appareil sont conservés.';
  explanation.style.cssText = 'margin:0;color:#d7cdbd;line-height:1.55';
  const link = document.createElement('a');
  link.href = `/account/sign-in?returnTo=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`;
  link.textContent = 'Se reconnecter';
  link.style.cssText = 'justify-self:start;padding:10px 16px;background:#f7f3eb;color:#1a1815;text-decoration:none;font-weight:700';
  panel.append(eyebrow, title, explanation, link);
  overlay.append(panel);
  document.body.append(overlay);
  link.focus({ preventScroll: true });
};

export const installSessionLock = (auth: Auth, options: SessionLockOptions = {}) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;

  const idleTimeoutMs = options.idleTimeoutMs ?? SESSION_IDLE_TIMEOUT_MS;
  const hiddenTimeoutMs = options.hiddenTimeoutMs ?? SESSION_HIDDEN_TIMEOUT_MS;
  const checkIntervalMs = options.checkIntervalMs ?? SESSION_CHECK_INTERVAL_MS;
  const now = options.now ?? Date.now;
  let lastActivityAt = now();
  let hiddenAt = document.visibilityState === 'hidden' ? now() : null;
  let locking = false;

  const markActivity = () => {
    if (document.visibilityState !== 'visible') return;
    if (sessionLockReason({ now: now(), lastActivityAt, hiddenAt, idleTimeoutMs, hiddenTimeoutMs })) {
      void lockIfNeeded().catch(() => false);
    } else lastActivityAt = now();
  };

  const lockIfNeeded = async () => {
    if (locking || !auth.currentUser) return false;
    const reason = sessionLockReason({
      now: now(),
      lastActivityAt,
      hiddenAt,
      idleTimeoutMs,
      hiddenTimeoutMs,
    });
    if (!reason) return false;
    locking = true;
    showSessionLockScreen();
    try {
      await signOut(auth);
      return true;
    } finally {
      // A failed remote sign-out must never reopen local private data.
      locking = false;
    }
  };

  const handleVisibility = () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = now();
      return;
    }
    void lockIfNeeded().catch(() => false).finally(() => {
      hiddenAt = null;
      lastActivityAt = now();
    });
  };

  const activityEvents: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart', 'focus'];
  activityEvents.forEach((eventName) => window.addEventListener(eventName, markActivity, { passive: true }));
  document.addEventListener('visibilitychange', handleVisibility);
  const interval = window.setInterval(() => void lockIfNeeded().catch(() => false), checkIntervalMs);
  const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
    if (user) {
      if (readLockMarker()) { showSessionLockScreen(); return; }
      lastActivityAt = now();
      hiddenAt = document.visibilityState === 'hidden' ? now() : null;
    } else if (readLockMarker()) {
      showSessionLockScreen();
    }
  });

  if (readLockMarker()) showSessionLockScreen();

  return () => {
    window.clearInterval(interval);
    unsubscribeAuth();
    activityEvents.forEach((eventName) => window.removeEventListener(eventName, markActivity));
    document.removeEventListener('visibilitychange', handleVisibility);
  };
};
