import type { ComponentProps } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Le panneau Preuves en lecture seule (démonstration) ne doit afficher aucun message technique
// (« Connexion requise », « Connectez-vous… ») ni aucune action propriétaire (suppression,
// export, migration), et ne doit observer ni la session ni la chaîne serveur.
// En mode propriétaire (V5 P-D1) : aucun tiroir « Simulation technique », export rangé avec le carnet
// local, migration proposée seulement sous rupture, suppression isolée dans la dernière section.
const mocks = vi.hoisted(() => ({
  observeAuthoritativeCartularyIntegrity: vi.fn(),
  requestExternalTimestamp: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
}));

vi.mock('../../src/firebase', () => ({ auth: { currentUser: null }, db: {} }));
vi.mock('firebase/auth', () => ({
  EmailAuthProvider: { credential: () => ({ providerId: 'password' }) },
  getIdTokenResult: async () => ({ authTime: new Date().toISOString() }),
  onAuthStateChanged: () => () => undefined,
  reauthenticateWithCredential: async () => ({}),
  signOut: async () => undefined,
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => path.join('/'),
  collection: (parent: unknown, ...path: string[]) => [typeof parent === 'string' ? parent : '', ...path].filter(Boolean).join('/'),
  getDoc: mocks.getDoc,
  getDocs: mocks.getDocs,
  onSnapshot: () => () => undefined,
  orderBy: () => undefined,
  query: () => undefined,
  where: () => undefined,
}));
vi.mock('../../src/services/cartularyIntegrity', () => ({
  observeAuthoritativeCartularyIntegrity: mocks.observeAuthoritativeCartularyIntegrity,
}));
vi.mock('../../src/services/timestamping', () => ({ requestExternalTimestamp: mocks.requestExternalTimestamp }));
vi.mock('../../src/components/CartularyTransferPanel', () => ({
  CartularyTransferPanel: () => <div data-testid="transfer-panel" />,
}));
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,x' } }));

import { AuditPanel } from '../../src/components/AuditPanel';
import type { IntegrityJournal } from '../../src/utils/integrityJournal';
import type { HybridPersistenceState } from '../../src/persistence/useHybridPersistence';
import { loadPublicProjection, loadPublicPublicationStatuses, loadPublicPublicationSummaries } from '../../src/services/projections';

const ZERO_DIGEST = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';

const makeJournal = (overrides: Partial<Record<'verifyIntegrity' | 'getProofState' | 'exportPortableBundle', ReturnType<typeof vi.fn>>> = {}) => {
  const journal = {
    ready: vi.fn(async () => undefined),
    verifyIntegrity: vi.fn(async () => ({ isValid: true, errors: [], legacyStatuses: [] })),
    getEvents: vi.fn(() => []),
    getReceipts: vi.fn(() => []),
    getProofState: vi.fn(() => ({ revision: 0, contentDigest: ZERO_DIGEST, legacyStatuses: [] })),
    reconcileSnapshot: vi.fn(async () => null),
    migrateBrokenJournal: vi.fn(async () => undefined),
    exportPortableBundle: vi.fn(async () => ({ cartularyId: 'cart_demo', revision: 1 })),
    ...overrides,
  };
  return journal as unknown as IntegrityJournal & typeof journal;
};

const makePersistence = (authenticated = false) => {
  const persistence = {
    localStatus: 'ready',
    cloudStatus: authenticated ? 'synced' : 'signed-out',
    authenticated,
    accountLabel: null,
    lastSyncedAt: null,
    pendingCount: 0,
    conflicts: [],
    error: null,
    syncNow: vi.fn(async () => undefined),
    resolveConflict: vi.fn(async () => undefined),
    deleteAllData: vi.fn(async () => undefined),
  };
  return persistence as unknown as HybridPersistenceState & typeof persistence;
};

const TECHNICAL_MESSAGE = /Connexion requise|Sign-in required|Connexion propriétaire requise|Owner sign-in required|Connectez-vous|Sign in /;

