import type { ComponentProps } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Le panneau Preuves en lecture seule (démonstration) ne doit afficher aucun message technique
// (« Connexion requise », « Connectez-vous… ») ni aucune action propriétaire (suppression,
// simulation, export), et ne doit observer ni la session ni la chaîne serveur.
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

const makeJournal = () => {
  const journal = {
    ready: vi.fn(async () => undefined),
    verifyIntegrity: vi.fn(async () => ({ isValid: true, errors: [], legacyStatuses: [] })),
    getEvents: vi.fn(() => []),
    getReceipts: vi.fn(() => []),
    getProofState: vi.fn(() => ({ revision: 0, contentDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000', legacyStatuses: [] })),
    reconcileSnapshot: vi.fn(async () => null),
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
  const journal = makeJournal();
  const persistence = makePersistence();
  const onDeleteAllData = vi.fn(async () => undefined);
  render(
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
  return { journal, persistence, onDeleteAllData };
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
    expect(screen.getByRole('button', { name: /Supprimer mes données/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Simulation technique/ })).toBeTruthy();
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
