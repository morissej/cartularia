// V7 (V-B2, D10) : préchargement du Registre depuis la page de connexion — planification à l'inactivité (1,5 à 2,5 s après le premier
// rendu), annulation au démontage, une seule planification par affichage, garde sur la destination, et modules visés (RegistryApp,
// RegistryItems : mockés, jamais chargés pour de vrai — ils tireraient firebase.ts dans jsdom, M9 de la critique de cohérence).
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const registry = vi.hoisted(() => ({ imported: [] as string[], loads: [] as ReturnType<typeof vi.fn>[], cancels: [] as ReturnType<typeof vi.fn>[] }));
vi.mock('../../src/services/foundations', () => ({
  createCartulariaAccount: vi.fn(), signInToCartularia: vi.fn(), resumeRegistryAccountActivation: vi.fn(),
}));
vi.mock('../../src/features/registry/RegistryApp.tsx', () => { registry.imported.push('RegistryApp'); return { RegistryApp: () => null }; });
vi.mock('../../src/features/registry/RegistryItems.tsx', () => { registry.imported.push('RegistryItems'); return { RegistryItems: () => null }; });
vi.mock('../../src/features/public/registryPreload.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/features/public/registryPreload.ts')>();
  return {
    ...actual,
    // Enveloppe transparente : la vraie planification tourne (vrais délais, vrai chargement par défaut), mais l'appel, le chargement
    // et la fonction d'annulation rendue deviennent observables.
    scheduleRegistryPreload: vi.fn((load?: () => unknown) => {
      const observedLoad = vi.fn(load ?? actual.loadRegistrySurface);
      registry.loads.push(observedLoad);
      const cancel = vi.fn(actual.scheduleRegistryPreload(observedLoad));
      registry.cancels.push(cancel);
      return cancel;
    }),
  };
});
import { AccountAccessPage } from '../../src/features/public/AccountAccessPage';
import { REGISTRY_PRELOAD_DELAY_MS, REGISTRY_PRELOAD_IDLE_TIMEOUT_MS, loadRegistrySurface, scheduleRegistryPreload } from '../../src/features/public/registryPreload.ts';

type IdleWindow = Window & { requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number; cancelIdleCallback?: (handle: number) => void };
const idleWindow = window as IdleWindow;

