import type {
  AIFieldCardinality,
  AIFieldDataType,
  AIFieldSourceKind,
} from '../ai/fieldCatalog.ts';
import {
  defineVerticalSchema,
  publishTargetsFor,
  type SchemaVisibility,
  type VerticalSchemaField,
} from './schemaTypes.ts';

export const CAR_SCHEMA_ID = 'car';
export const CAR_SCHEMA_VERSION = '1.0.0';

interface CarFieldDefinition {
  fieldId: string;
  sectionId: string;
  label: string;
  dataType: AIFieldDataType;
  cardinality?: AIFieldCardinality;
  required?: boolean;
  visibility?: SchemaVisibility;
  registryFacet?: boolean;
  purpose?: string;
  instructions?: string;
  validation?: string;
  sourcePriority?: readonly AIFieldSourceKind[];
  aiWritable?: boolean;
  humanReviewRequired?: boolean;
  allowedValues?: readonly string[];
  examples?: readonly string[];
  dependencies?: readonly string[];
}

const carField = (definition: CarFieldDefinition): VerticalSchemaField => {
  const visibility = definition.visibility ?? 'secret';
  return {
    fieldId: definition.fieldId,
    sectionId: definition.sectionId,
    label: definition.label,
    purpose: definition.purpose ?? `Documenter ${definition.label.toLocaleLowerCase('fr-FR')} pour le véhicule.`,
    instructions: definition.instructions ?? 'Renseigner uniquement une valeur confirmée par une source ou une observation identifiée.',
    dataType: definition.dataType,
    cardinality: definition.cardinality ?? 'single',
    required: definition.required ?? false,
    validation: definition.validation ?? 'Valeur cohérente avec le véhicule et sa provenance.',
    defaultVisibility: visibility,
    publishableTo: publishTargetsFor(visibility),
    sourcePriority: definition.sourcePriority ?? ['document', 'manufacturer', 'expert', 'user'],
    aiWritable: definition.aiWritable ?? true,
    humanReviewRequired: definition.humanReviewRequired ?? true,
    registryFacet: definition.registryFacet ?? false,
    ...(definition.allowedValues ? { allowedValues: definition.allowedValues } : {}),
    ...(definition.examples ? { examples: definition.examples } : {}),
    ...(definition.dependencies ? { dependencies: definition.dependencies } : {}),
  };
};

