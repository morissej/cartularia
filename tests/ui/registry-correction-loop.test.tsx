import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { RegistryCollections } from '../../src/features/registry/RegistryCollections';
import { NewCartularyPage } from '../../src/features/registry/NewCartularyPage';
import { RegistryAccessCenter } from '../../src/features/registry/RegistryAccessCenter';
import { GenericCartularyView } from '../../src/components/GenericCartularyView';
import { CAR_SCHEMA } from '../../src/schema/carSchema';
import { WATCH_SCHEMA } from '../../src/schema/watchSchema';

const fixture = vi.hoisted(() => ({ collections: [] as any[], items: [] as any[], save: vi.fn(), remove: vi.fn(), create: vi.fn(), wait: vi.fn(), publication: {} as any, publish: vi.fn() }));
vi.mock('../../src/firebase.ts', () => ({ auth: {}, db: {}, functions: {} }));
vi.mock('../../src/features/registry/useRegistryCollections', () => ({ useRegistryCollections: () => ({ collections: fixture.collections, state: 'ready', retry: vi.fn(), collectionName: (id: string) => fixture.collections.find((entry) => entry.id === id)?.name || id }) }));
vi.mock('../../src/services/collections.ts', () => ({ saveRegistryCollection: (...args: any[]) => fixture.save(...args), deleteRegistryCollection: (...args: any[]) => fixture.remove(...args), normalizeCollectionSlug: (name: string) => name.toLowerCase() }));
vi.mock('../../src/services/projections.ts', () => ({ loadRegistryItems: async () => fixture.items, observeRegistryItems: (_id: string, callback: (items: any[]) => void) => { callback(fixture.items); return () => {}; } }));
vi.mock('../../src/services/access.ts', () => ({ loadRegistryAccesses: async () => [], revokeRegistryAccess: vi.fn(), createRegistryAccess: vi.fn() }));
vi.mock('../../src/services/cartularyCreation.ts', () => ({ createCartulary: (...args: any[]) => fixture.create(...args), waitForCartularyCreation: (...args: any[]) => fixture.wait(...args), CartularyCreationFailedError: class extends Error {} }));
vi.mock('../../src/security/fileValidation.ts', () => ({ validateFileForUpload: vi.fn().mockResolvedValue({}) }));
vi.mock('../../src/services/websitePublication', () => ({ loadWebsitePublicationState: async () => fixture.publication, publishWebsiteSelection: (...args: any[]) => fixture.publish(...args), revokeWebsiteSelection: vi.fn() }));
vi.mock('../../src/components/PrivateMediaImage', () => ({ PrivateMediaImage: () => <p>Image simulée</p> }));
vi.mock('../../src/components/MediaDownloadLink', () => ({ MediaDownloadLink: () => <p>Téléchargement simulé</p> }));

const registry = { id: 'reg_audit', organizationId: 'org_audit', name: 'Registre audit' } as any;
const col = { id: 'col_audit', registryId: registry.id, organizationId: registry.organizationId, versionToken: 'version_initiale', name: 'Collection initiale', description: 'Description initiale', websiteTitle: 'Titre initial', websiteSlug: 'initial', status: 'draft', visibility: 'secret', publicationConsent: false, publishedCartularyIds: [] } as any;
beforeEach(() => {
  fixture.collections = [{ ...col }]; fixture.items = [];
  fixture.publication = { cartularyId: 'cart_audit', publicCode: 'OBJ-AUDIT', revision: 1, status: 'draft', blockIds: [], selectedAssetIds: [] };
  fixture.publish.mockReset();
  fixture.save.mockReset().mockResolvedValue('col_audit'); fixture.remove.mockReset().mockResolvedValue(undefined);
  fixture.create.mockReset().mockResolvedValue({ cartularyId: 'cart_demande_initiale', requestId: 'create_initiale' }); fixture.wait.mockReset();
  vi.spyOn(window, 'confirm').mockReturnValue(true); window.scrollTo = vi.fn();
  window.history.replaceState(null, '', '/registry/reg_audit/collections');
});

