// V7, décision (b) / D5 — câblage réel de /watch-website (relecture V7, F12) : le verrou textuel de tests/hygiene-v7.test.mjs fige la
// ligne `readOnlyPreview: isDemoCartulary || isWatchWebsite` d'App.tsx ; ce test rend App sur le mini-site public et observe le
// comportement (aucune écoute Firestore des rappels, aucune lecture des suivis locaux), ce qu'une régression du prédicat isWatchWebsite
// conservant la ligne ne casserait pas. Complète tests/ui/demo-follow-up-isolation.test.tsx (le hook seul, readOnlyPreview: true).
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ read: vi.fn(), persist: vi.fn(() => Promise.resolve()), observe: vi.fn(() => () => undefined) }));
vi.mock('../../src/persistence/localVault.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/persistence/localVault.ts')>();
  return { ...actual, readCartulariaStorage: mocks.read, persistCartulariaJson: mocks.persist };
});
vi.mock('../../src/services/followUp.ts', () => ({ observeCartularyFollowUpTodos: mocks.observe, createCartularyFollowUpTodo: vi.fn(), updateCartularyFollowUpTodo: vi.fn(), deleteCartularyFollowUpTodo: vi.fn() }));

describe('Mini-site public /watch-website (D5)', () => {
  it('rend App sur /watch-website?publicCode=… sans ouvrir l’écoute des rappels ni lire les suivis locaux', async () => {
    window.history.replaceState({}, '', '/watch-website?publicCode=DEMO-ROL-124060');
    const { default: App } = await import('../../src/App');
    render(<App />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.observe).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalledWith('cartularia-todos');
    expect(mocks.read).not.toHaveBeenCalledWith('cartularia-todos-pending-v1');
    expect(document.body.textContent?.length).toBeGreaterThan(0);
  });
});
