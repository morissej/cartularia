import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Filter, Users } from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase.ts';
import type { LoadedCommunityPublication } from '../domain/community.ts';
import { PUBLICATION_BLOCK_CATALOG } from '../domain/publication.ts';
import { loadCommunityCatalog } from '../services/community.ts';
import { formatGenericValue } from '../schema/fieldPresentation.ts';
import { BrandLogo } from './BrandLogo.tsx';

type CommunityState = 'auth-loading' | 'signed-out' | 'loading' | 'ready' | 'denied';

interface LocalCommunityPreview {
  cartularyId: string;
  displayTitle: string;
  makerName: string;
  modelName: string;
  assetType: string;
  blockIds: string[];
  cartularyUrl: string | null;
}

const parseLocalPreview = (search: string): LocalCommunityPreview | null => {
  const parameters = new URLSearchParams(search);
  if (parameters.get('preview') !== 'local') return null;
  const cartularyId = parameters.get('cartularyId') || '';
  const displayTitle = parameters.get('displayTitle') || '';
  if (!cartularyId || !displayTitle) return null;
  return {
    cartularyId,
    displayTitle,
    makerName: parameters.get('makerName') || '',
    modelName: parameters.get('modelName') || '',
    assetType: parameters.get('assetType') || 'other',
    blockIds: [...new Set((parameters.get('blocks') || '').split(',').filter(Boolean))],
    cartularyUrl: parameters.get('cartularyUrl'),
  };
};

const assetTypeLabel = (assetType: string) => assetType === 'watch'
  ? 'Montres'
  : assetType === 'car'
    ? 'Automobiles'
    : assetType || 'Autres objets';

export const CommunityPage = () => {
  const localPreview = useMemo(() => parseLocalPreview(window.location.search), []);
  const [state, setState] = useState<CommunityState>('auth-loading');
  const [catalog, setCatalog] = useState<LoadedCommunityPublication[]>([]);
  const [assetType, setAssetType] = useState('all');

  useEffect(() => onAuthStateChanged(auth, (user) => {
    if (!user) {
      setCatalog([]);
      setState('signed-out');
      return;
    }
    setState('loading');
    loadCommunityCatalog()
      .then((loaded) => {
        setCatalog(loaded);
        setState('ready');
      })
      .catch(() => setState('denied'));
  }), []);

  const assetTypes = [...new Set([
    ...catalog.map(({ publication }) => publication.assetType),
    ...(localPreview ? [localPreview.assetType] : []),
  ].filter(Boolean))].sort();
  const visibleCatalog = catalog.filter(({ publication }) => assetType === 'all' || publication.assetType === assetType);
  const showLocalPreview = localPreview && (assetType === 'all' || localPreview.assetType === assetType);

  if (state !== 'ready') {
    const heading = state === 'denied'
      ? 'Admission au Cercle requise'
      : state === 'signed-out'
        ? 'Connexion au Cercle requise'
        : 'Chargement du Cercle';
    return (
      <main className="community-state">
        <BrandLogo />
        <h1>{heading}</h1>
        <p>Le Cercle agrège uniquement les projections choisies par leurs propriétaires. Il ne lit jamais les Cartulaires maîtres.</p>
        <a className="button button--quiet community-back-link" href="/registry">Retour au Registre</a>
      </main>
    );
  }

  return (
    <div className="community-page catalog-site">
      <header className="community-page__header catalog-site__header">
        <a href="/registry" aria-label="Ouvrir le Registre"><BrandLogo /></a>
        <div>
          <span className="eyebrow">Le Cercle · Cartularia</span>
          <h1>Objets publiés dans Le Cercle</h1>
          <p>Une vue agrégée des Cartulaires publiés, filtrable par type d’objet, sans accès aux dossiers privés.</p>
        </div>
      </header>

      <main className="community-feed catalog-site__main">
        <section className="catalog-site__filters" aria-label="Filtrer Le Cercle par type d’objet">
          <Filter aria-hidden="true" />
          <button type="button" className={assetType === 'all' ? 'is-active' : undefined} onClick={() => setAssetType('all')}>Tous les objets</button>
          {assetTypes.map((type) => <button type="button" className={assetType === type ? 'is-active' : undefined} onClick={() => setAssetType(type)} key={type}>{assetTypeLabel(type)}</button>)}
        </section>

        <section className="community-catalog" aria-label="Cartulaires publiés dans Le Cercle">
          {showLocalPreview && (
            <article className="community-publication-card community-publication-card--preview">
              <span className="eyebrow">Aperçu local · {assetTypeLabel(localPreview.assetType)}</span>
              <h2>{localPreview.displayTitle}</h2>
              <p>{localPreview.makerName} · {localPreview.modelName}</p>
              <div className="community-block-list">
                {localPreview.blockIds.map((blockId) => <span key={blockId}>{PUBLICATION_BLOCK_CATALOG.find((entry) => entry.id === blockId)?.title || blockId}</span>)}
              </div>
              {localPreview.cartularyUrl && <a href={localPreview.cartularyUrl} target="_blank" rel="noreferrer">Voir la publication contrôlée <ExternalLink aria-hidden="true" /></a>}
            </article>
          )}
          {visibleCatalog.map(({ publication, blocks }) => (
            <article className="community-publication-card" key={publication.publicationId}>
              <span className="eyebrow">{assetTypeLabel(publication.assetType)} · projection approuvée</span>
              <h2>{publication.displayTitle}</h2>
              <p>{publication.makerName} · {publication.modelName}</p>
              {blocks.map((block) => (
                <details className="community-block" key={block.blockId}>
                  <summary>{block.title}</summary>
                  <dl>
                    {Object.entries(block.fields).map(([fieldId, value]) => <div key={fieldId}><dt>{fieldId}</dt><dd>{formatGenericValue(value)}</dd></div>)}
                  </dl>
                </details>
              ))}
            </article>
          ))}
          {!showLocalPreview && visibleCatalog.length === 0 && <div className="community-empty"><Users aria-hidden="true" /><h2>Aucun Cartulaire publié pour ce filtre</h2></div>}
        </section>
      </main>
    </div>
  );
};
