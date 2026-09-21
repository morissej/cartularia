import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import type { CartulariaLocalVault } from '../../src/persistence/localVault.ts';
import type { PrivateAccessState } from '../../src/security/privateCartularyAccess.ts';
const mocks = vi.hoisted(() => ({ lock: vi.fn(), legacy: vi.fn(async () => false), observe: vi.fn() }));
vi.mock('../../src/persistence/localVault.ts', () => ({ lockCartulariaLocalState: mocks.lock, hasUnscopedLocalData: mocks.legacy }));
vi.mock('../../src/security/privateCartularyAccess.ts', () => ({ observePrivateCartularyAccess: mocks.observe }));
import { ApplicationBootstrap } from '../../src/bootstrap/ApplicationBootstrap.tsx';
import PrivateCartularyGate from '../../src/bootstrap/PrivateCartularyGate.tsx';
import { requiresPrivateCartularyHydration, runPrivateCartularyBootstrap, type PrivateBootstrapDependencies, type PrivateBootstrapOutcome } from '../../src/bootstrap/applicationBootstrap.ts';
import { requestPrivateSessionLock } from '../../src/security/privateSessionEvents.ts';

const location = { pathname: '/cartulary', search: '?cartularyId=cart-private-p1' };
const ReadyPage = () => <main>Contenu confidentiel A</main>;
const ready = { status: 'ready', reason: 'cloud_ready', uid: 'owner-A', cartularyId: 'cart-private-p1' } as const;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
};
let observe: (state: PrivateAccessState) => void;
beforeEach(() => { mocks.observe.mockImplementation((_id, callback) => { observe = callback; return vi.fn(); }); });
const emit = async (state: PrivateAccessState) => { await act(async () => observe(state)); };

describe('barrière privée avant import/montage du lecteur', () => {
  it('attend droits serveur puis hydratation avant de monter les données', async () => {
    const pending = deferred<PrivateBootstrapOutcome>();
    const bootstrap = vi.fn(() => pending.promise);
    render(<PrivateCartularyGate location={location} bootstrap={bootstrap} PageComponent={ReadyPage} />);
    expect(screen.queryByText('Contenu confidentiel A')).toBeNull();
    expect(bootstrap).not.toHaveBeenCalled();
    await emit({ status: 'authorized', uid: 'owner-A' });
    expect(screen.queryByText('Contenu confidentiel A')).toBeNull();
    await act(async () => pending.resolve(ready));
    expect(await screen.findByText('Contenu confidentiel A')).toBeTruthy();
  });
  it.each(['signed-out', 'denied', 'error'] as const)('ne charge aucune donnée quand accès %s', async (status) => {
    const bootstrap = vi.fn();
    render(<PrivateCartularyGate location={location} bootstrap={bootstrap} PageComponent={ReadyPage} />);
    await emit({ status });
    expect(screen.queryByText('Contenu confidentiel A')).toBeNull();
    expect(bootstrap).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Se connecter' }).getAttribute('href')).toContain('returnTo=%2Fcartulary');
  });
  it.each(['signed-out', 'denied', 'checking'] as const)('démonte immédiatement après %s et interdit une réouverture dans le même document', async (status) => {
    render(<PrivateCartularyGate location={location} bootstrap={async () => ready} PageComponent={ReadyPage} />);
    await emit({ status: 'authorized', uid: 'owner-A' });
    expect(await screen.findByText('Contenu confidentiel A')).toBeTruthy();
    await emit({ status });
    expect(screen.queryByText('Contenu confidentiel A')).toBeNull();
    await emit({ status: 'authorized', uid: 'owner-B' });
    await emit({ status: 'authorized', uid: 'owner-A' });
    expect(screen.queryByText('Contenu confidentiel A')).toBeNull();
    expect(mocks.lock).toHaveBeenCalled();
  });
  it('ignore un bootstrap ancien après changement de compte', async () => {
    const pending = deferred<PrivateBootstrapOutcome>();
    let isCurrent!: () => boolean;
    render(<PrivateCartularyGate location={location} bootstrap={(check) => { isCurrent = check; return pending.promise; }} PageComponent={ReadyPage} />);
    await emit({ status: 'authorized', uid: 'owner-A' });
    await emit({ status: 'checking' });
    expect(isCurrent()).toBe(false);
    await act(async () => pending.resolve(ready));
    expect(screen.queryByText('Contenu confidentiel A')).toBeNull();
  });
  it('retire le lecteur dès la demande de verrouillage, même avant signOut', async () => {
    render(<PrivateCartularyGate location={location} bootstrap={async () => ready} PageComponent={ReadyPage} />);
    await emit({ status: 'authorized', uid: 'owner-A' });
    expect(await screen.findByText('Contenu confidentiel A')).toBeTruthy();
    act(() => requestPrivateSessionLock());
    expect(screen.queryByText('Contenu confidentiel A')).toBeNull();
  });
  it('reste fermé sur exception de bootstrap', async () => {
    render(<PrivateCartularyGate location={location} bootstrap={async () => { throw Error('offline'); }} PageComponent={ReadyPage} />);
    await emit({ status: 'authorized', uid: 'owner-A' });
    expect(screen.queryByText('Contenu confidentiel A')).toBeNull();
    expect(await screen.findByText('Accès privé verrouillé')).toBeTruthy();
  });
  it('préserve les routes publiques et la démonstration fictive sans bootstrap privé', () => {
    render(<ApplicationBootstrap location={{ pathname: '/cartulary-demo', search: '' }} PageComponent={ReadyPage} />);
    expect(screen.getByText('Contenu confidentiel A')).toBeTruthy();
    expect(mocks.observe).not.toHaveBeenCalled();
  });
  it('un préfixe démo inventé ne contourne pas la barrière ; aperçu local privé protégé', () => {
    expect(requiresPrivateCartularyHydration({ pathname: '/cartulary', search: '?cartularyId=cart_demo_invented' })).toBe(true);
    expect(requiresPrivateCartularyHydration({ pathname: '/cartulary', search: '?cartularyId=cart_demo_rolex_submariner_124060' })).toBe(false);
    expect(requiresPrivateCartularyHydration({ pathname: '/watch-website', search: '?preview=local' })).toBe(true);
    expect(requiresPrivateCartularyHydration({ pathname: '/watch-website', search: '?code=PUBLIC' })).toBe(false);
    expect(requiresPrivateCartularyHydration({ pathname: '/cartulary-view', search: '' })).toBe(true);
    expect(requiresPrivateCartularyHydration({ pathname: '/registry', search: '' })).toBe(false);
  });
});

