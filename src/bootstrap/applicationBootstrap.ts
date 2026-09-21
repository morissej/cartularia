import type { User } from 'firebase/auth';
import type { CartulariaLocalVault, LocalStateRestoreResult } from '../persistence/localVault.ts';
import { isDemoCartularyId } from '../data/demoCartularies.ts';

const AUTH_STATE_TIMEOUT_MS = 3_000;
const CLOUD_PRIME_TIMEOUT_MS = 5_000;
// Migration datée (ADR-029) : la consolidation du dossier IWC du 29/08/2026 l'emporte une fois sur
// la copie locale. Ce n'est pas une branche de présentation ; ne pas l'étendre à d'autres marques.
const IWC_AUTHORITATIVE_HYDRATION_ID = 'iwc-source-dossier-2026-08-29-v1';
const IWC_AUTHORITATIVE_STATE_KEYS = [
  'cartularia-specification-groups',
  'cartularia-identification-checks',
  'cartularia-condition-entries',
  'cartularia-documentation-items',
  'cartularia-owner-documents',
  'cartularia-editable-copy',
  'cartularia-media-assets-v3',
  'cartularia-market-depth',
  'cartularia-market-history',
  'cartularia-comparables',
  'cartularia-comparable-analysis',
  'cartularia-retained-valuation',
  'cartularia-purchase',
  'cartularia-purchase-expenses',
  'cartularia-exit-assumptions',
] as const;

export type PrivateBootstrapOutcome =
  | { status: 'ready'; reason: 'local_ready' | 'cloud_ready'; uid: string; cartularyId: string; message?: string }
  | { status: 'blocked'; reason: 'signed_out' | 'access_denied' | 'local_unavailable' | 'auth_unavailable' | 'session_changed'; message: string };

type PrivateAuthState =
  | { status: 'signed_in'; user: User }
  | { status: 'signed_out' }
  | { status: 'error'; error: unknown };

export interface PrivateBootstrapDependencies {
  restoreLocalState: () => Promise<{ result: LocalStateRestoreResult; vault: CartulariaLocalVault | null }>;
  unlockLocalState: (identity: { uid: string; cartularyId: string }) => Promise<unknown> | unknown;
  lockLocalState: () => void;
  authorize: (uid: string, cartularyId: string) => Promise<void>;
  sessionIsCurrent: (uid: string) => boolean;
  loadCartularyContext: () => Promise<{ activeCartularyId: string; iwcCartularyId: string }>;
  readAuthState: (timeoutMs: number) => Promise<PrivateAuthState>;
  primeCloudState: (input: {
    uid: string;
    cartularyId: string;
    vault: CartulariaLocalVault;
    readTimeoutMs: number;
    authoritativeHydration?: { id: string; stateKeys: readonly string[] };
  }) => Promise<number>;
}

let currentUid: (() => string | undefined) = () => undefined;
let localModule: typeof import('../persistence/localVault.ts') | undefined;
const defaultDependencies: PrivateBootstrapDependencies = {
  restoreLocalState: async () => {
    const local = await import('../persistence/localVault.ts');
    return { result: await local.restoreCartulariaLocalState(), vault: local.cartulariaLocalVault };
  },
  unlockLocalState: (identity) => {
    if (!localModule) throw new Error('Stockage privé non initialisé');
    return localModule.unlockCartulariaLocalState(identity);
  },
  lockLocalState: () => localModule?.lockCartulariaLocalState(),
  loadCartularyContext: async () => {
    const { ACTIVE_CARTULARY_ID, IWC_CARTULARY_ID } = await import('../domain/cartularyIds.ts');
    return { activeCartularyId: ACTIVE_CARTULARY_ID, iwcCartularyId: IWC_CARTULARY_ID };
  },
  readAuthState: async (timeoutMs) => {
    const [{ onAuthStateChanged }, { auth }, local] = await Promise.all([import('firebase/auth'), import('../firebase.ts'), import('../persistence/localVault.ts')]);
    localModule = local;
    currentUid = () => auth.currentUser?.uid;
    return new Promise((resolve) => {
      let settled = false;
      let unsubscribe = () => {};
      const finish = (state: PrivateAuthState) => {
        if (settled) return;
        settled = true; clearTimeout(timeout); unsubscribe(); resolve(state);
      };
      const timeout = setTimeout(() => finish({ status: 'error', error: new Error('Session indisponible') }), timeoutMs);
      unsubscribe = onAuthStateChanged(auth,
        (user) => finish(user ? { status: 'signed_in', user } : { status: 'signed_out' }),
        (error) => finish({ status: 'error', error }));
      if (settled) unsubscribe();
    });
  },
  sessionIsCurrent: (uid) => currentUid() === uid,
  authorize: async (uid, cartularyId) => {
    const [{ doc, getDocFromServer }, { db }] = await Promise.all([import('firebase/firestore'), import('../firebase.ts')]);
    const [account, cartulary] = await Promise.all([
      getDocFromServer(doc(db, 'users', uid)),
      getDocFromServer(doc(db, 'cartularies', cartularyId)),
    ]);
    if (account.metadata.fromCache || account.metadata.hasPendingWrites
      || cartulary.metadata.fromCache || cartulary.metadata.hasPendingWrites
      || !account.exists() || account.data().status !== 'active' || !cartulary.exists()) throw new Error('Accès refusé');
  },
  primeCloudState: async (input) => (await import('../persistence/cloudDraft.ts')).primePrivateDraftState(input),
};

