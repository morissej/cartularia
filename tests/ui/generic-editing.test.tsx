import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { GenericCartularyView } from '../../src/components/GenericCartularyView';
import { CAR_SCHEMA } from '../../src/schema/carSchema';
import type { PrivateCartularySnapshot } from '../../src/services/cartularies';

vi.mock('../../src/components/PublicWebsitePublicationPanel', () => ({ PublicWebsitePublicationPanel: () => <p>Publication contrôlée</p> }));
const snapshot = { envelope: { id: 'cart_car_custom', registryId: 'reg_demo', collectionId: 'col_actual', publicCode: 'OBJ-00001', displayTitle: 'Constructeur Modèle', makerName: 'Constructeur', modelName: 'Modèle', assetType: 'car', schemaId: 'car', schemaVersion: '1.2.0', revision: 2, lifecycleStatus: 'active' }, sections: [{ id: 'identity.summary', schemaSectionId: 'cover.car', title: 'Identité', fields: { 'cover.car.maker': { value: 'Constructeur', proofStatus: 'declared', visibility: 'secret' }, 'cover.car.model': { value: 'Modèle', proofStatus: 'declared', visibility: 'secret' } }, visibility: 'secret', status: 'imported_unreviewed', revision: 1 }] } as unknown as PrivateCartularySnapshot;
beforeEach(() => { window.history.replaceState(null, '', '/cartulary-view?cartularyId=cart_car_custom#cover'); window.scrollTo = vi.fn(); });
it('le lecteur n’affiche pas de commande de modification', () => {
  render(<GenericCartularyView snapshot={snapshot} schema={CAR_SCHEMA} />);
  expect(screen.queryByRole('button', { name: 'Modifier les informations' })).toBeNull();
});
it('envoie seulement les champs changés et conserve la saisie après un refus serveur', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('Conflit de révision')).mockResolvedValue(undefined);
  render(<GenericCartularyView snapshot={snapshot} schema={CAR_SCHEMA} canManage onSave={save} />);
  fireEvent.click(screen.getByRole('button', { name: 'Modifier les informations' }));
  fireEvent.change(screen.getByLabelText('Constructeur *'), { target: { value: 'Constructeur corrigé' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Conflit de révision'));
  expect((screen.getByLabelText('Constructeur *') as HTMLInputElement).value).toBe('Constructeur corrigé');
  expect(save).toHaveBeenCalledWith([{ fieldId: 'cover.car.maker', value: 'Constructeur corrigé' }]);
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Modifications enregistrées'));
});
