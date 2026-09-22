import { IntegrityJournal } from '../utils/integrityJournal';
import { cartulariaLocalVault, cartulariaStorage } from './localVault';

export function createCartularyJournal({ cartularyId, demonstration }: { cartularyId: string; demonstration: boolean }) {
  // Capture immutable session handles: an old journal must never write to the next account.
  const vault = demonstration || cartulariaLocalVault?.cartularyId !== cartularyId ? null : cartulariaLocalVault;
  const persistentStorage = vault ? cartulariaStorage : null;
  const volatileState = new Map<string, string>();
  return new IntegrityJournal({
    cartularyId,
    storage: persistentStorage && vault ? {
      getItem: (key) => persistentStorage.getItem(key),
      setItem: (key, value) => {
        vault.assertAccessible();
        // writeRaw journals the payload synchronously before its IndexedDB commit.
        void vault.writeRaw(key, value).catch((error: unknown) => console.error('Persistance du journal impossible', error));
      },
      removeItem: (key) => {
        vault.assertAccessible();
        void vault.removeKey(key).catch((error: unknown) => console.error('Persistance du journal impossible', error));
      },
    } : {
      getItem: (key) => volatileState.get(key) ?? null,
      setItem: (key, value) => { volatileState.set(key, value); },
      removeItem: (key) => { volatileState.delete(key); },
    },
  });
}
