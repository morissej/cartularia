import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BarreDossier } from '../../src/components/BarreDossier.tsx';
import type { CartularyFollowUpController } from '../../src/features/cartulary/state/useCartularyFollowUp.ts';

const followUp: CartularyFollowUpController = {
  todos: [],
  syncError: '',
  addTodo: vi.fn(),
  updateTodo: vi.fn(),
  removeTodo: vi.fn(() => null),
  restoreTodo: vi.fn(),
};

const renderBar = (returnHref?: string) => render(
  <BarreDossier publicCode="DEMO-ROL-124060" brand="Rolex" model="Submariner" language="FR" followUp={followUp} readOnly returnHref={returnHref} />,
);

describe('BarreDossier — le logo suit le retour décidé par App.tsx', () => {
  beforeEach(() => {
    // Un returnTo présent dans l'URL ne doit plus être relu par la barre : App.tsx décide seul.
    window.history.replaceState(null, '', '/cartulary-demo?cartularyId=cart_demo_rolex_submariner_124060&returnTo=%2Fregistry%2Freg_autre%2Fitems');
  });

  it('pointe vers le returnHref transmis (Registre démo)', () => {
    renderBar('/registry/reg_cartularia_demo/items');
    expect(screen.getByRole('link', { name: 'Ouvrir le Registre Cartularia' }).getAttribute('href')).toBe('/registry/reg_cartularia_demo/items');
  });

  it('replie sur /registry sans returnHref, sans recalculer depuis l’URL', () => {
    renderBar();
    expect(screen.getByRole('link', { name: 'Ouvrir le Registre Cartularia' }).getAttribute('href')).toBe('/registry');
  });
});
