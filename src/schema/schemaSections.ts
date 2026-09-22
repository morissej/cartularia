import type { CartularySectionDocument } from '../domain/cartulary.ts';
import type { VerticalSchema } from './schemaTypes.ts';
import { schemaSectionLabel } from './schemaLabels.ts';
import { genericFieldGroupIsEditable } from '../../scripts/lib/generic-editing-policy.mjs';
import { cartularyPageForSchemaSection } from '../features/cartulary/presentation/cartularyPresentationContract.ts';
import type { CartularyPage } from '../utils/interfaceState.ts';

export const emptySchemaSection = (schema: Pick<VerticalSchema, 'schemaId' | 'version'>, schemaSectionId: string, id = schemaSectionId, title = schemaSectionLabel(schemaSectionId)): CartularySectionDocument => ({
  id, schemaSectionId, schemaVersion: `${schema.schemaId}@${schema.version}`, title, visibility: 'secret', status: 'imported_unreviewed', fields: {}, revision: 1,
});

/**
 * Sections d'une page : celles déjà enregistrées, puis, en édition, les sections du schéma encore
 * vides qui contiennent au moins un champ modifiable. Même règle pour tous les lecteurs.
 */
export const schemaSectionsForPage = ({ sections, schema, page, editing, exclude = [] }: {
  sections: CartularySectionDocument[];
  schema: VerticalSchema;
  page: CartularyPage;
  editing: boolean;
  /** Sections déjà rendues par un bloc spécialisé du lecteur : elles ne sont pas répétées en générique. */
  exclude?: readonly string[];
}): CartularySectionDocument[] => {
  const excluded = new Set(exclude);
  // Une section que le schéma ne connaît plus et qui n'est pas cartographiée (données personnelles
  // déplacées vers le Coffre lors d'une remontée de schéma, ADR-031) n'est pas réaffichée.
  const superseded = (section: CartularySectionDocument) => Boolean(section.retiredFromSchema);
  const stored = sections.filter((section) => !excluded.has(section.schemaSectionId) && !superseded(section) && cartularyPageForSchemaSection(section.schemaSectionId) === page);
  const editable = editing
    ? schema.sections
      .filter((id) => !excluded.has(id) && cartularyPageForSchemaSection(id) === page
        && !sections.some((section) => section.schemaSectionId === id)
        && schema.fields.some((field) => field.sectionId === id && genericFieldGroupIsEditable(field, schema.fields)))
      .map((id) => emptySchemaSection(schema, id))
    : [];
  return [...stored, ...editable];
};

