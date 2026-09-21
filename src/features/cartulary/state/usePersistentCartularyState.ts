import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { persistCartulariaJson, readCartulariaImportVersion } from '../../../persistence/localVault';
import type { CartulariaLocalVault } from '../../../persistence/localVault';

type ImportBinaries = Parameters<CartulariaLocalVault['commitImport']>[0]['binaries'];

export interface PersistentCartularySlice<T> {
  value: T;
  persistenceError: string | null;
  replace: Dispatch<SetStateAction<T>>;
  reloadIfPresent: (stateKeys: ReadonlySet<string>) => boolean;
  commitImport: (vault: CartulariaLocalVault, binaries: ImportBinaries, merge: (current: T) => T, restorePreviews: (committed: T, current: T) => T) => Promise<void>;
}

interface PersistentCartularySliceOptions<T> {
  key: string;
  load: () => T;
  reloadKeys?: readonly string[];
  serialize?: (value: T) => unknown;
  shouldPersist?: (value: T) => boolean;
  protectImports?: boolean;
}

export const usePersistentCartularyState = <T,>({
  key,
  load,
  reloadKeys = [key],
  serialize = (value) => value,
  shouldPersist = () => true,
  protectImports = false,
}: PersistentCartularySliceOptions<T>): PersistentCartularySlice<T> => {
  const optionsRef = useRef({ load, reloadKeys, serialize, shouldPersist });
  optionsRef.current = { load, reloadKeys, serialize, shouldPersist };
  // Read the guard before the displayed data: a simultaneous projection may
  // cause a conservative conflict, never an old list stamped with a new guard.
  const [initial] = useState(() => ({ importVersion: protectImports ? readCartulariaImportVersion(key) : null, value: load() }));
  const [value, setValue] = useState<T>(initial.value);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const importVersionRef = useRef(initial.importVersion);
  const currentRef = useRef(value);
  const persistedRef = useRef<T | undefined>(undefined);
  const importingRef = useRef(false);
  const queuedRef = useRef<SetStateAction<T>[]>([]);
  const mountedRef = useRef(true);
  const saveSequence = useRef(0);
  const pendingSaveRef = useRef(Promise.resolve());

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; queuedRef.current = []; };
  }, []);

  const replace = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    if (!mountedRef.current) return;
    if (importingRef.current) { queuedRef.current.push(next); return; }
    currentRef.current = typeof next === 'function' ? (next as (current: T) => T)(currentRef.current) : next;
    setValue(currentRef.current);
  }, []);

  useEffect(() => {
    const options = optionsRef.current;
    if (importingRef.current || value !== currentRef.current || value === persistedRef.current || !options.shouldPersist(value)) return;
    persistedRef.current = value;
    const sequence = ++saveSequence.current;
    let saved: Promise<void>;
    try {
      saved = protectImports
        ? persistCartulariaJson(key, options.serialize(value), { expectedImportVersion: importVersionRef.current })
        : persistCartulariaJson(key, options.serialize(value));
    } catch (error) { saved = Promise.reject(error); }
    pendingSaveRef.current = saved;
    void saved.then(() => {
      if (mountedRef.current && sequence === saveSequence.current) setPersistenceError(null);
    }).catch((error: unknown) => {
      if (mountedRef.current && sequence === saveSequence.current) {
        persistedRef.current = undefined;
        setPersistenceError(error instanceof Error ? error.message : 'Enregistrement local impossible.');
      }
      console.error(`Persistance impossible pour ${key}`, error);
    });
  }, [key, value, protectImports]);

  const reloadIfPresent = useCallback((stateKeys: ReadonlySet<string>) => {
    if (!optionsRef.current.reloadKeys.some((reloadKey) => stateKeys.has(reloadKey))) return false;
    replace(() => {
      if (protectImports) importVersionRef.current = readCartulariaImportVersion(key);
      return optionsRef.current.load();
    });
    return true;
  }, [replace, key, protectImports]);

  const commitImport = useCallback<PersistentCartularySlice<T>['commitImport']>(async (vault, binaries, merge, restorePreviews) => {
    vault.assertAccessible();
    if (!mountedRef.current || importingRef.current) throw new Error('Un import est déjà en cours ou la page a été fermée.');
    importingRef.current = true;
    try {
      // Flush an edit made in this same event before the effect has had time to run.
      const current = currentRef.current;
      await pendingSaveRef.current;
      if (current !== persistedRef.current && optionsRef.current.shouldPersist(current)) {
        await vault.writeJson(key, optionsRef.current.serialize(current), { expectedImportVersion: importVersionRef.current });
        persistedRef.current = current;
      }
      vault.assertAccessible();
      if (!mountedRef.current) throw new Error('La page a été fermée avant l’import.');
      const record = await vault.commitImport({ key, binaries, update: (raw) => {
        const latest = raw === null ? current : JSON.parse(raw) as T;
        return JSON.stringify(optionsRef.current.serialize(merge(latest)));
      } });
      // A successful durable commit remains successful if the session closes just afterwards.
      if (!mountedRef.current || !vault.isAccessible) return;
      const committed = restorePreviews(JSON.parse(record.value!) as T, currentRef.current);
      importVersionRef.current = record.localImportVersion ?? null;
      currentRef.current = committed;
      persistedRef.current = committed; // Already stored atomically; never write an old UI snapshot back.
      pendingSaveRef.current = Promise.resolve();
      saveSequence.current += 1;
      setPersistenceError(null);
      setValue(committed);
    } finally {
      importingRef.current = false;
      const queued = queuedRef.current.splice(0);
      if (mountedRef.current && vault.isAccessible) queued.forEach(replace);
    }
  }, [key, replace]);

  return { value, persistenceError, replace, reloadIfPresent, commitImport };
};
