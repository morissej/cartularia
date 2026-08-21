import { useEffect, useMemo, useState } from 'react';
import type { PrivateCartularySnapshot } from '../services/cartularies.ts';
import type { VerticalSchema } from '../schema/schemaTypes.ts';
import { buildGenericFieldRows, formatGenericValue } from '../schema/fieldPresentation.ts';
import {
  CARTULARY_PRESENTATION_CONTRACT_VERSION,
  COMMON_CARTULARY_STRUCTURE,
  cartularyPageDefinitions,
  cartularyPageForSchemaSection,
} from '../features/cartulary/presentation/cartularyPresentationContract.ts';
import { cartularyPageFromHash, type CartularyPage } from '../utils/interfaceState.ts';
import { BrandLogo } from './BrandLogo';

interface GenericCartularyViewProps {
  snapshot: PrivateCartularySnapshot;
  schema: VerticalSchema;
  returnHref?: string | null;
}

export const GenericCartularyView = ({ snapshot, schema, returnHref }: GenericCartularyViewProps) => {
  const [activePage, setActivePage] = useState<CartularyPage>(() => cartularyPageFromHash(window.location.hash));
  const pages = cartularyPageDefinitions('FR');
  const ownershipSectionId = 'cover.ownership_history';
  const exposesOwnershipHistory = schema.sections.includes(ownershipSectionId);
  const hasOwnershipSection = snapshot.sections.some((section) => section.schemaSectionId === ownershipSectionId);
  const sections = useMemo(() => exposesOwnershipHistory && !hasOwnershipSection
    ? [{
        id: 'ownership.history',
        schemaSectionId: ownershipSectionId,
        schemaVersion: `${schema.schemaId}@${schema.version}`,
        title: "Historique de l'objet - Propriétaires précédents",
        visibility: 'secret' as const,
        status: 'imported_unreviewed' as const,
        fields: {},
        revision: 1 as const,
      }, ...snapshot.sections]
    : snapshot.sections, [exposesOwnershipHistory, hasOwnershipSection, schema.schemaId, schema.version, snapshot.sections]);

  useEffect(() => {
    const updatePage = () => setActivePage(cartularyPageFromHash(window.location.hash));
    window.addEventListener('hashchange', updatePage);
    return () => window.removeEventListener('hashchange', updatePage);
  }, []);

  const visibleSections = useMemo(() => sections.filter((section) => (
    cartularyPageForSchemaSection(section.schemaSectionId) === activePage
  )), [activePage, sections]);
  const missingCommonSections = COMMON_CARTULARY_STRUCTURE.filter((definition) => (
    definition.page === activePage
    && !sections.some((section) => section.schemaSectionId === definition.id)
  ));

  const navigateTo = (page: CartularyPage) => {
    window.location.hash = page;
    setActivePage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="generic-cartulary" data-cartulary-presentation-version={CARTULARY_PRESENTATION_CONTRACT_VERSION}>
      {returnHref && <a className="generic-cartulary__return" href={returnHref}>← Retour au Registre</a>}
      <header className="generic-cartulary__header">
        <BrandLogo />
        <div>
          <span className="eyebrow">Cartulaire multi-actifs · {snapshot.envelope.publicCode}</span>
          <h1>{snapshot.envelope.displayTitle}</h1>
          <p>{snapshot.envelope.makerName} · {snapshot.envelope.modelName}</p>
        </div>
        <div className="generic-cartulary__badges">
          <span>{snapshot.envelope.collectionId}</span>
          <span>{snapshot.envelope.assetType}</span>
          <span>{schema.schemaId}@{schema.version}</span>
          <span>{snapshot.envelope.lifecycleStatus}</span>
        </div>
      </header>

      <nav className="generic-cartulary__tabs" aria-label="Pages du Cartulaire">
        {pages.map((page) => (
          <button type="button" key={page.id} className={activePage === page.id ? 'is-active' : undefined} onClick={() => navigateTo(page.id)} aria-current={activePage === page.id ? 'page' : undefined}>
            <span>{page.number}</span>{page.label}
          </button>
        ))}
      </nav>

      <main className="generic-cartulary__sections">
        {activePage === 'cover' && (
          <section className="generic-section generic-section--common">
            <header><div><span className="eyebrow">Structure commune</span><h2>Collection</h2></div></header>
            <dl className="generic-field-list"><div><dt>Collection</dt><dd>{snapshot.envelope.collectionId}</dd><span>Secret · Cartulaire</span></div></dl>
          </section>
        )}
        {visibleSections.map((section) => {
          const rows = buildGenericFieldRows(section, schema);
          return (
            <section key={section.id} className="generic-section">
              <header>
                <div><span className="eyebrow">{section.schemaSectionId}</span><h2>{section.title}</h2></div>
                <span className="generic-section__status">{section.status}</span>
              </header>
              {rows.length ? (
                <dl className="generic-field-list">
                  {rows.map((row) => (
                    <div key={`${row.source}:${row.fieldId}`} className={!row.knownBySchema ? 'is-unknown' : undefined}>
                      <dt>{row.label}{!row.knownBySchema && <small>Fallback générique</small>}</dt>
                      <dd>{formatGenericValue(row.value)}</dd>
                      <span>{row.proofStatus ?? 'sans statut'} · {row.visibility ?? section.visibility}</span>
                    </div>
                  ))}
                </dl>
              ) : <p className="generic-section__empty">Aucune valeur dans cette section.</p>}
            </section>
          );
        })}
        {missingCommonSections.filter((definition) => definition.id !== 'cover.collection').map((definition) => (
          <section key={definition.id} className="generic-section generic-section--common">
            <header><div><span className="eyebrow">Structure commune</span><h2>{definition.title}</h2></div></header>
            <p className="generic-section__empty">Aucune donnée enregistrée.</p>
          </section>
        ))}
        {visibleSections.length === 0 && missingCommonSections.length === 0 && activePage !== 'cover' && (
          <section className="generic-section generic-section--common"><p className="generic-section__empty">Aucune donnée enregistrée sur cette page.</p></section>
        )}
      </main>
    </div>
  );
};
