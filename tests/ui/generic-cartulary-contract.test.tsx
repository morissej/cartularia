import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GenericCartularyView } from '../../src/components/GenericCartularyView.tsx';
import type { PrivateCartularySnapshot } from '../../src/services/cartularies.ts';
import type { VerticalSchema } from '../../src/schema/schemaTypes.ts';

const snapshot = {
  envelope: {
    id: 'cart_car_future',
    publicCode: 'CAR-0001',
    displayTitle: 'Automobile de démonstration',
    makerName: 'Marque',
    modelName: 'Modèle',
    collectionId: 'col_vehicles',
    assetType: 'car',
    lifecycleStatus: 'active',
  },
  sections: [],
} as unknown as PrivateCartularySnapshot;

const schema = {
  schemaId: 'car',
  assetType: 'car',
  version: '1.2.0',
  status: 'active',
  defaultVisibility: 'secret',
  fieldCount: 0,
  sections: [],
  fields: [],
} satisfies VerticalSchema;

describe('gabarit universel du lecteur multi-actifs', () => {
  it('rend les mêmes pages et les structures communes pour une verticale future', () => {
    window.scrollTo = vi.fn();
    window.location.hash = '#cover';
    const { container } = render(<GenericCartularyView snapshot={snapshot} schema={schema} returnHref="/registry/reg_demo/items" />);

    expect(container.querySelector('[data-cartulary-presentation-version="cartulary-presentation@1.4.0"]')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Pages du Cartulaire' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Collection' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'À Faire' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /03L’objet/ }));
    expect(screen.getByRole('heading', { name: 'Stockage' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Transmission' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /02La référence/ }));
    expect(screen.getByRole('heading', { name: 'Rapports sur la référence' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /05Publication/ }));
    expect(screen.getByRole('heading', { name: 'Publiez un mini -site de votre Cartulaire' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Publiez votre objet dans une Collection' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Publiez votre objet dans Le Cercle' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Rapport PDF' })).toBeTruthy();
  });
});
