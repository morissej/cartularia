import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { GenericCartularyView } from '../../src/components/GenericCartularyView';
import { GenericMediaEditor } from '../../src/components/GenericMediaEditor';
import { CAR_SCHEMA } from '../../src/schema/carSchema';
import type { PrivateCartularySnapshot } from '../../src/services/cartularies';
import type { Asset } from '../../src/types';

const seen = vi.hoisted(() => ({ blocks: [] as any[] }));
vi.mock('../../src/components/PublicWebsitePublicationPanel', () => ({ PublicWebsitePublicationPanel: ({ blocks }: any) => { seen.blocks = blocks; return <p>Publication contrôlée</p>; } }));
vi.mock('../../src/components/PrivateMediaImage', () => ({ PrivateMediaImage: () => <p>Photo privée</p> }));
vi.mock('../../src/components/MediaDownloadLink', () => ({ MediaDownloadLink: () => <p>Téléchargement privé</p> }));
const snapshot = { envelope: { id: 'cart_car_test', accountHolderId: 'owner_test', registryId: 'reg_test', collectionId: 'col_test', publicCode: 'OBJ-0001', displayTitle: 'Voiture', makerName: 'Constructeur', modelName: 'Voiture', assetType: 'car', schemaId: 'car', schemaVersion: '1.2.0', revision: 4, lifecycleStatus: 'active' }, sections: [{ id: 'cover.car', schemaSectionId: 'cover.car', title: 'Identité', fields: { 'cover.car.maker': { value: 'Constructeur' } }, visibility: 'secret', revision: 1 }] } as unknown as PrivateCartularySnapshot;
const asset: Asset = { id: 'asset_photo', binaryId: 'binary_photo', cartularyId: 'cart_car_test', name: 'Photo automobile', type: 'image', visibility: 'Secret', status: 'Archived', url: '', hash: '', tags: ['main-photo'] };
beforeEach(() => { window.history.replaceState(null, '', '/cartulary-view?cartularyId=cart_car_test#cover'); window.scrollTo = vi.fn(); vi.spyOn(window, 'confirm').mockReturnValue(false); seen.blocks = []; });

it('protège retour, logo, annulation, rechargement et historique en conservant la saisie', () => {
  render(<GenericCartularyView snapshot={snapshot} schema={CAR_SCHEMA} canManage returnHref="/registry" onSave={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Modifier les informations' }));
  fireEvent.change(screen.getByLabelText('Constructeur *'), { target: { value: 'Saisie à garder' } });
  expect(fireEvent.click(screen.getByRole('link', { name: /Retour au Registre/ }))).toBe(false);
  expect(fireEvent.click(screen.getByRole('link', { name: /Ouvrir le Registre Cartularia/ }))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
  act(() => { window.history.replaceState(null, '', '#condition'); window.dispatchEvent(new PopStateEvent('popstate')); });
  expect(window.location.hash).toBe('#cover');
  expect((screen.getByLabelText('Constructeur *') as HTMLInputElement).value).toBe('Saisie à garder');
});

it('sélectionne un média seulement après son autorisation enregistrée, sans retirer le filtre Secret', async () => {
  vi.mocked(window.confirm).mockReturnValue(true);
  const save = vi.fn().mockRejectedValueOnce(new Error('Autorisation refusée')).mockResolvedValue(undefined);
  function Harness() { const [assets, setAssets] = useState([asset]); return <GenericCartularyView snapshot={snapshot} schema={CAR_SCHEMA} canManage canPublish assets={assets} onSaveMedia={async (change) => { await save(change); setAssets([{ ...asset, visibility: 'Tous' }]); }} />; }
  render(<Harness />); fireEvent.click(screen.getByRole('button', { name: /05Publication/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: /Photo automobile/ }));
  await screen.findByText('Autorisation refusée'); expect(seen.blocks.flatMap((block) => block.assets)).toHaveLength(0);
  expect((screen.getByRole('checkbox', { name: /Photo automobile/ }) as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole('checkbox', { name: /Photo automobile/ }));
  await waitFor(() => expect(seen.blocks.flatMap((block) => block.assets)).toEqual([{ assetId: 'asset_photo', binaryId: 'binary_photo' }]));
  expect(save).toHaveBeenLastCalledWith({ changes: [{ id: 'asset_photo', visibility: 'Tous' }], removeIds: [], confirmedPublicIds: ['asset_photo'] });
  expect(asset.visibility).toBe('Secret');
});

it('une liste d’entretien transmet tous les champs de la ligne alignés', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<GenericCartularyView snapshot={snapshot} schema={CAR_SCHEMA} canManage onSave={save} />);
  fireEvent.click(screen.getByRole('button', { name: /03L’objet/ })); fireEvent.click(screen.getByRole('button', { name: 'Modifier les informations' }));
  const section = screen.getByRole('heading', { name: 'Historique d’entretien' }).closest('section')!;
  fireEvent.click(within(section).getByRole('button', { name: 'Ajouter une ligne' }));
  fireEvent.change(within(section).getByLabelText('Date d’entretien'), { target: { value: '2026-09-01' } });
  fireEvent.change(within(section).getByLabelText('Kilométrage à l’entretien'), { target: { value: '15000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const edits = Object.fromEntries(save.mock.calls[0][0].map((entry: any) => [entry.fieldId, entry.value]));
  expect(edits['history.service[].date']).toEqual(['2026-09-01']); expect(edits['history.service[].mileageKm']).toEqual([15000]);
  expect(Object.keys(edits)).toHaveLength(4);
});

it('un ajout réemploie le téléversement vérifié et conserve son résultat privé après erreur de raccordement', async () => {
  const upload = vi.fn().mockResolvedValue({ ...asset, id: 'asset_new', binaryId: 'binary_new' });
  const save = vi.fn().mockRejectedValueOnce(new Error('Raccordement indisponible')).mockResolvedValue(undefined);
  render(<GenericMediaEditor assets={[]} canPublish onUpload={upload} onSave={save} />);
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter un média' }));
  fireEvent.change(screen.getByLabelText('Fichier (requis)'), { target: { files: [new File(['fixture'], 'photo.jpg', { type: 'image/jpeg' })] } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le média' }));
  await screen.findByText('Raccordement indisponible');
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le média' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2)); expect(upload).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[1][0].changes[0]).toMatchObject({ id: 'asset_new', binaryId: 'binary_new', visibility: 'Secret' });
});

it('affiche une erreur du suivi sans inventer un état vide et propose une reprise', () => {
  const retry = vi.fn(); render(<GenericCartularyView snapshot={snapshot} schema={CAR_SCHEMA} followUpState="error" onRetryFollowUp={retry} todos={[]} />);
  expect(screen.queryByText('Aucune tâche à traiter')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer le suivi' })); expect(retry).toHaveBeenCalledTimes(1);
});
