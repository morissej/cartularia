import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { persistCartulariaJson } from '../../../persistence/localVault';

export interface PersistentCartularySlice<T> {
  value: T;
  replace: Dispatch<SetStateAction<T>>;
  reloadIfPresent: (stateKeys: ReadonlySet<string>) => boolean;
}

interface PersistentCartularySliceOptions<T> {
  key: string;
  load: () => T;
  reloadKeys?: readonly string[];
  serialize?: (value: T) => unknown;
  shouldPersist?: (value: T) => boolean;
}

export const usePersistentCartularyState = <T,>({
  key,
  load,
  reloadKeys = [key],
  serialize = (value) => value,
  shouldPersist = () => true,
}: PersistentCartularySliceOptions<T>): PersistentCartularySlice<T> => {
  const optionsRef = useRef({ load, reloadKeys, serialize, shouldPersist });
  optionsRef.current = { load, reloadKeys, serialize, shouldPersist };
  const [value, replace] = useState<T>(load);

  useEffect(() => {
    const options = optionsRef.current;
    if (!options.shouldPersist(value)) return;
    void persistCartulariaJson(key, options.serialize(value)).catch((error: unknown) => {
      console.error(`Persistance impossible pour ${key}`, error);
    });
  }, [key, value]);

  const reloadIfPresent = useCallback((stateKeys: ReadonlySet<string>) => {
    if (!optionsRef.current.reloadKeys.some((reloadKey) => stateKeys.has(reloadKey))) return false;
    replace(optionsRef.current.load());
    return true;
  }, []);

  return { value, replace, reloadIfPresent };
};
