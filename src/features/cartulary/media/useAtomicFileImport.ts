import { useCallback, useEffect, useRef, useState } from 'react';
import type { CartulariaLocalVault } from '../../../persistence/localVault';
import type { PreparedImport } from './importMediaFiles';

/** One in-flight form operation; each successful preview is owned until the page closes. */
export const useAtomicFileImport = (options: {
  vault: CartulariaLocalVault | null;
  enabled: boolean;
  onError: (message: string | null) => void;
}) => {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const activeRef = useRef(true);
  const runningRef = useRef(false);
  const previewsRef = useRef(new Set<() => void>());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    activeRef.current = true;
    const previews = previewsRef.current;
    return () => {
      activeRef.current = false;
      previews.forEach((dispose) => dispose());
      previews.clear();
    };
  }, []);

  const run = useCallback(async <T,>(
    prepare: () => Promise<PreparedImport<T>>,
    commit: (vault: CartulariaLocalVault, prepared: PreparedImport<T>) => Promise<void>,
  ): Promise<boolean> => {
    if (runningRef.current || !activeRef.current || !optionsRef.current.enabled) return false;
    const { vault, onError } = optionsRef.current;
    onError(null);
    if (!vault) { onError('Le cache privé est verrouillé. Rouvrez votre session avant l’import.'); return false; }
    runningRef.current = true; // Synchronous: also blocks two submissions in the same event loop turn.
    setBusy(true);
    let prepared: PreparedImport<T> | undefined;
    const stillActive = () => activeRef.current && optionsRef.current.vault === vault && vault.isAccessible;
    try {
      vault.assertAccessible();
      prepared = await prepare();
      vault.assertAccessible();
      if (!stillActive() || !optionsRef.current.enabled) return false;
      await commit(vault, prepared);
      if (stillActive()) {
        previewsRef.current.add(prepared.dispose);
        prepared = undefined;
        return true;
      }
      // References and originals are durable, but this page no longer owns a preview.
      return false;
    } catch (error) {
      if (stillActive()) onError(`${error instanceof Error ? error.message : 'Import refusé.'} Aucun fichier du lot n’a été ajouté.`);
      return false;
    } finally {
      prepared?.dispose();
      runningRef.current = false;
      if (activeRef.current) setBusy(false);
    }
  }, []);

  return { busy, run };
};
