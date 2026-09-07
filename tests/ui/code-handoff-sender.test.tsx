import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import { CodeHandoffSender } from '../../src/personalVault/CodeHandoffSender';
import { HANDOFF_TTL } from '../../src/personalVault/codeHandoffProtocol';
import { emptyPersonalVaultPayload } from '../../src/personalVault/types';
import { sha256Hex } from '../../src/personalVault/crypto';

const mocks = vi.hoisted(() => ({ docs: vi.fn(), navigate: vi.fn(), capture: { request: '' }, personal: { currentUser: { uid: 'vault-owner' } }, bridge: { currentUser: { uid: 'bridge-owner' } } }));
vi.mock('../../src/personalVault/firebase', () => ({ personalAuth: mocks.personal }));
vi.mock('../../src/personalVault/codeBridgeFirebase', () => ({ codeBridgeAuth: mocks.bridge, codeBridgeDb: {} }));
vi.mock('firebase/firestore', () => ({ collection: (_db: unknown, ...path: string[]) => path.at(-1), getDocsFromServer: mocks.docs }));
vi.mock('../../src/personalVault/codeHandoffCapture', () => ({ capturedHandoff: mocks.capture }));
vi.mock('../../src/personalVault/codeHandoffNavigation', () => ({ returnCodesToRegistry: mocks.navigate }));
let nonce: string; let expiresAt: number;
beforeEach(async () => {
  vi.stubEnv('VITE_REGISTRY_SITE_URL', 'https://registry.example.test/');
  nonce = crypto.randomUUID(); expiresAt = Date.now() + HANDOFF_TTL;
  mocks.capture.request = new URLSearchParams({ codeHandoff: nonce, recipientOrigin: 'https://registry.example.test', expiresAt: String(expiresAt), recipientUid: 'registry-owner', recipientEmail: `${await sha256Hex('registry-alias\u0000atlas')}@registry.cartularia.invalid` }).toString();
  mocks.docs.mockImplementation(async (kind) => ({ docs: [{ id: kind === 'locations' ? 'LIE-12345678' : 'CLI-ABCDEF12', data: () => ({ genericLabel: 'Nom personnel à ne jamais transférer' }) }] }));
});
afterEach(() => { vi.unstubAllEnvs(); });
const mount = () => render(<CodeHandoffSender user={{ uid: 'vault-owner', getIdToken: async () => 'never-sent' } as User} bridgeUser={{ uid: 'bridge-owner', getIdToken: async () => 'never-sent' } as User} payload={emptyPersonalVaultPayload('atlas')} blocked={false} syncPending={false} onBusy={() => undefined} />);
describe('confirmation Coffre du transfert limité aux codes', () => {
  it('exige origine et confirmation, vérifie les sessions, exclut les données libres et les jetons', async () => {
    mount(); expect(mocks.docs).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer le partage des seuls codes' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('https://registry.example.test', expect.objectContaining({ outcome: 'codes' })));
    const sent = mocks.navigate.mock.calls[0][1];
    expect(sent.snapshot.locations).toEqual([{ code: 'LIE-12345678', genericLabel: 'LIE-12345678' }]);
    expect(JSON.stringify(sent)).not.toContain('Nom personnel'); expect(JSON.stringify(sent)).not.toContain('never-sent');
  });
  it('refuse un alias différent sans lire les codes', async () => {
    const params = new URLSearchParams(mocks.capture.request); params.set('recipientEmail', `${await sha256Hex('registry-alias\u0000someone-else')}@registry.cartularia.invalid`); mocks.capture.request = params.toString();
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Confirmer le partage des seuls codes' }));
    await screen.findByText(/ne correspond pas au pseudonyme/); expect(mocks.docs).not.toHaveBeenCalled();
  });
  it('refuse une demande expirée ou une destination non autorisée', () => {
    mocks.capture.request = mocks.capture.request.replace('registry.example.test', 'attacker.example.test');
    mount(); expect(screen.getByRole('alert').textContent).toContain('destination non autorisée');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