it('N-R02 : la suppression ferme le formulaire et interdit la résurrection', async () => {
  const view = render(<RegistryCollections registry={registry} canManage canPublish />);
  fireEvent.click(screen.getByRole('button', { name: 'Modifier', exact: true }));
  fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Saisie avant suppression' } });
  fireEvent.click(screen.getByRole('button', { name: 'Supprimer', exact: true }));
  await waitFor(() => expect(fixture.remove).toHaveBeenCalledWith('reg_audit', 'col_audit', 'version_initiale'));
  fixture.collections = []; view.rerender(<RegistryCollections registry={registry} canManage canPublish />);
  expect(screen.queryByLabelText('Nom')).toBeNull();
  expect(fixture.save).not.toHaveBeenCalled();
});

it('N-R01 : une révocation reçue pendant édition bloque le formulaire ancien', async () => {
  fixture.collections = [{ ...col, status: 'published', visibility: 'public', publicationConsent: true, publishedCartularyIds: ['cart_one'] }];
  fixture.items = [{ cartularyId: 'cart_one', collectionId: 'col_audit', projectionStatus: 'active', displayTitle: 'Objet un' }];
  const view = render(<RegistryCollections registry={registry} canManage canPublish />);
  fireEvent.click(screen.getByRole('button', { name: 'Modifier', exact: true }));
  fixture.collections = [{ ...col, versionToken: 'version_suivante', description: 'Correction faite ailleurs' }];
  view.rerender(<RegistryCollections registry={registry} canManage canPublish />);
  fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Nom corrigé ici' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Enregistrer et publier' }).closest('form')!);
  expect(fixture.save).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Enregistrer et publier' }).matches(':disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Recharger la dernière version' }));
  expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('Correction faite ailleurs');
  fireEvent.submit(screen.getByRole('button', { name: 'Enregistrer', exact: true }).closest('form')!);
  await waitFor(() => expect(fixture.save).toHaveBeenCalledOnce());
  expect(fixture.save.mock.calls[0][0]).toMatchObject({ expectedVersion: 'version_suivante', input: { publicationConsent: false, description: 'Correction faite ailleurs' } });
});

