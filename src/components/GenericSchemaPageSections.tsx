import type { CartularySectionDocument } from '../domain/cartulary.ts';
import type { VerticalSchema } from '../schema/schemaTypes.ts';
import type { CartularyPage } from '../utils/interfaceState.ts';
import { SPECIALIZED_CARTULARY_SECTIONS } from '../features/cartulary/presentation/cartularyPresentationContract.ts';
import type { GenericSectionEdits } from '../features/cartulary/state/useGenericSectionEdits.ts';
import { GenericSchemaSection } from './GenericSchemaSection';
import { schemaSectionsForPage } from '../schema/schemaSections.ts';

interface GenericSchemaPageSectionsProps {
  page: CartularyPage;
  sections: CartularySectionDocument[] | null | undefined;
  schema: VerticalSchema | null | undefined;
  edits: GenericSectionEdits;
  canManage: boolean;
  exclude?: readonly string[];
}

/**
 * Sections d'une page du Cartulaire que le lecteur ne rend pas par un bloc spécialisé.
 * Le composant se rend nul quand le schéma n'apporte rien de plus sur cette page : les
 * Cartulaires existants gardent alors exactement leur présentation.
 */
export const GenericSchemaPageSections = ({ page, sections, schema, edits, canManage, exclude = SPECIALIZED_CARTULARY_SECTIONS }: GenericSchemaPageSectionsProps) => {
  if (!schema || !sections) return null;
  const displayed = schemaSectionsForPage({ sections, schema, page, editing: edits.editing, exclude });
  const editable = canManage && !['media', 'publication'].includes(page)
    && schemaSectionsForPage({ sections, schema, page, editing: true, exclude }).length > 0;
  if (!displayed.length && !editable) return null;
  return (
    <div className="generic-page-sections" data-generic-page={page}>
      {editable && <div className="generic-cartulary__edit-actions">
        {!edits.editing ? <button type="button" className="button button--primary" onClick={edits.start}>Modifier les informations</button>
          : <><button type="button" className="button button--primary" disabled={edits.saving || !edits.hasEdits} onClick={() => void edits.save()}>{edits.saving ? 'Enregistrement en cours…' : 'Enregistrer'}</button><button type="button" className="button button--quiet" disabled={edits.saving} onClick={edits.reset}>Annuler</button><p>Les champs calculés et système restent en lecture seule. Les informations personnelles se gèrent dans le Coffre, séparément. Le profil {schema.schemaId}@{schema.version} est conservé.</p></>}
      </div>}
      {edits.error && <p role="alert">{edits.error}</p>}{edits.notice && <p role="status">{edits.notice}</p>}
      {displayed.map((section) => (
        <GenericSchemaSection key={section.id} section={section} schema={schema} editing={edits.editing} edits={edits.edits} saving={edits.saving} onChange={edits.change} />
      ))}
    </div>
  );
};
