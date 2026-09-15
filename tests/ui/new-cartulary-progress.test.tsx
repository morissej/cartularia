import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NewCartularyPage } from '../../src/features/registry/NewCartularyPage';
import { CARTULARY_CREATION_DURATION_NOTE, CARTULARY_CREATION_TIMEOUT_MESSAGE } from '../../src/domain/cartularyCreation.ts';
import type { CartularyCreationProgress } from '../../src/services/cartularyCreation.ts';

/**
 * Écran de progression de la création (V5, P-B1) : trois étapes honnêtes dans une liste vivante, barre déterminée
 * en phase fichiers seulement (jamais « 100 % » en phase serveur), chronomètre hors région vivante, « Créé en N s »
 * pour une création menée d'un trait, reprise sans durée ; garde de sortie pendant la phase serveur (D4 (a)).
 * Mocks identiques à registry-correction-loop : le service n'expose que trois valeurs à la page.
 */
const fixture = vi.hoisted(() => ({ collections: [] as any[], create: vi.fn(), wait: vi.fn() }));
vi.mock('../../src/firebase.ts', () => ({ auth: {}, db: {}, functions: {} }));
vi.mock('../../src/features/registry/useRegistryCollections', () => ({ useRegistryCollections: () => ({ collections: fixture.collections, state: 'ready', retry: vi.fn(), collectionName: (id: string) => fixture.collections.find((entry) => entry.id === id)?.name || id }) }));
vi.mock('../../src/services/cartularyCreation.ts', () => ({ createCartulary: (...args: any[]) => fixture.create(...args), waitForCartularyCreation: (...args: any[]) => fixture.wait(...args), CartularyCreationFailedError: class extends Error {} }));
vi.mock('../../src/security/fileValidation.ts', () => ({ validateFileForUpload: vi.fn().mockResolvedValue({}) }));

const registry = { id: 'reg_progression_v5', organizationId: 'org_progression_v5', name: 'Registre progression' } as any;
const result = { cartularyId: 'cart_progression_v5', requestId: 'create_progression_v5', publicCode: 'OBJ-PROGRESSION', uploadedFileCount: 3, uploadedBytes: 1_000, media: { total: 3, imagesReady: 2, imagesPending: 0, videosOnDemand: 0, documents: 1 } };
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
const progressOf = (phase: CartularyCreationProgress['phase'], overrides: Partial<CartularyCreationProgress> = {}): CartularyCreationProgress => ({ phase, activeFileNames: [], completedFiles: 0, totalFiles: 3, uploadedBytes: 0, totalBytes: 1_000, ...overrides });
const steps = () => within(screen.getByRole('list', { name: 'Étapes de la création' })).getAllByRole('listitem');
const progressBar = () => document.querySelector('.registry-create-progress progress') as HTMLProgressElement;
const progressSection = () => document.querySelector('.registry-create-progress') as HTMLElement;

const renderAndFill = async () => {
  const view = render(<NewCartularyPage registry={registry} organization={{ id: 'org_progression_v5' } as any} user={{ uid: 'owner_progression_v5' } as any} />);
  for (const [name, value] of [['brand', 'Marque progression'], ['model', 'Modèle progression'], ['reference', 'REF-PROG-5']]) fireEvent.change(view.container.querySelector(`input[name="${name}"]`)!, { target: { value } });
  fireEvent.change(view.container.querySelector('input[name="coverFile"]')!, { target: { files: [new File(['fixture'], 'photo.jpg', { type: 'image/jpeg' })] } });
  await waitFor(() => expect((screen.getByRole('button', { name: 'Créer le Cartulaire' }) as HTMLButtonElement).disabled).toBe(false));
  return view;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  fixture.collections = [{ id: 'col_progression', registryId: registry.id, organizationId: registry.organizationId, versionToken: 'v1', name: 'Collection progression', status: 'draft', visibility: 'secret', publicationConsent: false, publishedCartularyIds: [] }];
  fixture.create.mockReset(); fixture.wait.mockReset();
  vi.spyOn(window, 'confirm').mockReturnValue(true); window.scrollTo = vi.fn();
  window.history.replaceState(null, '', `/registry/${registry.id}/new`);
});
afterEach(() => { vi.useRealTimers(); });