export const requiresPrivateCartularyHydration = (location: Pick<Location, 'pathname' | 'search'>) => {
  const parameters = new URLSearchParams(location.search);
  const pathname = location.pathname.replace(/\/$/, '');
  // Known demos are identified by their catalogue, never by an arbitrary ID prefix.
  return parameters.get('data-deleted') !== '1'
    && !isDemoCartularyId(parameters.get('cartularyId') || '')
    && (pathname === '/cartulary' || pathname === '/cartulary-view'
      || (pathname === '/watch-website' && parameters.get('preview') === 'local'));
};

export const runPrivateCartularyBootstrap = async (
  dependencies: PrivateBootstrapDependencies = defaultDependencies,
  isCurrent: () => boolean = () => true,
): Promise<PrivateBootstrapOutcome> => {
  const blocked = (reason: Extract<PrivateBootstrapOutcome, { status: 'blocked' }>['reason'], message: string): PrivateBootstrapOutcome => {
    // The owning gate locks synchronously; an obsolete bootstrap must not lock a newer scope.
    if (isCurrent()) dependencies.lockLocalState();
    return { status: 'blocked', reason, message };
  };
  const changed = () => blocked('session_changed', 'La session a changé. Rouvrez ce Cartulaire pour confirmer vos droits.');
  let authState: PrivateAuthState;
  try { authState = await dependencies.readAuthState(AUTH_STATE_TIMEOUT_MS); }
  catch (error) { authState = { status: 'error', error }; }
  if (!isCurrent()) return changed();
  if (authState.status === 'error') return blocked('auth_unavailable', 'La session ne peut pas être vérifiée. Vos brouillons restent conservés sur cet appareil.');
  if (authState.status === 'signed_out') return blocked('signed_out', 'Connectez-vous pour ouvrir ce Cartulaire privé.');
  const uid = authState.user.uid;
  const current = () => isCurrent() && dependencies.sessionIsCurrent(uid);
  const context = await dependencies.loadCartularyContext();
  if (!current()) return changed();
  try { await dependencies.authorize(uid, context.activeCartularyId); }
  catch { return blocked('access_denied', 'Les droits d’accès ne peuvent pas être confirmés. Aucune donnée privée n’est affichée.'); }
  if (!current()) return changed();
  await dependencies.unlockLocalState({ uid, cartularyId: context.activeCartularyId });
  if (!current()) return changed();
  const local = await dependencies.restoreLocalState();
  if (!current()) return changed();
  if (!local.vault || local.result.status === 'unavailable') {
    return blocked('local_unavailable', 'Le stockage local est indisponible. Les brouillons existants sont conservés.');
  }
  try {
    await dependencies.primeCloudState({
      uid, cartularyId: context.activeCartularyId, vault: local.vault,
      readTimeoutMs: CLOUD_PRIME_TIMEOUT_MS,
      authoritativeHydration: context.activeCartularyId === context.iwcCartularyId
        ? { id: IWC_AUTHORITATIVE_HYDRATION_ID, stateKeys: IWC_AUTHORITATIVE_STATE_KEYS } : undefined,
    });
    if (!current()) return changed();
    return { status: 'ready', reason: 'cloud_ready', uid, cartularyId: context.activeCartularyId };
  } catch (error) {
    if (!current()) return changed();
    if ((error as { code?: string }).code === 'permission-denied') {
      // An invited reader (or an imported dossier) may have no private draft of their own.
      // Reconfirm the dossier permission rather than treating draft absence as revocation.
      try { await dependencies.authorize(uid, context.activeCartularyId); }
      catch { return blocked('access_denied', 'Les droits d’accès ont changé. Rouvrez le Cartulaire.'); }
      if (!current()) return changed();
      return { status: 'ready', reason: 'local_ready', uid, cartularyId: context.activeCartularyId,
        message: 'L’accès au dossier a été confirmé. Aucun brouillon privé distant n’est disponible pour cette session.' };
    }
    return { status: 'ready', reason: 'local_ready', uid, cartularyId: context.activeCartularyId,
      message: 'Vos droits ont été confirmés. La copie cloud est indisponible ; seuls vos brouillons sur cet appareil sont chargés.' };
  }
};
