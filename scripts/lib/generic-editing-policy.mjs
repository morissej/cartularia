// Shared by the generic form and the deployed authoritative command. System-generated
// metadata, publication consent and personal-vault fields have dedicated flows.
export const genericFieldIsEditable = (field) => Boolean(field
  && ['single', 'repeatable'].includes(field.cardinality)
  && (field.cardinality !== 'repeatable' || (field.fieldId.includes('[]') && field.dataType !== 'money'))
  && ['text', 'long_text', 'date', 'number', 'money', 'percentage', 'enum', 'url', 'boolean'].includes(field.dataType)
  && !/^(cover\.asset|cover\.privacy|cover\.ownership|condition\.(storage|transmission)|publishing\.|publication\.|media\.)/.test(field.fieldId));

// Repeated columns are one atomic row group. Do not offer a partial editor when
// a sibling needs a dedicated file, money or personal-data workflow.
export const genericFieldGroupIsEditable = (field, fields) => genericFieldIsEditable(field)
  && (field.cardinality !== 'repeatable' || fields.filter((candidate) => candidate.fieldId.split('[]')[0] === field.fieldId.split('[]')[0])
    .every(genericFieldIsEditable));

export function validateGenericFieldValue(field, value) {
  if (!genericFieldIsEditable(field)) throw new Error('Ce champ utilise un parcours dédié et ne peut pas être modifié ici.');
  if (field.cardinality === 'repeatable') {
    if (!Array.isArray(value) || value.length > 100 || (field.required && !value.length)) throw new Error(`Liste invalide pour ${field.label} (100 lignes maximum).`);
    return value.map((item) => validateGenericFieldValue({ ...field, cardinality: 'single' }, item));
  }
  if (value === null || value === '') {
    if (field.required) throw new Error(`${field.label} est requis.`);
    return null;
  }
  const invalid = () => { throw new Error(`Valeur invalide pour ${field.label}.`); };
  if (field.dataType === 'boolean') { if (typeof value !== 'boolean') invalid(); return value; }
  if (['number', 'percentage'].includes(field.dataType)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) invalid();
    if (field.fieldId === 'cover.car.year' && (!Number.isInteger(value) || value < 1886 || value > new Date().getFullYear() + 1)) invalid();
    if (field.fieldId === 'usage.mileage.valueKm' && !Number.isInteger(value)) invalid();
    if (field.dataType === 'percentage' && value > 100) invalid();
    return value;
  }
  if (field.dataType === 'money') {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !['amount', 'currency'].includes(key))
      || typeof value.amount !== 'number' || !Number.isFinite(value.amount) || value.amount < 0 || !/^[A-Z]{3}$/.test(value.currency)) invalid();
    return { amount: value.amount, currency: value.currency };
  }
  if (typeof value !== 'string' || value.length > (field.dataType === 'long_text' ? 10000 : 1000)) invalid();
  const normalized = value.trim();
  if (field.required && !normalized) invalid();
  if (field.dataType === 'enum' && field.allowedValues?.length && !field.allowedValues.includes(normalized)) invalid();
  if (field.dataType === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(normalized)) || new Date(normalized).toISOString().slice(0, 10) !== normalized)) invalid();
  if (field.dataType === 'url') { try { if (!['http:', 'https:'].includes(new URL(normalized).protocol)) invalid(); } catch { invalid(); } }
  return normalized;
}