export const CAR_SCHEMA_FIELDS = [
  carField({
    fieldId: 'cover.asset.type', sectionId: 'cover.asset', label: 'Type de bien', dataType: 'enum', required: true,
    visibility: 'public', registryFacet: true, allowedValues: ['Voiture'], sourcePriority: ['user', 'document'],
    aiWritable: false, instructions: 'La valeur doit rester Voiture pour le profil car.',
  }),
  carField({
    fieldId: 'cover.car.maker', sectionId: 'cover.car', label: 'Constructeur', dataType: 'text', required: true,
    visibility: 'public', registryFacet: true, examples: ['Constructeur Démonstration'],
  }),
  carField({
    fieldId: 'cover.car.model', sectionId: 'cover.car', label: 'Modèle', dataType: 'text', required: true,
    visibility: 'public', registryFacet: true,
  }),
  carField({
    fieldId: 'cover.car.version', sectionId: 'cover.car', label: 'Version', dataType: 'text', required: true,
    visibility: 'public', registryFacet: true,
  }),
  carField({
    fieldId: 'cover.car.year', sectionId: 'cover.car', label: 'Année modèle', dataType: 'number', required: true,
    visibility: 'public', registryFacet: true, validation: 'Entier compris entre 1886 et l’année courante plus un.',
  }),
  carField({
    fieldId: 'identity.car.vin', sectionId: 'identity.private', label: 'VIN', dataType: 'text', required: true,
    visibility: 'secret', validation: '17 caractères pour un VIN moderne ; conserver toute exception historique sans normalisation destructive.',
    aiWritable: false,
  }),
  carField({
    fieldId: 'identity.car.registration', sectionId: 'identity.private', label: 'Immatriculation', dataType: 'text',
    visibility: 'secret', sourcePriority: ['document', 'user'], aiWritable: false,
  }),
  carField({
    fieldId: 'technical.engine.architecture', sectionId: 'technical.powertrain', label: 'Architecture moteur', dataType: 'text',
    visibility: 'public', examples: ['6 cylindres en ligne'],
  }),
  carField({
    fieldId: 'technical.engine.displacementCc', sectionId: 'technical.powertrain', label: 'Cylindrée', dataType: 'number',
    visibility: 'public', validation: 'Nombre positif exprimé en cm3.',
  }),
  carField({
    fieldId: 'technical.engine.fuelType', sectionId: 'technical.powertrain', label: 'Énergie', dataType: 'enum',
    visibility: 'public', allowedValues: ['Essence', 'Diesel', 'Hybride', 'Électrique', 'Autre'],
  }),
  carField({
    fieldId: 'technical.engine.powerKw', sectionId: 'technical.powertrain', label: 'Puissance kW', dataType: 'number',
    visibility: 'public', validation: 'Puissance homologuée positive en kW.',
  }),
  carField({
    fieldId: 'technical.engine.powerHp', sectionId: 'technical.powertrain', label: 'Puissance ch', dataType: 'number',
    visibility: 'public', validation: 'Puissance positive ; préciser la convention de cheval utilisée dans la provenance.',
  }),
  carField({
    fieldId: 'technical.transmission.gearbox', sectionId: 'technical.powertrain', label: 'Boîte de vitesses', dataType: 'text',
    visibility: 'public',
  }),
  carField({
    fieldId: 'technical.transmission.drivetrain', sectionId: 'technical.powertrain', label: 'Transmission', dataType: 'enum',
    visibility: 'public', allowedValues: ['Traction', 'Propulsion', 'Intégrale', 'Autre'],
  }),
  carField({
    fieldId: 'technical.chassis.code', sectionId: 'technical.chassis', label: 'Code châssis', dataType: 'text',
    visibility: 'community',
  }),
  carField({
    fieldId: 'technical.chassis.bodyStyle', sectionId: 'technical.chassis', label: 'Carrosserie', dataType: 'text',
    visibility: 'public', examples: ['Coupé'],
  }),
  carField({
    fieldId: 'usage.mileage.valueKm', sectionId: 'usage.current', label: 'Kilométrage', dataType: 'number', required: true,
    visibility: 'secret', validation: 'Entier positif en kilomètres, rattaché à une date et une source.',
  }),
  carField({
    fieldId: 'usage.mileage.observedAt', sectionId: 'usage.current', label: 'Date du kilométrage', dataType: 'date', required: true,
    visibility: 'secret',
  }),
  carField({
    fieldId: 'usage.roadworthiness.status', sectionId: 'usage.current', label: 'Contrôle technique', dataType: 'enum',
    visibility: 'secret', allowedValues: ['Valide', 'À renouveler', 'Non applicable', 'Inconnu'],
  }),
  carField({
    fieldId: 'usage.roadworthiness.expiresAt', sectionId: 'usage.current', label: 'Échéance du contrôle technique', dataType: 'date',
    visibility: 'secret', sourcePriority: ['document', 'user'],
  }),
  carField({
    fieldId: 'condition.body.summary', sectionId: 'condition.current', label: 'État de la carrosserie', dataType: 'long_text',
    visibility: 'community', sourcePriority: ['expert', 'document', 'user'],
  }),
  carField({
    fieldId: 'condition.interior.summary', sectionId: 'condition.current', label: 'État de l’habitacle', dataType: 'long_text',
    visibility: 'community', sourcePriority: ['expert', 'document', 'user'],
  }),
  carField({
    fieldId: 'condition.mechanical.summary', sectionId: 'condition.current', label: 'État mécanique', dataType: 'long_text',
    visibility: 'secret', sourcePriority: ['expert', 'document', 'user'],
  }),
  carField({
    fieldId: 'condition.tires.summary', sectionId: 'condition.current', label: 'État des pneus', dataType: 'long_text',
    visibility: 'secret', sourcePriority: ['expert', 'document', 'user'],
  }),
  carField({
    fieldId: 'condition.corrosion.summary', sectionId: 'condition.current', label: 'Corrosion', dataType: 'long_text',
    visibility: 'secret', sourcePriority: ['expert', 'document', 'user'],
  }),
  carField({
    fieldId: 'condition.overall.conclusion', sectionId: 'condition.current', label: 'Conclusion d’état', dataType: 'long_text', required: true,
    visibility: 'community', sourcePriority: ['expert', 'document', 'user'],
  }),
  carField({
    fieldId: 'history.service[].date', sectionId: 'history.service', label: 'Date d’entretien', dataType: 'date',
    cardinality: 'repeatable', visibility: 'secret', sourcePriority: ['document', 'user'],
  }),
  carField({
    fieldId: 'history.service[].mileageKm', sectionId: 'history.service', label: 'Kilométrage à l’entretien', dataType: 'number',
    cardinality: 'repeatable', visibility: 'secret', sourcePriority: ['document', 'user'],
  }),
  carField({
    fieldId: 'history.service[].kind', sectionId: 'history.service', label: 'Type d’entretien', dataType: 'text',
    cardinality: 'repeatable', visibility: 'secret', sourcePriority: ['document', 'user'],
  }),
  carField({
    fieldId: 'history.service[].description', sectionId: 'history.service', label: 'Description d’entretien', dataType: 'long_text',
    cardinality: 'repeatable', visibility: 'secret', sourcePriority: ['document', 'expert', 'user'],
  }),
  carField({
    fieldId: 'history.incidents[].summary', sectionId: 'history.incidents', label: 'Sinistre ou incident', dataType: 'long_text',
    cardinality: 'repeatable', visibility: 'secret', sourcePriority: ['document', 'expert', 'user'],
  }),
  carField({
    fieldId: 'media.assets[].file', sectionId: 'media.library', label: 'Actif média', dataType: 'file',
    cardinality: 'repeatable', visibility: 'secret', aiWritable: false,
  }),
  carField({
    fieldId: 'media.assets[].name', sectionId: 'media.library', label: 'Nom de l’actif', dataType: 'text', required: true,
    cardinality: 'repeatable', visibility: 'secret', sourcePriority: ['file_metadata', 'user'],
  }),
  carField({
    fieldId: 'media.assets[].tags', sectionId: 'media.library', label: 'Catégories média', dataType: 'media_tags',
    cardinality: 'repeatable', visibility: 'secret',
    allowedValues: ['Extérieur', 'Intérieur', 'Dessous', 'Moteur', 'Vidéo', 'Documents', 'Autre'],
  }),
  carField({
    fieldId: 'media.assets[].hash', sectionId: 'media.library', label: 'Empreinte du média', dataType: 'computed', required: true,
    cardinality: 'computed', visibility: 'secret', sourcePriority: ['calculation'], aiWritable: false,
    humanReviewRequired: false,
  }),
  carField({
    fieldId: 'value.market.analysisDate', sectionId: 'value.market', label: 'Date d’analyse', dataType: 'date', required: true,
    visibility: 'secret', sourcePriority: ['market', 'document', 'user'],
  }),
  carField({
    fieldId: 'value.retained.amount', sectionId: 'value.retained', label: 'Valeur retenue', dataType: 'money', required: true,
    visibility: 'secret', sourcePriority: ['user', 'market'], aiWritable: false,
  }),
  carField({
    fieldId: 'value.retained.explanation', sectionId: 'value.retained', label: 'Explication de la valeur retenue', dataType: 'long_text',
    visibility: 'secret', sourcePriority: ['user', 'market', 'expert'],
  }),
  carField({
    fieldId: 'publishing.blocks.website', sectionId: 'publishing.selection', label: 'Sélection site public', dataType: 'boolean',
    cardinality: 'repeatable', visibility: 'secret', sourcePriority: ['user'], aiWritable: false,
    instructions: 'Décision exclusivement humaine ; l’IA ne peut jamais activer W.',
  }),
  carField({
    fieldId: 'publishing.blocks.report', sectionId: 'publishing.selection', label: 'Sélection rapport', dataType: 'boolean',
    cardinality: 'repeatable', visibility: 'secret', sourcePriority: ['user'], aiWritable: false,
    instructions: 'Décision exclusivement humaine ; l’IA ne peut jamais activer R.',
  }),
] as const;

export type CarFieldId = (typeof CAR_SCHEMA_FIELDS)[number]['fieldId'];

export const CAR_SCHEMA = defineVerticalSchema({
  schemaId: CAR_SCHEMA_ID,
  assetType: 'car',
  version: CAR_SCHEMA_VERSION,
  status: 'baseline',
  fields: CAR_SCHEMA_FIELDS,
});
