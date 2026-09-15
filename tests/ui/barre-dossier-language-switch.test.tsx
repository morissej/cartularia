import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BarreDossier } from '../../src/components/BarreDossier.tsx';
import type { CartularyFollowUpController } from '../../src/features/cartulary/state/useCartularyFollowUp.ts';

/**
 * V6 (V-D9, D1 (a), D2 retrait pur) : la bascule FR/EN de la barre est retirée tant que la traduction du Cartulaire
 * est partielle (144 nœuds FR sur 587 en mode EN, mesuré). La barre reste traduisible par sa prop `language`
 * (parité dormante, remise en service par `git revert`) : aucun sélecteur, aucun bouton `aria-pressed`, dans les deux langues.
 */

const followUp: CartularyFollowUpController = {
  todos: [],
  syncError: '',
  addTodo: vi.fn(),
  updateTodo: vi.fn(),
  removeTodo: vi.fn(() => null),
  restoreTodo: vi.fn(),
};

const bar = (props: { language: 'FR' | 'EN'; readOnly: boolean }) => (
  <BarreDossier publicCode="DEMO-ROL-124060" brand="Rolex" model="Submariner" followUp={followUp} returnHref="/registry" {...props} />
);

describe('BarreDossier — V6 (V-D9) : bascule FR/EN masquée tant que la traduction est partielle', () => {
  it('ne rend aucun sélecteur de langue, en lecture comme en édition', () => {
    for (const readOnly of [true, false]) {
      const { container, unmount } = render(bar({ language: 'FR', readOnly }));
      expect(screen.queryByRole('button', { name: /Afficher l’interface en français|Display the interface in English/ })).toBeNull();
      expect(screen.queryByRole('button', { pressed: true })).toBeNull();
      expect(screen.queryByRole('button', { pressed: false })).toBeNull();
      expect(container.querySelector('[aria-pressed]')).toBeNull();
      expect(container.querySelector('.language-toggle, .dossier-bar__languages')).toBeNull();
      expect(screen.queryByRole('button', { name: /^(FR|EN)$/ })).toBeNull();
      // La barre garde son seul contrôle : « A Faire » (aucun autre bouton dans l'en-tête tant que le popover est fermé).
      expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['A Faire']);
      expect(screen.getByRole('link', { name: 'Ouvrir le Registre Cartularia' })).toBeTruthy();
      unmount();
    }
  });

  it('garde la parité EN dormante de la barre (remise en service sans réécriture)', () => {
    const { container } = render(bar({ language: 'EN', readOnly: true }));
    expect(screen.getByRole('button', { name: /To do/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Display the interface in English|Afficher l’interface en français/ })).toBeNull();
    expect(container.querySelector('[aria-pressed], .language-toggle, .dossier-bar__languages')).toBeNull();
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['To do']);
  });
});
