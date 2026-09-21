import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebase.ts';
import { SESSION_LOCK_STORAGE_KEY } from './sessionSecurity.ts';

export type PrivateAccessState =
  | { status: 'checking' | 'signed-out' | 'denied' | 'error' }
  | { status: 'authorized'; uid: string };

/** Only confirmed server snapshots grant access; cached/optimistic documents never unlock a session. */
export function observePrivateCartularyAccess(cartularyId: string, observer: (state: PrivateAccessState) => void) {
  let active = true;
  let generation = 0;
  let stops: Array<() => void> = [];
  let timeout: ReturnType<typeof setTimeout>;
  let refreshing = false;
  const clearWatches = () => {
    stops.forEach((stop) => stop());
    stops = [];
    clearTimeout(timeout);
  };
  const timedOut = () => { if (active) observer({ status: 'error' }); };
  timeout = setTimeout(timedOut, 10_000);
  const unsubscribe = onAuthStateChanged(auth, (user) => {
    const epoch = ++generation;
    clearWatches();
    if (!active) return;
    observer({ status: user ? 'checking' : 'signed-out' });
    if (!user) return;
    if (window.localStorage.getItem(SESSION_LOCK_STORAGE_KEY) === 'locked') {
      observer({ status: 'signed-out' });
      return;
    }
    let accountAllowed = false;
    let dossierAllowed = false;
    let emitted = false;
    let denied = false;
    const current = () => active && epoch === generation && auth.currentUser?.uid === user.uid;
    const fail = (error?: { code?: string }) => {
      if (!current()) return;
      denied = true;
      clearTimeout(timeout);
      observer({ status: !error || error.code === 'permission-denied' ? 'denied' : 'error' });
    };
    const grant = () => {
      if (!current() || denied || emitted || !accountAllowed || !dossierAllowed) return;
      emitted = true;
      clearTimeout(timeout);
      observer({ status: 'authorized', uid: user.uid });
    };
    timeout = setTimeout(timedOut, 10_000);
    stops.push(onSnapshot(doc(db, 'users', user.uid), { includeMetadataChanges: true }, (snapshot) => {
      if (!current() || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      if (!snapshot.exists() || snapshot.data().status !== 'active') { fail(); return; }
      accountAllowed = true;
      grant();
    }, fail));
    stops.push(onSnapshot(doc(db, 'cartularies', cartularyId), { includeMetadataChanges: true }, (snapshot) => {
      if (!current() || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      if (!snapshot.exists()) { fail(); return; }
      dossierAllowed = true;
      grant();
    }, fail));
  }, () => { if (active) observer({ status: 'error' }); });

  // Token revocation is otherwise only discovered at the SDK's next refresh.
  const checkToken = async () => {
    if (!active || refreshing || document.visibilityState === 'hidden' || !auth.currentUser) return;
    const epoch = generation;
    const user = auth.currentUser;
    refreshing = true;
    try { await user.getIdToken(true); }
    catch (error) {
      const code = (error as { code?: string }).code;
      if (active && epoch === generation && ['auth/user-disabled', 'auth/user-token-expired', 'auth/invalid-user-token'].includes(code || '')) {
        observer({ status: 'denied' });
      }
    } finally { refreshing = false; }
  };
  const onFocus = () => { void checkToken(); };
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onFocus);
  const interval = setInterval(onFocus, 5 * 60_000);
  return () => {
    active = false;
    generation += 1;
    unsubscribe();
    clearWatches();
    clearInterval(interval);
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onFocus);
  };
}
