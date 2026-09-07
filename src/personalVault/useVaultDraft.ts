import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import type { PersonalVaultPayload } from './types';

/** The acknowledgement belongs to the captured snapshot, never to a later edit. */
export function useVaultDraft() {
  const [payload, updatePayload] = useState<PersonalVaultPayload | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const current = useRef<PersonalVaultPayload | null>(null);
  const snapshot = (value: PersonalVaultPayload | null) => value ? JSON.stringify({ ...value, updatedAt: '', codeSyncPending: false }) : null;
  const setPayload = useCallback((next: SetStateAction<PersonalVaultPayload | null>) => {
    const result = typeof next === 'function' ? next(current.current) : next;
    current.current = result;
    updatePayload(result);
  }, []);
  const restore = useCallback((next: PersonalVaultPayload | null, persisted: boolean) => {
    setPayload(next);
    setSavedSnapshot(persisted ? snapshot(next) : null);
  }, [setPayload]);
  const acknowledge = useCallback((saved: PersonalVaultPayload) => {
    setSavedSnapshot(snapshot(saved));
  }, []);
  const dirty = payload !== null && snapshot(payload) !== savedSnapshot;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  return { payload, setPayload, restore, acknowledge, dirty, current };
}
