import type { PrivateCartularySnapshot } from '../services/cartularies.ts';
import type { VerticalSchema } from '../schema/schemaTypes.ts';
import { buildGenericFieldRows, formatGenericValue } from '../schema/fieldPresentation.ts';
import { BrandLogo } from './BrandLogo';

interface GenericCartularyViewProps {
  snapshot: PrivateCartularySnapshot;
  schema: VerticalSchema;
  returnHref?: string | null;
}

export const GenericCartularyView = ({ snapshot, schema, returnHref }: GenericCartularyViewProps) => {
  const ownershipSectionId = 'cover.ownership_history';
  const exposesOwnershipHistory = schema.sections.includes(ownershipSectionId);
  const hasOwnershipSection = snapshot.sections.some((section) => section.schemaSectionId === ownershipSectionId);
  const sections = exposesOwnershipHistory && !hasOwnershipSection
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
    : snapshot.sections;

  return (
    <div className="generic-cartulary">
    {returnHref && <a className="generic-cartulary__return" href={returnHref}>← Retour au Registre</a>}
    <header className="generic-cartulary__header">
      <BrandLogo />
      <div>
        <span className="eyebrow">Cartulaire multi-actifs · {snapshot.envelope.publicCode}</span>
        <h1>{snapshot.envelope.displayTitle}</h1>
        <p>{snapshot.envelope.makerName} · {snapshot.envelope.modelName}</p>
      </div>
      <div className="generic-cartulary__badges">
        <span>{snapshot.envelope.assetType}</span>
        <span>{schema.schemaId}@{schema.version}</span>
        <span>{snapshot.envelope.lifecycleStatus}</span>
      </div>
    </header>

    <main className="generic-cartulary__sections">
      {sections.map((section) => {
        const rows = buildGenericFieldRows(section, schema);
        return (
          <section key={section.id} className="generic-section">
            <header>
              <div>
                <span className="eyebrow">{section.schemaSectionId}</span>
                <h2>{section.title}</h2>
              </div>
              <span className="generic-section__status">{section.status}</span>
            </header>
            {rows.length ? (
              <dl className="generic-field-list">
                {rows.map((row) => (
                  <div key={`${row.source}:${row.fieldId}`} className={!row.knownBySchema ? 'is-unknown' : undefined}>
                    <dt>
                      {row.label}
                      {!row.knownBySchema && <small>Fallback générique</small>}
                    </dt>
                    <dd>{formatGenericValue(row.value)}</dd>
                    <span>{row.proofStatus ?? 'sans statut'} · {row.visibility ?? section.visibility}</span>
                  </div>
                ))}
              </dl>
            ) : <p className="generic-section__empty">Aucune valeur dans cette section.</p>}
          </section>
        );
      })}
    </main>
    </div>
  );
};
