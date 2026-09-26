import { useEffect, useState } from 'react';
import type { RegistryValuationSnapshot } from '../../domain/projections.ts';
import { observeRegistryValuationSnapshots } from '../../services/registryValuation.ts';

export function useLatestValuationSnapshot(registryId: string, allowed: boolean, attempt = 0) {
  const [value, setValue] = useState<{ registryId: string; state: 'loading' | 'ready' | 'error'; snapshot: RegistryValuationSnapshot | null }>({ registryId, state: 'loading', snapshot: null });
  useEffect(() => {
    setValue({ registryId, state: 'loading', snapshot: null });
    if (!allowed) return;
    let active = true;
    const unsubscribe = observeRegistryValuationSnapshots(registryId,
      (snapshots) => { if (active) setValue({ registryId, state: 'ready', snapshot: snapshots[0] ?? null }); },
      () => { if (active) setValue({ registryId, state: 'error', snapshot: null }); });
    return () => { active = false; unsubscribe(); };
  }, [allowed, registryId, attempt]);
  return allowed && value.registryId === registryId ? value : { registryId, state: 'loading' as const, snapshot: null };
}
