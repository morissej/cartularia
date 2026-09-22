import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetLockedVaultDraft, preserveLockedVaultDraft, readLockedVaultDraft } from '../../src/personalVault/lockedDraft';
import { emptyPersonalVaultPayload } from '../../src/personalVault/types';

beforeEach(() => { vi.stubGlobal('crypto', webcrypto); localStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());
describe('brouillons verrouillés du Coffre', () => {
  it('lie le déchiffrement au mot de passe et à l’identité même si une enveloppe est copiée sous une autre clé', async () => {
    const payload = emptyPersonalVaultPayload('atlas');
    await preserveLockedVaultDraft('binding-owner', 'correct-password', payload);
    await expect(readLockedVaultDraft('binding-owner', 'incorrect-password', 'atlas')).rejects.toThrow();
    localStorage.setItem('cartularia:personal-vault:locked-draft:v1:another-owner', localStorage.getItem('cartularia:personal-vault:locked-draft:v1:binding-owner')!);
    await expect(readLockedVaultDraft('another-owner', 'correct-password', 'atlas')).rejects.toThrow('autre identité');
    forgetLockedVaultDraft('binding-owner');
  });
  it('conserve seulement une enveloppe chiffrée en mémoire si le stockage local refuse l’écriture', async () => {
    const payload = emptyPersonalVaultPayload('atlas');
    const failingStorage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(await preserveLockedVaultDraft('quota-owner', 'correct-password', payload)).toBe(false);
    expect(await readLockedVaultDraft('quota-owner', 'correct-password', 'atlas')).toEqual(payload);
    expect(localStorage.length).toBe(0);
    failingStorage.mockRestore(); forgetLockedVaultDraft('quota-owner');
  });
  it('sérialise deux verrouillages pour conserver le brouillon le plus récent', async () => {
    const payload = emptyPersonalVaultPayload('atlas');
    const recent = { ...payload, updatedAt: 'recent-draft' };
    await Promise.all([preserveLockedVaultDraft('serial-owner', 'correct-password', payload), preserveLockedVaultDraft('serial-owner', 'correct-password', recent)]);
    expect(await readLockedVaultDraft('serial-owner', 'correct-password', 'atlas')).toEqual(recent);
    forgetLockedVaultDraft('serial-owner');
  });
});
