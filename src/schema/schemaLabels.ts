import { CAR_SCHEMA } from './carSchema.ts';
import { WATCH_SCHEMA } from './watchSchema.ts';

const labels = new Map([...WATCH_SCHEMA.fields, ...CAR_SCHEMA.fields].map((field) => [field.fieldId, field.label]));
export const schemaFieldLabel = (fieldId: string) => labels.get(fieldId) || 'Information complémentaire';
const sections: Record<string, string> = {
  'cover.car': 'Identité de l’objet', 'cover.asset': 'Type de bien', 'cover.privacy_link': 'Codes de correspondance',
  'identity.private': 'Identité confidentielle', 'technical.powertrain': 'Moteur et transmission', 'technical.chassis': 'Châssis et carrosserie',
  'usage.current': 'Utilisation et contrôle technique', 'condition.current': 'État de l’objet', 'history.service': 'Historique d’entretien',
  'history.incidents': 'Historique des incidents', 'media.library': 'Bibliothèque de médias', 'value.market': 'Analyse du marché',
  'value.retained': 'Valeur retenue', 'value.provenance': 'Provenance', 'publishing.selection': 'Sélection de publication',
};
export const schemaSectionLabel = (sectionId: string) => sections[sectionId] || sectionId;
