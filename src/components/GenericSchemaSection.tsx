import type { CartularySectionDocument } from '../domain/cartulary.ts';
import type { VerticalSchema, VerticalSchemaField } from '../schema/schemaTypes.ts';
import { buildGenericFieldRows, formatGenericValue } from '../schema/fieldPresentation.ts';
import { schemaSectionLabel } from '../schema/schemaLabels.ts';
import { genericFieldGroupIsEditable } from '../../scripts/lib/generic-editing-policy.mjs';
import { GenericRepeatedFields } from './GenericRepeatedFields';

export interface GenericSchemaSectionProps {
  section: CartularySectionDocument;
  schema: VerticalSchema;
  editing: boolean;
  edits: Record<string, unknown>;
  saving: boolean;
  onChange: (next: Record<string, unknown>) => void;
}

/** Rendu d'une section pilotée par le schéma : lecture, puis saisie champ par champ en édition. */
export const GenericSchemaSection = ({ section, schema, editing, edits, saving, onChange }: GenericSchemaSectionProps) => {
  const fieldIsEditable = (field: VerticalSchemaField | undefined) => genericFieldGroupIsEditable(field, schema.fields);
  const rows = buildGenericFieldRows(section, schema);
  const repeatedFields = schema.fields.filter((field) => field.sectionId === section.schemaSectionId && field.cardinality === 'repeatable' && fieldIsEditable(field));
  const repeatedGroups = [...new Set(repeatedFields.map((field) => field.fieldId.split('[]')[0]))].map((prefix) => repeatedFields.filter((field) => field.fieldId.split('[]')[0] === prefix));
  if (editing) for (const field of schema.fields.filter((field) => field.sectionId === section.schemaSectionId && fieldIsEditable(field))) {
    if (!rows.some((row) => row.fieldId === field.fieldId)) rows.push({ fieldId: field.fieldId, label: field.label, value: null, proofStatus: null, visibility: 'secret', knownBySchema: true, source: 'fields' });
  }
  return (
    <section className="generic-section">
      <header>
        <div><h2>{schemaSectionLabel(section.schemaSectionId) === section.schemaSectionId ? section.title : schemaSectionLabel(section.schemaSectionId)}</h2></div>
        <span className="generic-section__status">Déclarations à vérifier</span>
      </header>
      {rows.length ? (
        <dl className="generic-field-list">
          {rows.filter((row) => !repeatedFields.some((field) => field.fieldId === row.fieldId)).map((row) => {
            const field = schema.fields.find((candidate) => candidate.fieldId === row.fieldId);
            const value = Object.hasOwn(edits, row.fieldId) ? edits[row.fieldId] : row.value;
            const editable = editing && fieldIsEditable(field);
            const inputId = `generic-field-${row.fieldId}`;
            const change = (next: unknown) => onChange({ [row.fieldId]: next });
            return (
            <div key={`${row.source}:${row.fieldId}`} className={!row.knownBySchema ? 'is-unknown' : undefined}>
              <dt>{editable ? <label htmlFor={inputId}>{row.label}{field?.required ? ' *' : ''}</label> : row.label}{!row.knownBySchema && <small>Information complémentaire importée</small>}</dt>
              <dd>{!editable ? formatGenericValue(row.value) : field!.dataType === 'boolean' ? <select id={inputId} value={value === null ? '' : String(value)} disabled={saving} onChange={(event) => change(event.target.value === '' ? null : event.target.value === 'true')}><option value="">Non renseigné</option><option value="true">Oui</option><option value="false">Non</option></select>
                : field!.dataType === 'enum' && field!.allowedValues?.length ? <select id={inputId} value={String(value ?? '')} disabled={saving} onChange={(event) => change(event.target.value)}><option value="">Non renseigné</option>{field!.allowedValues.map((option) => <option key={option}>{option}</option>)}</select>
                : field!.dataType === 'money' ? <div><input id={inputId} type="number" min="0" step="any" disabled={saving} value={String((value as { amount?: number })?.amount ?? '')} onChange={(event) => change(event.target.value === '' ? null : { amount: Number(event.target.value), currency: (value as { currency?: string })?.currency || 'EUR' })} /><span>{(value as { currency?: string })?.currency || 'EUR'}</span></div>
                : field!.dataType === 'long_text' ? <textarea id={inputId} value={String(value ?? '')} disabled={saving} maxLength={10000} onChange={(event) => change(event.target.value)} />
                : <input id={inputId} type={['number', 'percentage'].includes(field!.dataType) ? 'number' : field!.dataType === 'date' ? 'date' : field!.dataType === 'url' ? 'url' : 'text'} value={String(value ?? '')} disabled={saving} maxLength={1000} onChange={(event) => change(['number', 'percentage'].includes(field!.dataType) ? event.target.value === '' ? null : Number(event.target.value) : event.target.value)} />}</dd>
              <span>{editable ? 'Déclaration privée · validation à l’enregistrement' : 'Donnée privée · provenance conservée'}</span>
            </div>
          ); })}
        </dl>
      ) : <p className="generic-section__empty">Aucune valeur dans cette section.</p>}
      {repeatedGroups.map((fields) => <GenericRepeatedFields key={fields[0].fieldId} fields={fields} values={Object.fromEntries(fields.map((field) => [field.fieldId, Object.hasOwn(edits, field.fieldId) ? edits[field.fieldId] : rows.find((row) => row.fieldId === field.fieldId)?.value]))} editing={editing} busy={saving} onChange={onChange} />)}
      {editing && schema.fields.some((field) => field.sectionId === section.schemaSectionId && field.cardinality === 'repeatable' && !fieldIsEditable(field)) && <p>Les listes contenant des pièces jointes, des montants composés ou des informations personnelles restent en lecture seule dans cet écran. Leurs données existantes sont conservées.</p>}
    </section>
  );
};