const renderPanel = (overrides: Partial<ComponentProps<typeof AuditPanel>> = {}) => {
  const journal = (overrides.journal as ReturnType<typeof makeJournal> | undefined) ?? makeJournal();
  const persistence = makePersistence();
  const onDeleteAllData = vi.fn(async () => undefined);
  const { unmount } = render(
    <AuditPanel
      journal={journal}
      cartularyId="cart_demo_rolex_submariner_124060"
      language="FR"
      publicShareCode="DEMO-ROL-124060"
      snapshot={{}}
      refreshToken={0}
      persistence={persistence}
      onDeleteAllData={onDeleteAllData}
      onJournalUpdate={() => undefined}
      {...overrides}
    />,
  );
  return { journal, persistence, onDeleteAllData, unmount };
};

describe('panneau Preuves en lecture seule (démonstration)', () => {
  beforeEach(() => {
    mocks.observeAuthoritativeCartularyIntegrity.mockImplementation(() => () => undefined);
  });

  it('n’affiche ni message de connexion ni action propriétaire, et n’observe rien', () => {
    const { journal, persistence, onDeleteAllData } = renderPanel({ readOnly: true, demoRegistryProofsHref: '/registry/reg_cartularia_demo/integrity' });

    expect(screen.queryByText(TECHNICAL_MESSAGE)).toBeNull();
    expect(screen.queryByText(/Copie privée cloud|Private cloud copy/)).toBeNull();
    expect(screen.queryByText(/Supprimer mes données|Delete my data/)).toBeNull();
    expect(screen.queryByText(/Simulation technique|Technical Simulation/)).toBeNull();
    expect(screen.queryByText(/Carnet local de travail|Historique local conservé/)).toBeNull();
    expect(screen.queryByTestId('transfer-panel')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();

    expect(screen.getByText(/Démonstration en lecture seule/)).toBeTruthy();
    expect(screen.getByText('Preuve serveur du Cartulaire')).toBeTruthy();
    expect(screen.getByText('Chaîne fictive de démonstration')).toBeTruthy();
    expect(screen.getByText(/La cession n’est pas démontrée/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voir les preuves du Registre démo' }).getAttribute('href')).toBe('/registry/reg_cartularia_demo/integrity');

    // Aucun faux « publié » : sans publication constatée, ni code public ni QR.
    expect(screen.queryByText(/Code public du Cartulaire|Mini-site publié/)).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();

    expect(mocks.observeAuthoritativeCartularyIntegrity).not.toHaveBeenCalled();
    expect(onDeleteAllData).not.toHaveBeenCalled();
    expect(persistence.deleteAllData).not.toHaveBeenCalled();
    expect(journal.ready).not.toHaveBeenCalled();
    expect(journal.reconcileSnapshot).not.toHaveBeenCalled();
  });

  it('reste sans message technique en anglais', () => {
    renderPanel({ readOnly: true, language: 'EN' });
    expect(screen.queryByText(TECHNICAL_MESSAGE)).toBeNull();
    expect(screen.getByText(/Read-only demonstration/)).toBeTruthy();
    expect(screen.getByText('Cartulary server proof')).toBeTruthy();
    expect(screen.getByText('Fictional demonstration chain')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('montre le code public et le QR seulement pour un mini-site réellement publié', async () => {
    const publishedWebsiteUrl = 'https://cartularia.test/watch-website?publicCode=DEMO-ROL-124060';
    renderPanel({ readOnly: true, publishedWebsiteUrl });

    expect(screen.getByText('Code public du Cartulaire')).toBeTruthy();
    expect(screen.getByText('DEMO-ROL-124060')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ouvrir le mini-site publié lié au QR code' }).getAttribute('href')).toBe(publishedWebsiteUrl);
    await waitFor(() => expect(screen.getByRole('img', { name: 'QR code vers le mini-site publié' }).getAttribute('src')).toBe('data:image/png;base64,x'));
    expect(screen.queryByText(TECHNICAL_MESSAGE)).toBeNull();
  });
});

describe('panneau Preuves propriétaire (comportement préservé)', () => {
  beforeEach(() => {
    mocks.observeAuthoritativeCartularyIntegrity.mockImplementation(() => () => undefined);
  });

  it('conserve les états de connexion et les actions propriétaires hors lecture seule', async () => {
    const { journal } = renderPanel();

    expect(screen.getByText('Copie privée cloud')).toBeTruthy();
    expect(screen.getAllByText('Connexion requise').length).toBeGreaterThan(0);
    expect(within(screen.getByRole('region', { name: 'Suppression des données' })).getByRole('button', { name: /Supprimer mes données/ })).toBeTruthy();
    // V5 P-D1 : plus de tiroir technique ; l'export reste, désactivé tant que la révision locale est 0.
    expect(screen.queryByRole('button', { name: /Simulation technique|Falsifier|fixture/i })).toBeNull();
    expect(screen.queryByText(/Simulation technique|Technical Simulation/)).toBeNull();
    const exportButton = screen.getByRole('button', { name: /Exporter le carnet local/ }) as HTMLButtonElement;
    expect(exportButton).toBeTruthy();
    expect(exportButton.disabled).toBe(true);
    expect(screen.getByTestId('transfer-panel')).toBeTruthy();
    expect(screen.getByText('Carnet local de travail')).toBeTruthy();
    // V4 point 2 : sans publication constatée, aucun QR ni lien de partage ; la ligne « Code public » reste, avec le code réel.
    expect(screen.queryByRole('link', { name: /QR code/ })).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('note').textContent).toMatch(/Aucun mini-site publié : le QR code de partage apparaît une fois la publication confirmée depuis la page Publication\./);
    expect(screen.getByText('Code public du Cartulaire')).toBeTruthy();
    expect(screen.getByText('DEMO-ROL-124060')).toBeTruthy();
    expect(screen.queryByText(/Non émis|fiche publique/)).toBeNull();
    await waitFor(() => expect(journal.ready).toHaveBeenCalled());
    expect(mocks.observeAuthoritativeCartularyIntegrity).not.toHaveBeenCalled();
  });

  it('mode propriétaire : QR et lien seulement vers un mini-site réellement publié', async () => {
    const publishedWebsiteUrl = 'https://cartularia.test/watch-website?publicCode=DEMO-ROL-124060';
    renderPanel({ publishedWebsiteUrl });

    expect(screen.getByRole('link', { name: 'Ouvrir le mini-site publié lié au QR code' }).getAttribute('href')).toBe(publishedWebsiteUrl);
    await waitFor(() => expect(screen.getByRole('img', { name: 'QR code vers le mini-site publié' }).getAttribute('src')).toBe('data:image/png;base64,x'));
    expect(screen.getByText(publishedWebsiteUrl)).toBeTruthy();
    expect(screen.queryByText(/fiche publique/)).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.getByText('DEMO-ROL-124060')).toBeTruthy();
  });

  it('observe la chaîne serveur du Cartulaire une fois le propriétaire connecté', () => {
    renderPanel({ persistence: makePersistence(true) });
    expect(mocks.observeAuthoritativeCartularyIntegrity).toHaveBeenCalledTimes(1);
    expect(mocks.observeAuthoritativeCartularyIntegrity.mock.calls[0][0]).toBe('cart_demo_rolex_submariner_124060');
    expect(screen.queryByText('Connexion requise')).toBeNull();
  });

  it('propose la migration seulement quand le carnet local est rompu', async () => {
    const snapshot = { reference: 'demo' };
    const intact = renderPanel({ snapshot });
    await waitFor(() => expect(intact.journal.verifyIntegrity).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Migrer/ })).toBeNull();
    expect(screen.queryByText(/Rupture de chaîne|Incohérence détectée/)).toBeNull();
    intact.unmount();

    const broken = makeJournal({
      verifyIntegrity: vi.fn(async () => ({ isValid: false, errors: [], legacyStatuses: [], brokenSequence: 2 })),
    });
    const { journal } = renderPanel({ journal: broken, snapshot });
    const migrate = await screen.findByRole('button', { name: 'Migrer la chaîne rompue' });
    expect(screen.getByText('Rupture de chaîne à la séquence #2 !')).toBeTruthy();
    expect(screen.getByText(/Le carnet local ne peut plus être horodaté ni exporté\./)).toBeTruthy();
    // Un carnet rompu n'est ni horodatable ni exportable ; la migration est sa seule issue.
    expect((screen.getByRole('button', { name: 'Exporter le carnet local' }) as HTMLButtonElement).disabled).toBe(true);
    // La migration est dans l'historique, jamais dans la section de suppression.
    expect(within(screen.getByRole('region', { name: 'Suppression des données' })).queryByRole('button', { name: /Migrer/ })).toBeNull();
    fireEvent.click(migrate);
    await waitFor(() => expect(journal.migrateBrokenJournal).toHaveBeenCalledTimes(1));
    expect(journal.migrateBrokenJournal).toHaveBeenCalledWith(snapshot);
  });

  it('isole la suppression dans une section dédiée, en dernier', async () => {
    const { onDeleteAllData } = renderPanel();

    const regions = screen.getAllByRole('region');
    const deletion = regions.at(-1) as HTMLElement;
    expect(deletion).toBe(screen.getByRole('region', { name: 'Suppression des données' }));
    expect(deletion.tagName).toBe('SECTION');
    // Dernière section : après l'historique local, et après toute autre région nommée.
    const history = screen.getByText('Historique local conservé');
    expect(history.compareDocumentPosition(deletion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(deletion).getByText(/Action irréversible : efface le coffre local de ce navigateur/)).toBeTruthy();

    // « Conservation des données » ne porte plus que la synchronisation.
    const preservation = screen.getByRole('region', { name: 'Conservation des données' });
    expect(within(preservation).queryByRole('button', { name: /Supprimer/ })).toBeNull();
    expect(within(preservation).queryByRole('alertdialog')).toBeNull();

    fireEvent.click(within(deletion).getByRole('button', { name: /Supprimer mes données/ }));
    const dialog = within(deletion).getByRole('alertdialog', { name: 'Suppression définitive' });
    const confirm = within(dialog).getByRole('button', { name: 'Confirmer la suppression' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Confirmation'), { target: { value: 'SUPPRIMER' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    // auth.currentUser nul dans le mock : aucun step-up, l'opération est appelée directement.
    await waitFor(() => expect(onDeleteAllData).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('exporte le carnet local depuis « Carnet local de travail », hors de tout tiroir', async () => {
    const snapshot = { reference: 'demo' };
    const journal = makeJournal({ getProofState: vi.fn(() => ({ revision: 1, contentDigest: ZERO_DIGEST, legacyStatuses: [] })) });
    const createObjectURL = vi.fn(() => 'blob:x');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });

    renderPanel({ journal, snapshot });
    const exportButton = screen.getByRole('button', { name: 'Exporter le carnet local' }) as HTMLButtonElement;
    expect(exportButton.disabled).toBe(false);
    expect(screen.getByText(/Copie JSON portable des événements et reçus de ce navigateur/)).toBeTruthy();
    // Rangé sous « Carnet local de travail », avant l'historique et hors de la section de suppression.
    const journalTitle = screen.getByText('Carnet local de travail');
    const history = screen.getByText('Historique local conservé');
    expect(journalTitle.compareDocumentPosition(exportButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(exportButton.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Suppression des données' })).queryByRole('button', { name: /Exporter/ })).toBeNull();

    fireEvent.click(exportButton);
    await waitFor(() => expect(journal.exportPortableBundle).toHaveBeenCalledTimes(1));
    expect(journal.exportPortableBundle).toHaveBeenCalledWith(snapshot);
    await waitFor(() => expect(downloads).toEqual(['carnet-local-cart_demo-r1.json']));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('affiche chaque erreur sous l’action qui l’a produite, jamais dans l’autre section', async () => {
    const journal = makeJournal({
      getProofState: vi.fn(() => ({ revision: 1, contentDigest: ZERO_DIGEST, legacyStatuses: [] })),
      exportPortableBundle: vi.fn(async () => { throw new Error('Export refusé par le coffre'); }),
    });
    const onDeleteAllData = vi.fn(async () => { throw new Error('Suppression refusée'); });
    renderPanel({ journal, onDeleteAllData });
    const deletion = screen.getByRole('region', { name: 'Suppression des données' });
    const history = screen.getByText('Historique local conservé');

    fireEvent.click(screen.getByRole('button', { name: 'Exporter le carnet local' }));
    const exportAlert = await screen.findByRole('alert');
    expect(exportAlert.textContent).toBe('Export refusé par le coffre');
    expect(exportAlert.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(deletion).queryByRole('alert')).toBeNull();

    fireEvent.click(within(deletion).getByRole('button', { name: /Supprimer mes données/ }));
    fireEvent.change(within(deletion).getByLabelText('Confirmation'), { target: { value: 'SUPPRIMER' } });
    fireEvent.click(within(deletion).getByRole('button', { name: 'Confirmer la suppression' }));
    const deleteAlert = await within(deletion).findByRole('alert');
    expect(deleteAlert.textContent).toBe('Suppression refusée');
    // Les deux états coexistent : l'erreur d'export n'est ni effacée ni déplacée par la suppression.
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toEqual(['Export refusé par le coffre', 'Suppression refusée']);
    expect((within(deletion).getByRole('button', { name: 'Confirmer la suppression' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('garde la parité anglaise des textes propriétaires du panneau', () => {
    renderPanel({ language: 'EN' });
    expect(screen.getByRole('region', { name: 'Data deletion' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Delete my data/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export local journal' })).toBeTruthy();
    expect(screen.getByText(/Irreversible action: erases this browser’s local vault/)).toBeTruthy();
    expect(screen.getByText(/Portable JSON copy of this browser’s events and receipts/)).toBeTruthy();
    expect(screen.queryByText(/Technical Simulation|Tamper event|Create local fixture/)).toBeNull();
  });
});

describe('loadPublicProjection face aux règles de lecture publique', () => {
  it('traite un refus de lecture (publication absente ou révoquée) comme une absence', async () => {
    mocks.getDoc.mockRejectedValue(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }));
    await expect(loadPublicProjection('DEMO-AP-000000')).resolves.toBeNull();
    expect(mocks.getDocs).not.toHaveBeenCalled();
  });

  it('laisse remonter les autres erreurs', async () => {
    mocks.getDoc.mockRejectedValue(Object.assign(new Error('unavailable'), { code: 'unavailable' }));
    await expect(loadPublicProjection('DEMO-AP-000000')).rejects.toThrow('unavailable');
  });
});

describe('loadPublicPublicationSummaries : la seule source de « publié » (décision d)', () => {
  const snapshot = (data: Record<string, unknown> | null) => ({ exists: () => data !== null, data: () => data });

  it('ne compte comme publié qu’un document en statut published, avec ses blocs', async () => {
    mocks.getDoc.mockResolvedValueOnce(snapshot({ status: 'published', blockIds: ['cover-hero', 7, 'media-gallery'] }));
    await expect(loadPublicPublicationSummaries(['DEMO-ROL-124060'])).resolves.toEqual({
      'DEMO-ROL-124060': { published: true, blockIds: ['cover-hero', 'media-gallery'] },
    });
  });

  it('traite un document révoqué comme non publié, sans bloc', async () => {
    mocks.getDoc.mockResolvedValueOnce(snapshot({ status: 'revoked', blockIds: ['cover-hero'] }));
    await expect(loadPublicPublicationSummaries(['DEMO-AP-000000'])).resolves.toEqual({ 'DEMO-AP-000000': { published: false, blockIds: [] } });
  });

  it('traite un document absent ou sans statut comme non publié', async () => {
    mocks.getDoc.mockResolvedValueOnce(snapshot(null)).mockResolvedValueOnce(snapshot({ blockIds: ['cover-hero'] }));
    await expect(loadPublicPublicationSummaries(['DEMO-A', 'DEMO-B'])).resolves.toEqual({
      'DEMO-A': { published: false, blockIds: [] },
      'DEMO-B': { published: false, blockIds: [] },
    });
  });

  it('traite un refus de lecture comme non publié et laisse remonter les autres erreurs', async () => {
    mocks.getDoc.mockRejectedValueOnce(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }));
    await expect(loadPublicPublicationSummaries(['DEMO-C'])).resolves.toEqual({ 'DEMO-C': { published: false, blockIds: [] } });
    mocks.getDoc.mockRejectedValueOnce(Object.assign(new Error('unavailable'), { code: 'unavailable' }));
    await expect(loadPublicPublicationSummaries(['DEMO-C'])).rejects.toThrow('unavailable');
  });

  it('dérive loadPublicPublicationStatuses du même constat, sans doublon de code', async () => {
    mocks.getDoc.mockResolvedValueOnce(snapshot({ status: 'published', blockIds: [] })).mockResolvedValueOnce(snapshot({ status: 'revoked' }));
    await expect(loadPublicPublicationStatuses(['DEMO-D', 'DEMO-E', 'DEMO-D'])).resolves.toEqual({ 'DEMO-D': true, 'DEMO-E': false });
    expect(mocks.getDoc).toHaveBeenCalledTimes(2);
  });
});
