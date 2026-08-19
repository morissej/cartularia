import { readFileSync } from 'node:fs';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';

import { ApplicationBootstrap } from '../../src/bootstrap/ApplicationBootstrap.tsx';
import {
  requiresPrivateCartularyHydration,
  runPrivateCartularyBootstrap,
  type PrivateBootstrapDependencies,
  type PrivateBootstrapOutcome,
} from '../../src/bootstrap/applicationBootstrap.ts';
import type { CartulariaLocalVault } from '../../src/persistence/localVault.ts';

const ReadyPage = () => <main>Application métier montée</main>;

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
};

describe('barrière d’hydratation PF3', () => {
  it('affiche immédiatement le shell et ne monte pas le Cartulaire avant la restauration', async () => {
    const bootstrap = deferred<PrivateBootstrapOutcome>();
    render(
      <ApplicationBootstrap
        location={{ pathname: '/', search: '' }}
        bootstrap={() => bootstrap.promise}
        PageComponent={ReadyPage}
      />,
    );

    expect(screen.getByRole('status', { name: 'Restauration sécurisée de votre carnet local…' })).toBeTruthy();
    expect(screen.queryByText('Application métier montée')).toBeNull();

    bootstrap.resolve({ status: 'ready', reason: 'local_ready' });
    expect(await screen.findByText('Application métier montée')).toBeTruthy();
  });

  it('monte une route publique sans déclencher le bootstrap privé', () => {
    const bootstrap = vi.fn(async (): Promise<PrivateBootstrapOutcome> => ({ status: 'ready', reason: 'local_ready' }));
    render(
      <ApplicationBootstrap
        location={{ pathname: '/registry', search: '' }}
        bootstrap={bootstrap}
        PageComponent={ReadyPage}
      />,
    );

    expect(screen.getByText('Application métier montée')).toBeTruthy();
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it('ne réhydrate pas la page de confirmation après suppression', () => {
    const bootstrap = vi.fn(async (): Promise<PrivateBootstrapOutcome> => ({ status: 'ready', reason: 'local_ready' }));
    render(
      <ApplicationBootstrap
        location={{ pathname: '/', search: '?data-deleted=1' }}
        bootstrap={bootstrap}
        PageComponent={ReadyPage}
      />,
    );

    expect(screen.getByText('Application métier montée')).toBeTruthy();
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it('ouvre l’application avec un avertissement non bloquant en mode dégradé', async () => {
    render(
      <ApplicationBootstrap
        location={{ pathname: '/', search: '' }}
        bootstrap={async () => ({
          status: 'degraded',
          reason: 'cloud_unavailable',
          message: 'La copie privée cloud est indisponible.',
        })}
        PageComponent={ReadyPage}
      />,
    );

    expect(await screen.findByText('Application métier montée')).toBeTruthy();
    expect(screen.getByText('Démarrage en mode local')).toBeTruthy();
    expect(screen.getByText('La copie privée cloud est indisponible.')).toBeTruthy();
  });

  it('identifie uniquement la racine privée comme route à hydrater', () => {
    expect(requiresPrivateCartularyHydration({ pathname: '/', search: '' })).toBe(true);
    expect(requiresPrivateCartularyHydration({ pathname: '/', search: '?cartularyId=cart_rolex_demo' })).toBe(true);
    expect(requiresPrivateCartularyHydration({ pathname: '/', search: '?data-deleted=1' })).toBe(false);
    expect(requiresPrivateCartularyHydration({ pathname: '/watch-website', search: '' })).toBe(false);
    expect(requiresPrivateCartularyHydration({ pathname: '/cartulary-view', search: '' })).toBe(false);
    expect(requiresPrivateCartularyHydration({ pathname: '/community', search: '' })).toBe(false);
    expect(requiresPrivateCartularyHydration({ pathname: '/registry/gallery', search: '' })).toBe(false);
  });
});

describe('ordre du bootstrap privé PF3', () => {
  const vault = {} as CartulariaLocalVault;
  const user = { uid: 'owner-pf3' } as User;

  const dependencies = (overrides: Partial<PrivateBootstrapDependencies> = {}) => {
    const order: string[] = [];
    const value: PrivateBootstrapDependencies = {
      restoreLocalState: async () => {
        order.push('restore-local');
        return { result: { status: 'restored' }, vault };
      },
      loadCartularyContext: async () => {
        order.push('load-context');
        return { activeCartularyId: 'cart-private-pf3', iwcCartularyId: 'cart-iwc' };
      },
      readAuthState: async (timeoutMs) => {
        order.push(`read-auth-${timeoutMs}`);
        return { status: 'signed_in', user };
      },
      primeCloudState: async ({ readTimeoutMs }) => {
        order.push(`prime-cloud-${readTimeoutMs}`);
        return 2;
      },
      ...overrides,
    };
    return { order, value };
  };

  it('respecte strictement local puis session puis cloud', async () => {
    const setup = dependencies();
    await expect(runPrivateCartularyBootstrap(setup.value)).resolves.toEqual({ status: 'ready', reason: 'cloud_ready' });
    expect(setup.order).toEqual(['restore-local', 'load-context', 'read-auth-3000', 'prime-cloud-5000']);
  });

  it('ne consulte pas Firebase pour le Cartulaire IWC local', async () => {
    const readAuthState = vi.fn<PrivateBootstrapDependencies['readAuthState']>();
    const primeCloudState = vi.fn<PrivateBootstrapDependencies['primeCloudState']>();
    const setup = dependencies({
      loadCartularyContext: async () => ({ activeCartularyId: 'cart-iwc', iwcCartularyId: 'cart-iwc' }),
      readAuthState,
      primeCloudState,
    });

    await expect(runPrivateCartularyBootstrap(setup.value)).resolves.toEqual({ status: 'ready', reason: 'local_ready' });
    expect(readAuthState).not.toHaveBeenCalled();
    expect(primeCloudState).not.toHaveBeenCalled();
  });

  it('préserve le local et saute le cloud en cas d’échec de restauration', async () => {
    const loadCartularyContext = vi.fn<PrivateBootstrapDependencies['loadCartularyContext']>();
    const setup = dependencies({
      restoreLocalState: async () => ({ result: { status: 'unavailable', error: new Error('IndexedDB') }, vault }),
      loadCartularyContext,
    });

    const outcome = await runPrivateCartularyBootstrap(setup.value);
    expect(outcome.status).toBe('degraded');
    expect(outcome.reason).toBe('local_unavailable');
    expect(loadCartularyContext).not.toHaveBeenCalled();
  });

  it('ouvre le coffre restauré sans cloud lorsque la session est indisponible', async () => {
    const primeCloudState = vi.fn<PrivateBootstrapDependencies['primeCloudState']>();
    const setup = dependencies({
      readAuthState: async () => ({ status: 'error', error: new Error('offline') }),
      primeCloudState,
    });

    const outcome = await runPrivateCartularyBootstrap(setup.value);
    expect(outcome.status).toBe('degraded');
    expect(outcome.reason).toBe('auth_unavailable');
    expect(primeCloudState).not.toHaveBeenCalled();
  });

  it('ouvre le coffre restauré sans lecture cloud lorsque l’utilisateur est déconnecté', async () => {
    const primeCloudState = vi.fn<PrivateBootstrapDependencies['primeCloudState']>();
    const setup = dependencies({
      readAuthState: async () => ({ status: 'signed_out' }),
      primeCloudState,
    });

    await expect(runPrivateCartularyBootstrap(setup.value)).resolves.toEqual({ status: 'ready', reason: 'signed_out' });
    expect(primeCloudState).not.toHaveBeenCalled();
  });

  it('verrouille le rendu synchrone dans main.tsx', async () => {
    await waitFor(() => {
      const source = readFileSync('src/main.tsx', 'utf8');
      expect(source).toContain('<ApplicationBootstrap />');
      expect(source).not.toContain('.finally(renderApplication)');
      expect(source).not.toContain('bootstrapApplication()');
    });
  });
});
