import { useEffect, useMemo, useState } from 'react';
import type { RegistryItemProjection, RegistryValuationItemProjection } from '../../domain/projections.ts';
import { buildCurrentRegistryValuation } from '../../domain/currentRegistryValuation.ts';
import { observeRegistryValuationItems } from '../../services/registryValuation.ts';

type LoadState = 'loading' | 'ready' | 'error';

export function useCurrentRegistryValuation(
  registryId: string,
  referenceCurrency: string,
  items: RegistryItemProjection[],
  inventoryState: LoadState,
  allowed: boolean,
  attempt = 0,
) {
  const [value, setValue] = useState<{ registryId: string; state: LoadState; items: RegistryValuationItemProjection[] }>({ registryId, state: 'loading', items: [] });
  useEffect(() => {
    setValue({ registryId, state: 'loading', items: [] });
    if (!allowed) return;
    let active = true;
    const unsubscribe = observeRegistryValuationItems(registryId,
      (next) => { if (active) setValue({ registryId, state: 'ready', items: next }); },
      () => { if (active) setValue({ registryId, state: 'error', items: [] }); });
    return () => { active = false; unsubscribe(); };
  }, [allowed, registryId, attempt]);
  const state: LoadState = !allowed || value.registryId !== registryId ? 'loading'
    : inventoryState === 'error' || value.state === 'error' ? 'error'
      : inventoryState === 'ready' && value.state === 'ready' ? 'ready' : 'loading';
  const summary = useMemo(() => state === 'ready'
    ? buildCurrentRegistryValuation(items, value.items, registryId, referenceCurrency) : null,
  [state, items, value.items, registryId, referenceCurrency]);
  return { state, summary };
}
