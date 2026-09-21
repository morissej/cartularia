import { act, render, screen } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IntegrityJournal } from '../../src/utils/integrityJournal';

const observed = vi.hoisted(() => ({ journals: [] as IntegrityJournal[] }));
vi.mock('../../src/firebase', () => ({ auth: { currentUser: null }, db: {}, storage: {}, functions: {} }));
vi.mock('firebase/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('firebase/auth')>(),
  onAuthStateChanged: (_auth: unknown, observer: (user: null) => void) => { observer(null); return () => {}; },
}));
vi.mock('../../src/utils/integrityJournal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/integrityJournal')>();
  return {
    ...actual,
    IntegrityJournal: class extends actual.IntegrityJournal {
      constructor(...args: ConstructorParameters<typeof actual.IntegrityJournal>) {
        super(...args);
        observed.journals.push(this);
      }
    },
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('Journal de la visite démo', () => {
  it('rend la démo sans lire, migrer ni écrire un journal persistant ou historique', async () => {
    vi.stubGlobal('crypto', webcrypto);
    window.history.replaceState({}, '', '/cartulary-demo');
    const legacyEvents = JSON.stringify([{ details: 'Journal privé du précédent propriétaire' }]);
    const legacyReceipts = JSON.stringify([{ provider: 'Reçu privé du précédent propriétaire' }]);
    window.localStorage.setItem('cartularia_audit_events', legacyEvents);
    window.localStorage.setItem('cartularia_audit_receipts', legacyReceipts);
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');

    const { default: App } = await import('../../src/App');
    render(<App />);
    await act(async () => { await Promise.all(observed.journals.map((journal) => journal.ready())); });

    expect(screen.getAllByText(/Démonstration en lecture seule/).length).toBeGreaterThan(0);
    expect(observed.journals).toHaveLength(1);
    expect(observed.journals[0].getEvents()).toEqual([]);
    expect(observed.journals[0].getReceipts()).toEqual([]);
    const isJournalKey = (key: unknown) => /cartularia[_-](?:audit|integrity)/.test(String(key));
    expect(getItem.mock.calls.filter(([key]) => isJournalKey(key))).toEqual([]);
    expect(setItem.mock.calls.filter(([key]) => isJournalKey(key))).toEqual([]);
    expect(removeItem.mock.calls.filter(([key]) => isJournalKey(key))).toEqual([]);
    expect(window.localStorage.getItem('cartularia_audit_events')).toBe(legacyEvents);
    expect(window.localStorage.getItem('cartularia_audit_receipts')).toBe(legacyReceipts);
  });
});
