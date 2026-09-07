import type { VerticalSchemaField } from '../schema/schemaTypes';

export function GenericRepeatedFields({ fields, values, editing, busy, onChange }: { fields: VerticalSchemaField[]; values: Record<string, unknown>; editing: boolean; busy: boolean; onChange: (edits: Record<string, unknown>) => void }) {
  const count = Math.max(0, ...fields.map((field) => Array.isArray(values[field.fieldId]) ? (values[field.fieldId] as unknown[]).length : 0));
  const arrays = Object.fromEntries(fields.map((field) => [field.fieldId, Array.from({ length: count }, (_, index) => (Array.isArray(values[field.fieldId]) ? (values[field.fieldId] as unknown[])[index] : null) ?? null)]));
  const update = (fieldId: string, index: number, value: unknown) => onChange({ ...arrays, [fieldId]: arrays[fieldId].map((current, row) => row === index ? value : current) });
  return <div className="generic-repeated-fields">
    {!count && <p>Aucune ligne enregistrée.</p>}
    {Array.from({ length: count }, (_, index) => <fieldset key={index}><legend>Ligne {index + 1}</legend>{fields.map((field) => {
      const value = arrays[field.fieldId][index];
      return <label key={field.fieldId}>{field.label}{editing ? field.dataType === 'boolean' ? <select disabled={busy} value={value === null ? '' : String(value)} onChange={(event) => update(field.fieldId, index, event.target.value === '' ? null : event.target.value === 'true')}><option value="">Non renseigné</option><option value="true">Oui</option><option value="false">Non</option></select>
        : field.dataType === 'long_text' ? <textarea disabled={busy} value={String(value ?? '')} onChange={(event) => update(field.fieldId, index, event.target.value)} maxLength={10000} />
        : field.dataType === 'enum' ? <select disabled={busy} value={String(value ?? '')} onChange={(event) => update(field.fieldId, index, event.target.value)}><option value="">Non renseigné</option>{field.allowedValues?.map((choice) => <option key={choice}>{choice}</option>)}</select>
        : <input disabled={busy} type={['number', 'percentage'].includes(field.dataType) ? 'number' : field.dataType === 'date' ? 'date' : 'text'} value={String(value ?? '')} onChange={(event) => update(field.fieldId, index, ['number', 'percentage'].includes(field.dataType) ? event.target.value === '' ? null : Number(event.target.value) : event.target.value)} />
        : <span>{value === null || value === '' ? 'Non renseigné' : typeof value === 'boolean' ? value ? 'Oui' : 'Non' : String(value)}</span>}</label>;
    })}{editing && <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Retirer la ligne ${index + 1} de cette liste ? La modification devra être enregistrée.`)) onChange(Object.fromEntries(fields.map((field) => [field.fieldId, arrays[field.fieldId].filter((_, row) => row !== index)]))); }}>Retirer la ligne {index + 1}</button>}</fieldset>)}
    {editing && <button type="button" disabled={busy || count >= 100} onClick={() => onChange(Object.fromEntries(fields.map((field) => [field.fieldId, [...arrays[field.fieldId], null]])))}>Ajouter une ligne</button>}
  </div>;
}