describe('bootstrap identité → droits → cache → cloud', () => {
  const dependencies = (overrides: Partial<PrivateBootstrapDependencies> = {}) => {
    const order: string[] = [];
    const value: PrivateBootstrapDependencies = {
      readAuthState: async () => { order.push('auth'); return { status: 'signed_in', user: { uid: 'owner-A' } as User }; },
      loadCartularyContext: async () => { order.push('context'); return { activeCartularyId: 'cart-private-p1', iwcCartularyId: 'iwc' }; },
      authorize: async () => { order.push('rights'); },
      sessionIsCurrent: () => true,
      unlockLocalState: () => { order.push('unlock'); },
      lockLocalState: () => { order.push('lock'); },
      restoreLocalState: async () => { order.push('restore'); return { result: { status: 'restored' }, vault: {} as CartulariaLocalVault }; },
      primeCloudState: async () => { order.push('prime'); return 1; },
      ...overrides,
    };
    return { value, order };
  };
  it('ne restaure pas un seul champ avant preuve des droits', async () => {
    const setup = dependencies();
    expect(await runPrivateCartularyBootstrap(setup.value)).toEqual(ready);
    expect(setup.order).toEqual(['auth', 'context', 'rights', 'unlock', 'restore', 'prime']);
  });
  it('déconnecté : cache jamais ouvert', async () => {
    const setup = dependencies({ readAuthState: async () => ({ status: 'signed_out' }) });
    expect(await runPrivateCartularyBootstrap(setup.value)).toMatchObject({ status: 'blocked', reason: 'signed_out' });
    expect(setup.order).toEqual(['lock']);
  });
  it('hors ligne ou refus : aucune restauration locale', async () => {
    const setup = dependencies({ authorize: async () => { throw Error('offline'); } });
    expect(await runPrivateCartularyBootstrap(setup.value)).toMatchObject({ status: 'blocked', reason: 'access_denied' });
    expect(setup.order).not.toContain('unlock');
    expect(setup.order).not.toContain('restore');
  });
  it('invalide la réponse de droits après changement de session', async () => {
    const pending = deferred<void>();
    let current = true;
    const setup = dependencies({ authorize: () => pending.promise });
    const operation = runPrivateCartularyBootstrap(setup.value, () => current);
    await waitFor(() => expect(setup.order).toContain('context'));
    current = false;
    pending.resolve();
    expect(await operation).toMatchObject({ status: 'blocked', reason: 'session_changed' });
    expect(setup.order).not.toContain('unlock');
  });
  it('après droits confirmés, conserve la copie du compte si seule la copie cloud échoue', async () => {
    const setup = dependencies({ primeCloudState: async () => { throw Error('cloud offline'); } });
    expect(await runPrivateCartularyBootstrap(setup.value)).toMatchObject({ status: 'ready', uid: 'owner-A', reason: 'local_ready' });
  });
  it('un refus de droits pendant hydratation ferme le cache', async () => {
    let authorizations = 0;
    const setup = dependencies({
      authorize: async () => { if (++authorizations > 1) throw Error('revoked'); },
      primeCloudState: async () => { throw Object.assign(Error(), { code: 'permission-denied' }); },
    });
    expect(await runPrivateCartularyBootstrap(setup.value)).toMatchObject({ status: 'blocked', reason: 'access_denied' });
    expect(setup.order.at(-1)).toBe('lock');
  });
  it('ouvre un dossier autorisé sans brouillon personnel après une seconde confirmation des droits', async () => {
    const authorize = vi.fn(async () => {});
    const setup = dependencies({ authorize, primeCloudState: async () => { throw Object.assign(Error('missing draft'), { code: 'permission-denied' }); } });
    expect(await runPrivateCartularyBootstrap(setup.value)).toMatchObject({ status: 'ready', reason: 'local_ready' });
    expect(authorize).toHaveBeenCalledTimes(2);
  });
});
