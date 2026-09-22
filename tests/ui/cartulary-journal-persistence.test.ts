import { afterEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';

const current = vi.hoisted(() => ({ session: null as null | { storage: unknown; vault: unknown } }));
vi.mock('../../src/persistence/localVault', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/persistence/localVault')>();
  return { ...actual, get cartulariaLocalVault() { return current.session?.vault ?? null; },
    get cartulariaStorage() { return current.session?.storage ?? null; } };
});
import { createVerifiedLocalVaultSession, MemoryVaultBackend } from '../../src/persistence/localVault';
import { createCartularyJournal } from '../../src/persistence/cartularyJournal';

const fixture = (uid = 'journal-owner') => {
  const values = new Map<string, string>();
  const storage = { get length() { return values.size; }, key: (n: number) => [...values.keys()][n] ?? null,
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
  const session = createVerifiedLocalVaultSession({ uid, cartularyId: 'cart-journal', backend: new MemoryVaultBackend(), storage });
  current.session = session;
  vi.stubGlobal('crypto', webcrypto);
  return session;
};
afterEach(() => { current.session = null; vi.unstubAllGlobals(); });

it('chaque écriture du journal crée une version locale, y compris après le premier miroir', async () => {
  const session = fixture(); const journal = createCartularyJournal({ cartularyId: 'cart-journal', demonstration: false });
  await journal.ready(); await session.vault.flush();
  const [initial] = await session.vault.listStateRecords();
  expect(initial.localVersion).toBeTruthy();
  await session.vault.markStateCloudSynced(initial.key, 1, initial);
  await journal.logEvent('local.change', 'journal-owner', 'Modification synthétique'); await session.vault.flush();
  const [next] = await session.vault.listStateRecords();
  expect(next.localVersion).not.toBe(initial.localVersion); expect(next.dirty).toBe(true);
  expect(next.value).toContain('Modification synthétique');
  expect(next.cloudRevision).toBe(1);
});

it('un ancien journal ne redirige pas ses écritures vers le nouveau compte', async () => {
  const first = fixture(); const journal = createCartularyJournal({ cartularyId: 'cart-journal', demonstration: false });
  await journal.ready(); await first.vault.flush(); first.lock();
  const second = fixture('second-owner');
  await expect(journal.logEvent('local.change', 'journal-owner', 'stale')).rejects.toThrow();
  expect(await second.vault.listStateRecords()).toEqual([]);
});