it('N-R03/07 : une demande en attente est figée, reprise une seule fois et nommée fidèlement', async () => {
  fixture.wait.mockRejectedValueOnce(new Error('Délai de confirmation dépassé')).mockResolvedValueOnce(undefined);
  const view = render(<NewCartularyPage registry={registry} organization={{ id: 'org_audit' } as any} user={{ uid: 'owner_audit' } as any} />);
  for (const [name, value] of [['brand', 'Marque initiale'], ['model', 'Modèle initial'], ['reference', 'REF-1']]) fireEvent.change(view.container.querySelector(`input[name="${name}"]`)!, { target: { value } });
  fireEvent.change(view.container.querySelector('input[name="coverFile"]')!, { target: { files: [new File(['fixture'], 'photo.jpg', { type: 'image/jpeg' })] } });
  await waitFor(() => expect((screen.getByRole('button', { name: 'Créer le Cartulaire' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.submit(view.container.querySelector('form')!);
  await screen.findByText('Délai de confirmation dépassé');
  expect(view.container.querySelector('input[name="model"]')!.matches(':disabled')).toBe(true);
  expect(screen.getByRole('button', { name: 'Vérifier la création en cours' }).matches(':disabled')).toBe(false);
  expect(screen.getByText(/Les montants restent dans vos vues privées/)).toBeTruthy();
  fireEvent.submit(view.container.querySelector('form')!);
  await screen.findByRole('heading', { name: 'Marque initiale Modèle initial' });
  expect(fixture.create).toHaveBeenCalledTimes(1);
  expect(fixture.create.mock.calls[0][0].profile.model).toBe('Modèle initial');
  expect(fixture.wait.mock.calls.map(([id]) => id)).toEqual(['cart_demande_initiale', 'cart_demande_initiale']);
});

it('N-R04 : garde de sélection et réhydratation de la sélection réellement publiée', async () => {
  window.history.replaceState(null, '', '/cartulary-view?cartularyId=cart_audit#publication');
  const snapshot = { envelope: { id: 'cart_audit', registryId: registry.id, publicCode: 'OBJ-AUDIT', displayTitle: 'Voiture audit', makerName: 'Constructeur', modelName: 'Modèle', assetType: 'car', lifecycleStatus: 'active' }, sections: [] } as any;
  const asset = { id: 'asset_audit', binaryId: 'binary_audit', name: 'Photo audit', type: 'image', visibility: 'Tous', status: 'Archived', url: '', tags: ['main-photo'] } as any;
  const props = { snapshot, schema: CAR_SCHEMA, assets: [asset], canPublish: true, returnHref: '/registry' };
  const view = render(<GenericCartularyView {...props} />);
  await screen.findByText('Brouillon · aucun mini-site publié');
  await waitFor(() => expect(screen.getByRole('checkbox', { name: /Photo audit/ }).matches(':disabled')).toBe(false));
  fireEvent.click(screen.getByRole('checkbox', { name: /Photo audit/ }));
  expect((screen.getByRole('checkbox', { name: /Photo audit/ }) as HTMLInputElement).checked).toBe(true);
  const unload = new Event('beforeunload', { cancelable: true });
  act(() => window.dispatchEvent(unload));
  expect(unload.defaultPrevented).toBe(true); expect(window.confirm).not.toHaveBeenCalled();
  view.unmount();
  fixture.publication = { ...fixture.publication, status: 'published', blockIds: ['media-library'], selectedAssetIds: ['asset_audit'] };
  render(<GenericCartularyView {...props} />);
  await screen.findByText('Mini-site publié');
  expect((screen.getByRole('checkbox', { name: /Photo audit/ }) as HTMLInputElement).checked).toBe(true);
  await waitFor(() => {
    const cleanUnload = new Event('beforeunload', { cancelable: true });
    act(() => window.dispatchEvent(cleanUnload));
    expect(cleanUnload.defaultPrevented).toBe(false);
  });
});

it('N-R05 : les Collections secondaires et vides actives sont proposées', async () => {
  fixture.collections = [{ ...col, id: 'col_primary', name: 'Principale' }, { ...col, id: 'col_secondary', name: 'Secondaire' }];
  fixture.items = [{ cartularyId: 'cart_one', collectionId: 'col_primary', collectionIds: ['col_primary', 'col_secondary'], projectionStatus: 'active', displayTitle: 'Objet dans deux collections' }];
  render(<RegistryAccessCenter registry={registry} canReadAccesses canManageAccesses />);
  fireEvent.click(await screen.findByRole('button', { name: 'Nouvelle invitation' }));
  fireEvent.change(screen.getByLabelText('Portée'), { target: { value: 'collection' } });
  await screen.findByRole('option', { name: 'Principale' });
  expect(screen.getByRole('option', { name: 'Secondaire' })).toBeTruthy();
});

it('N-R01 : une réponse de création incertaine garde le même identifiant de Collection', async () => {
  fixture.collections = [];
  fixture.save.mockRejectedValueOnce(new Error('Connexion interrompue')).mockResolvedValueOnce('col_new');
  render(<RegistryCollections registry={registry} canManage />);
  fireEvent.click(screen.getByRole('button', { name: 'Créer une collection', exact: true }));
  fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Collection demandée' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Enregistrer' }).closest('form')!);
  await screen.findByText('Connexion interrompue');
  fireEvent.submit(screen.getByRole('button', { name: 'Enregistrer' }).closest('form')!);
  await waitFor(() => expect(fixture.save).toHaveBeenCalledTimes(2));
  expect(fixture.save.mock.calls[0][0].createId).toMatch(/^col_/);
  expect(fixture.save.mock.calls[1][0].createId).toBe(fixture.save.mock.calls[0][0].createId);
});

it('N-R06 : le profil montre générique conserve les listes mixtes sans proposer une saisie impossible', () => {
  window.history.replaceState(null, '', '/cartulary-view?cartularyId=cart_audit#condition');
  const snapshot = { envelope: { id: 'cart_audit', registryId: registry.id, publicCode: 'OBJ-AUDIT', displayTitle: 'Montre audit', assetType: 'watch', lifecycleStatus: 'active' }, sections: [{ id: 'reports', schemaSectionId: 'condition.reports', title: 'Rapports', fields: { 'condition.reports[].title': { value: ['Rapport à conserver'], proofStatus: 'declared', visibility: 'secret' } }, visibility: 'secret' }] } as any;
  render(<GenericCartularyView snapshot={snapshot} schema={WATCH_SCHEMA} canManage onSave={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Modifier les informations' }));
  expect(screen.getByText('Rapport à conserver')).toBeTruthy();
  expect(screen.getByText(/Les listes contenant des pièces jointes/)).toBeTruthy();
  expect(within(screen.getByRole('heading', { name: 'Rapports' }).closest('section')!).queryByRole('button', { name: 'Ajouter une ligne' })).toBeNull();
});