describe('registryPreload : planification à l’inactivité', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); delete idleWindow.requestIdleCallback; delete idleWindow.cancelIdleCallback; });

  it('fixe la fenêtre D10 : 1 500 ms d’inactivité puis au plus 1 000 ms (2,5 s après le rendu au plus tard)', () => {
    expect(REGISTRY_PRELOAD_DELAY_MS).toBe(1500);
    expect(REGISTRY_PRELOAD_IDLE_TIMEOUT_MS).toBe(1000);
    expect(REGISTRY_PRELOAD_DELAY_MS + REGISTRY_PRELOAD_IDLE_TIMEOUT_MS).toBe(2500);
  });

  it('sans requestIdleCallback (Safari, jsdom) : charge exactement une fois, à 1 500 ms, pas avant', () => {
    expect(typeof idleWindow.requestIdleCallback).toBe('undefined');
    const load = vi.fn();
    scheduleRegistryPreload(load);
    vi.advanceTimersByTime(REGISTRY_PRELOAD_DELAY_MS - 1);
    expect(load).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('avec requestIdleCallback : attend 1 500 ms puis la période d’inactivité (délai maximal 1 000 ms), charge une seule fois', () => {
    const callbacks: IdleRequestCallback[] = [];
    idleWindow.requestIdleCallback = vi.fn((callback: IdleRequestCallback) => { callbacks.push(callback); return 7; });
    idleWindow.cancelIdleCallback = vi.fn();
    const load = vi.fn();
    scheduleRegistryPreload(load);
    vi.advanceTimersByTime(REGISTRY_PRELOAD_DELAY_MS - 1);
    expect(idleWindow.requestIdleCallback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(idleWindow.requestIdleCallback).toHaveBeenCalledTimes(1);
    expect(idleWindow.requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: REGISTRY_PRELOAD_IDLE_TIMEOUT_MS });
    expect(load).not.toHaveBeenCalled();
    callbacks[0]({ didTimeout: false, timeRemaining: () => 50 });
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(idleWindow.requestIdleCallback).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('annulé avant l’échéance : rien ne part, même longtemps après', () => {
    const load = vi.fn();
    const cancel = scheduleRegistryPreload(load);
    vi.advanceTimersByTime(1000);
    cancel();
    vi.advanceTimersByTime(60_000);
    expect(load).not.toHaveBeenCalled();
  });

  it('annulé entre le délai et la période d’inactivité : cancelIdleCallback reçoit la poignée rendue', () => {
    idleWindow.requestIdleCallback = vi.fn(() => 42);
    idleWindow.cancelIdleCallback = vi.fn();
    const load = vi.fn();
    const cancel = scheduleRegistryPreload(load);
    vi.advanceTimersByTime(REGISTRY_PRELOAD_DELAY_MS);
    expect(idleWindow.requestIdleCallback).toHaveBeenCalledTimes(1);
    cancel();
    expect(idleWindow.cancelIdleCallback).toHaveBeenCalledWith(42);
    expect(load).not.toHaveBeenCalled();
  });

  it('loadRegistrySurface importe RegistryApp et RegistryItems (mêmes modules que RootPage / RegistryApp) et ne rejette jamais', async () => {
    vi.useRealTimers();
    expect(registry.imported).toEqual([]);
    const results = await loadRegistrySurface();
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    const [app, items] = results as PromiseFulfilledResult<Record<string, unknown>>[];
    expect(typeof app.value.RegistryApp).toBe('function');
    expect(typeof items.value.RegistryItems).toBe('function');
    expect([...registry.imported].sort()).toEqual(['RegistryApp', 'RegistryItems']);
  });
});

describe('AccountAccessPage : câblage du préchargement', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    registry.loads.length = 0;
    registry.cancels.length = 0;
    vi.mocked(scheduleRegistryPreload).mockClear();
    window.history.replaceState({}, '', '/account/sign-in');
  });
  afterEach(() => { vi.useRealTimers(); });

  it.each([
    ['/account/sign-in', 'connexion ordinaire (returnTo par défaut : /registry)'],
    ['/account/sign-in?demo=1', 'demande de démo'],
    ['/account/sign-in?returnTo=%2Fregistry%2Freg_test%2Fitems%3Fview%3Dgallery', 'returnTo vers une section du Registre'],
  ])('%s (%s) : planifie une fois au premier rendu, charge à l’inactivité, une seule fois, puis annule au démontage', (location) => {
    window.history.replaceState({}, '', location);
    const { rerender, unmount } = render(<AccountAccessPage />);
    expect(scheduleRegistryPreload).toHaveBeenCalledTimes(1);
    expect(scheduleRegistryPreload).toHaveBeenCalledWith();
    rerender(<AccountAccessPage />);
    expect(scheduleRegistryPreload).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(REGISTRY_PRELOAD_DELAY_MS - 1); });
    expect(registry.loads[0]).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(registry.loads[0]).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(registry.loads[0]).toHaveBeenCalledTimes(1);
    expect(registry.cancels[0]).not.toHaveBeenCalled();
    unmount();
    expect(registry.cancels[0]).toHaveBeenCalledTimes(1);
  });

  it('démontage avant l’échéance : le chargement n’a jamais lieu', () => {
    const { unmount } = render(<AccountAccessPage />);
    act(() => { vi.advanceTimersByTime(REGISTRY_PRELOAD_DELAY_MS - 1); });
    unmount();
    expect(registry.cancels[0]).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(registry.loads[0]).not.toHaveBeenCalled();
  });

  it.each([
    ['/account/create', 'création (cible /account/security)'],
    ['/account/sign-in?space=vault', 'Coffre personnel (redirigé)'],
    ['/account/sign-in?returnTo=%2Faccount%2Fsecurity', 'returnTo hors du Registre'],
    ['/account/sign-in?returnTo=%2Fcartulary%3FcartularyId%3Dcart_x', 'returnTo vers un Cartulaire'],
  ])('%s (%s) : ne planifie rien', (location) => {
    window.history.replaceState({}, '', location);
    // Le cas du Coffre appelle window.location.replace : jsdom n'implémente pas cette navigation et le signale sur sa console virtuelle
    // (« Not implemented: navigation to another Document »), sans effet sur le test ; le signalement est suspendu le temps du rendu.
    const virtualConsole = (window as unknown as { _virtualConsole?: { rawListeners: (event: string) => ((...args: unknown[]) => void)[]; removeAllListeners: (event: string) => void; on: (event: string, listener: (...args: unknown[]) => void) => void } })._virtualConsole;
    const reporters = virtualConsole?.rawListeners('jsdomError') ?? [];
    virtualConsole?.removeAllListeners('jsdomError');
    try {
      render(<AccountAccessPage />);
      act(() => { vi.advanceTimersByTime(60_000); });
    } finally {
      for (const reporter of reporters) virtualConsole?.on('jsdomError', reporter);
    }
    expect(scheduleRegistryPreload).not.toHaveBeenCalled();
    expect(registry.loads).toEqual([]);
  });
});
