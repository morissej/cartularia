import type { User } from 'firebase/auth';
import type { CartulariaLocalVault, LocalStateRestoreResult } from '../persistence/localVault.ts';

const AUTH_STATE_TIMEOUT_MS = 3_000;
const CLOUD_PRIME_TIMEOUT_MS = 5_000;

export type PrivateBootstrapOutcome =
  | { status: 'ready'; reason: 'local_ready' | 'signed_out' | 'cloud_ready' }
  | { status: 'degraded'; reason: 'local_unavailable' | 'auth_unavailable' | 'cloud_unavailable'; message: string };

type PrivateAuthState =
  | { status: 'signed_in'; user: User }
  | { status: 'signed_out' }
  | { status: 'error'; error: unknown };

export interface PrivateBootstrapDependencies {
  restoreLocalState: () => Promise<{
    result: LocalStateRestoreResult;
    vault: CartulariaLocalVault | null;
  }>;
  loadCartularyContext: () => Promise<{
    activeCartularyId: string;
    iwcCartularyId: string;
  }>;
  readAuthState: (timeoutMs: number) => Promise<PrivateAuthState>;
  primeCloudState: (input: {
    uid: string;
    cartularyId: string;
    vault: CartulariaLocalVault;
    readTimeoutMs: number;
  }) => Promise<number>;
}

const defaultRestoreLocalState: PrivateBootstrapDependencies['restoreLocalState'] = async () => {
  const localVault = await import('../persistence/localVault.ts');
  return {
    result: await localVault.restoreCartulariaLocalState(),
    vault: localVault.cartulariaLocalVault,
  };
};

const defaultLoadCartularyContext: PrivateBootstrapDependencies['loadCartularyContext'] = async () => {
  const { ACTIVE_CARTULARY_ID, IWC_CARTULARY_ID } = await import('../domain/cartularyIds.ts');
  return {
    activeCartularyId: ACTIVE_CARTULARY_ID,
    iwcCartularyId: IWC_CARTULARY_ID,
  };
};

const defaultReadAuthState: PrivateBootstrapDependencies['readAuthState'] = async (timeoutMs) => {
  const [{ onAuthStateChanged }, { auth }] = await Promise.all([
    import('firebase/auth'),
    import('../firebase.ts'),
  ]);
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    const finish = (
      outcome: { status: 'signed_in'; user: User } | { status: 'signed_out' } | { status: 'error'; error: unknown },
    ) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      unsubscribe();
      resolve(outcome);
    };
    const timeout = globalThis.setTimeout(() => finish({
      status: 'error',
      error: new Error('Délai de session dépassé.'),
    }), timeoutMs);
    unsubscribe = onAuthStateChanged(
      auth,
      (user) => finish(user ? { status: 'signed_in', user } : { status: 'signed_out' }),
      (error) => finish({ status: 'error', error }),
    );
    if (settled) unsubscribe();
  });
};

const defaultPrimeCloudState: PrivateBootstrapDependencies['primeCloudState'] = async (input) => {
  const { primePrivateDraftState } = await import('../persistence/cloudDraft.ts');
  return primePrivateDraftState(input);
};

const defaultDependencies: PrivateBootstrapDependencies = {
  restoreLocalState: defaultRestoreLocalState,
  loadCartularyContext: defaultLoadCartularyContext,
  readAuthState: defaultReadAuthState,
  primeCloudState: defaultPrimeCloudState,
};

export const requiresPrivateCartularyHydration = (
  location: Pick<Location, 'pathname' | 'search'>,
) => (
  location.pathname.replace(/\/$/, '') === '/cartulary'
  && new URLSearchParams(location.search).get('data-deleted') !== '1'
);

export const runPrivateCartularyBootstrap = async (
  dependencies: PrivateBootstrapDependencies = defaultDependencies,
): Promise<PrivateBootstrapOutcome> => {
  const local = await dependencies.restoreLocalState();
  if (local.result.status === 'unavailable') {
    return {
      status: 'degraded',
      reason: 'local_unavailable',
      message: 'La restauration du coffre local n’a pas abouti. Les données présentes dans ce navigateur restent inchangées.',
    };
  }

  const context = await dependencies.loadCartularyContext();
  if (context.activeCartularyId === context.iwcCartularyId || !local.vault) {
    return { status: 'ready', reason: 'local_ready' };
  }

  let authState: PrivateAuthState;
  try {
    authState = await dependencies.readAuthState(AUTH_STATE_TIMEOUT_MS);
  } catch (error) {
    authState = { status: 'error', error };
  }
  if (authState.status === 'error') {
    return {
      status: 'degraded',
      reason: 'auth_unavailable',
      message: 'La session distante est indisponible. Le Cartulaire s’ouvre depuis le coffre local restauré.',
    };
  }
  if (authState.status === 'signed_out') return { status: 'ready', reason: 'signed_out' };

  try {
    await dependencies.primeCloudState({
      uid: authState.user.uid,
      cartularyId: context.activeCartularyId,
      vault: local.vault,
      readTimeoutMs: CLOUD_PRIME_TIMEOUT_MS,
    });
    return { status: 'ready', reason: 'cloud_ready' };
  } catch {
    return {
      status: 'degraded',
      reason: 'cloud_unavailable',
      message: 'La copie privée cloud est momentanément indisponible. Le Cartulaire s’ouvre depuis le coffre local restauré.',
    };
  }
};
