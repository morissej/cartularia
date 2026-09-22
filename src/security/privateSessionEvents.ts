/** Synchronous notification: private readers close before a remote sign-out completes. */
export const PRIVATE_SESSION_LOCK_EVENT = 'cartularia:private-session-lock';

export function requestPrivateSessionLock() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PRIVATE_SESSION_LOCK_EVENT));
}