it('affiche trois étapes honnêtes, une barre déterminée en phase fichiers seulement, jamais « 100 % » en phase serveur, puis « Créé en N s »', async () => {
  const creation = deferred<typeof result>();
  const waiting = deferred<void>();
  let onProgress: ((progress: CartularyCreationProgress) => void) | undefined;
  let onStatus: ((status: 'pending' | 'processing') => void) | undefined;
  fixture.create.mockImplementation((input: { onProgress?: typeof onProgress }) => { onProgress = input.onProgress; return creation.promise; });
  fixture.wait.mockImplementation((_id: string, options: { onStatus?: typeof onStatus }) => { onStatus = options.onStatus; return waiting.promise; });
  const view = await renderAndFill();
  fireEvent.submit(view.container.querySelector('form')!);
  await waitFor(() => expect(fixture.create).toHaveBeenCalledTimes(1));
  expect(document.querySelector('.registry-create-progress')).toBeNull();

  // Phase fichiers : 1/3 vérifié, deux fichiers en vol, barre déterminée, octets affichés.
  act(() => onProgress!(progressOf('uploading', { activeFileNames: ['photo.jpg', 'doc.pdf'], completedFiles: 1, uploadedBytes: 500 })));
  expect(steps()).toHaveLength(3);
  expect(steps()[0].getAttribute('aria-current')).toBe('step');
  expect(steps()[0].textContent).toContain('Fichiers téléversés et vérifiés');
  expect(steps()[0].textContent).toContain('1/3 vérifié · en cours : photo.jpg, doc.pdf');
  expect(steps()[1].getAttribute('data-state')).toBe('pending');
  expect(progressBar().hasAttribute('value')).toBe(true);
  expect(progressBar().getAttribute('value')).toBe('50');
  expect(progressBar().getAttribute('aria-label')).toBe('Progression du téléversement');
  expect(progressSection().textContent).toMatch(/500 o sur 1000 o téléversés/);
  expect(progressSection().textContent).toContain('0 s écoulées');

  // Garde de sortie pendant la création (D4 (a)) : la fermeture accidentelle est retenue.
  const unload = new Event('beforeunload', { cancelable: true });
  act(() => { window.dispatchEvent(unload); });
  expect(unload.defaultPrevented).toBe(true);

  // Demande envoyée, serveur pas encore saisi : barre indéterminée, aucun « 100 », phrase d'ordre de grandeur.
  act(() => onProgress!(progressOf('processing', { completedFiles: 3, uploadedBytes: 1_000 })));
  await act(async () => { creation.resolve(result); });
  await waitFor(() => expect(fixture.wait).toHaveBeenCalledWith('cart_progression_v5', expect.objectContaining({ onStatus: expect.any(Function) })));
  expect(steps()[0].getAttribute('data-state')).toBe('done');
  expect(steps()[1].getAttribute('aria-current')).toBe('step');
  expect(steps()[1].textContent).toContain('En attente de prise en charge par le serveur…');
  expect(steps()[2].getAttribute('data-state')).toBe('pending');
  expect(progressBar().hasAttribute('value')).toBe(false);
  expect(progressBar().getAttribute('aria-label')).toBe('Progression de la création');
  expect(progressSection().textContent).not.toContain('100');
  expect(progressSection().textContent).toContain(CARTULARY_CREATION_DURATION_NOTE);
  expect(progressSection().textContent).not.toContain('raccordement');

  // Chronomètre hors région vivante : la région aria-live est la liste seule.
  act(() => { vi.advanceTimersByTime(3_000); });
  expect(progressSection().textContent).toContain('3 s écoulées');
  const live = document.querySelectorAll('.registry-create-progress [aria-live]');
  expect(live).toHaveLength(1);
  expect(live[0].tagName).toBe('OL');
  expect(live[0].getAttribute('aria-label')).toBe('Étapes de la création');
  expect(live[0].textContent).not.toContain('s écoulées');
  expect(live[0].textContent).not.toMatch(/o sur .* téléversés|Ordre de grandeur/);

  // Serveur en cours : troisième étape courante, seconde faite ; toujours pas de « 100 ».
  act(() => onStatus!('processing'));
  expect(steps()[1].getAttribute('data-state')).toBe('done');
  expect(steps()[2].getAttribute('aria-current')).toBe('step');
  expect(steps()[2].textContent).toContain('Création du Cartulaire et de sa projection au Registre…');
  expect(progressBar().hasAttribute('value')).toBe(false);
  expect(progressSection().textContent).not.toContain('100');

  // Succès : écran inchangé + durée mesurée.
  await act(async () => { waiting.resolve(); });
  await screen.findByRole('heading', { name: 'Marque progression Modèle progression' });
  expect(screen.getByText('Créé en 3 s.')).toBeTruthy();
  expect(screen.getByText(/sa projection minimale a été ajoutée à Registre progression/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Ouvrir le Cartulaire' })).toBeTruthy();
  expect(document.querySelector('.registry-create-progress')).toBeNull();
});

it('reprise : le délai renvoie au Catalogue, la garde de sortie reste active, la liste s’affiche sans progression locale et le succès n’annonce aucune durée', async () => {
  fixture.create.mockResolvedValue(result);
  const waiting = deferred<void>();
  fixture.wait
    .mockRejectedValueOnce(new Error(CARTULARY_CREATION_TIMEOUT_MESSAGE))
    .mockImplementationOnce((_id: string, options: { onStatus?: (status: 'pending' | 'processing') => void }) => { options.onStatus?.('pending'); return waiting.promise; });
  const view = await renderAndFill();
  fireEvent.submit(view.container.querySelector('form')!);
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('Vérifiez le catalogue');
  expect(document.querySelector('.registry-create-progress')).toBeNull();
  // Demande en attente : quitter la page demande confirmation (D4 (a), reprise en mémoire seulement).
  const unload = new Event('beforeunload', { cancelable: true });
  act(() => { window.dispatchEvent(unload); });
  expect(unload.defaultPrevented).toBe(true);
  expect(screen.getByRole('button', { name: 'Vérifier la création en cours' })).toBeTruthy();

  fireEvent.submit(view.container.querySelector('form')!);
  await waitFor(() => expect(fixture.wait).toHaveBeenCalledTimes(2));
  expect(fixture.wait.mock.calls.map(([id]) => id)).toEqual(['cart_progression_v5', 'cart_progression_v5']);
  await waitFor(() => expect(steps()).toHaveLength(3));
  expect(steps()[0].getAttribute('data-state')).toBe('done');
  expect(steps()[1].getAttribute('aria-current')).toBe('step');
  expect(steps()[1].textContent).toContain('En attente de prise en charge par le serveur…');
  expect(progressBar().hasAttribute('value')).toBe(false);
  expect(progressSection().textContent).not.toContain('100');
  expect(progressSection().textContent).toContain(CARTULARY_CREATION_DURATION_NOTE);

  act(() => { vi.advanceTimersByTime(2_000); });
  await act(async () => { waiting.resolve(); });
  await screen.findByRole('heading', { name: 'Marque progression Modèle progression' });
  expect(fixture.create).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/Créé en/)).toBeNull();
});
