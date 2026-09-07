import { describe, expect, it, vi } from 'vitest';
import { saveVaultAndCodes } from '../../src/personalVault/vaultSaveWorkflow';
import { emptyPersonalVaultPayload, migratePersonalVaultPayload, type PersonalVaultPayload } from '../../src/personalVault/types';
import { decryptPersonalPayload, encryptPersonalPayload } from '../../src/personalVault/crypto';

describe('file de synchronisation incluse dans le Coffre chiffré', () => {
  it('ne synchronise rien avant une sauvegarde confirmée', async () => {
    const synchronize = vi.fn();
    await expect(saveVaultAndCodes(emptyPersonalVaultPayload('atlas'), async () => { throw new Error('offline'); }, synchronize)).rejects.toThrow('offline');
    expect(synchronize).not.toHaveBeenCalled();
  });
  it('persiste l’attente à travers chiffrement/déchiffrement et reprend depuis un autre chargement', async () => {
    const source = emptyPersonalVaultPayload('atlas'); source.owners[0].label = 'Nom privé à ne pas exposer';
    let stored: Awaited<ReturnType<typeof encryptPersonalPayload>>;
    const persist = async (value: PersonalVaultPayload) => { stored = await encryptPersonalPayload({ payload: value, password: 'test-password-only', userAlias: 'atlas' }); };
    const result = await saveVaultAndCodes(source, persist, async () => { throw new Error('bridge-offline'); });
    expect(result.codeSyncPending).toBe(true);
    expect(JSON.stringify(stored!)).not.toContain(source.owners[0].label);
    expect(JSON.stringify(stored!)).not.toContain('codeSyncPending');
    const reopened = migratePersonalVaultPayload(await decryptPersonalPayload({ envelope: stored!, password: 'test-password-only', userAlias: 'atlas' }), 'atlas');
    expect(reopened.codeSyncPending).toBe(true);
    const retried = await saveVaultAndCodes(reopened, persist, async () => undefined);
    expect(retried.codeSyncPending).toBe(false);
  });
  it('garde une reprise idempotente si l’acquittement final est interrompu', async () => {
    const persisted: PersonalVaultPayload[] = [];
    const result = await saveVaultAndCodes(emptyPersonalVaultPayload('atlas'), async (value) => {
      if (!value.codeSyncPending) throw new Error('ack-offline'); persisted.push(value);
    }, async () => undefined);
    expect(result.codeSyncPending).toBe(true);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].codeSyncPending).toBe(true);
  });
});
