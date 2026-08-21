import { useEffect, useState } from 'react';
import { loadPrivateCartulary, type PrivateCartularySnapshot } from '../services/cartularies.ts';
import { loadVerticalSchema } from '../services/schemaCatalog.ts';
import type { VerticalSchema } from '../schema/schemaTypes.ts';
import { isRegistryReturnPath } from '../features/registry/registryCatalog.ts';
import { GenericCartularyView } from './GenericCartularyView';

export const GenericCartularyPage = () => {
  const parameters = new URLSearchParams(window.location.search);
  const cartularyId = parameters.get('cartularyId');
  const returnToParameter = parameters.get('returnTo');
  const returnTo = isRegistryReturnPath(returnToParameter) ? returnToParameter : '/registry';
  const [snapshot, setSnapshot] = useState<PrivateCartularySnapshot | null>(null);
  const [schema, setSchema] = useState<VerticalSchema | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'denied'>('loading');

  useEffect(() => {
    if (!cartularyId) {
      setStatus('empty');
      return;
    }
    let active = true;
    loadPrivateCartulary(cartularyId)
      .then(async (loadedSnapshot) => {
        if (!loadedSnapshot) return null;
        const loadedSchema = await loadVerticalSchema(
          loadedSnapshot.envelope.schemaId,
          loadedSnapshot.envelope.schemaVersion,
        );
        return loadedSchema ? { loadedSnapshot, loadedSchema } : null;
      })
      .then((loaded) => {
        if (!active) return;
        if (!loaded) {
          setStatus('empty');
          return;
        }
        setSnapshot(loaded.loadedSnapshot);
        setSchema(loaded.loadedSchema);
        setStatus('ready');
      })
      .catch(() => {
        if (active) setStatus('denied');
      });
    return () => {
      active = false;
    };
  }, [cartularyId]);

  if (status === 'ready' && snapshot && schema) {
    return <GenericCartularyView snapshot={snapshot} schema={schema} returnHref={returnTo} />;
  }

  return (
    <main className="generic-cartulary-state">
      <h1>{status === 'loading' ? 'Chargement du Cartulaire' : status === 'denied' ? 'Accès refusé' : 'Cartulaire introuvable'}</h1>
      <p>{status === 'denied'
        ? 'La session ne possède pas la portée nécessaire.'
        : 'Utilisez une session authentifiée et un identifiant de Cartulaire autorisé.'}</p>
    </main>
  );
};
