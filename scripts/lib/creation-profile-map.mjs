/**
 * Table de création par verticale (ADR-030), partagée par le client (libellés, types proposés)
 * et la fonction serveur (`buildCreationBundle`). Elle ne porte aucune version de schéma : la
 * version de création est résolue dans le catalogue (`schemaCatalog/{schemaId}`, version active
 * ou, à défaut, dernière version publiée). Le test `creation-profile-map.test.mjs` vérifie que
 * chaque section et chaque champ cités existent dans l'artefact publié correspondant.
 *
 * Valeurs d'un champ :
 *   { from: 'brand' }                       texte du profil, émis s'il est non vide
 *   { from: 'manufactureYear', as: 'year' } entier du profil (émis s'il est présent)
 *   { from: …, as: 'yearString' }           idem, converti en texte
 *   { from: 'purchasePrice', as: 'money' }  { amount, currency } avec la devise du profil
 *   { from: 'description', as: 'paragraph' } tableau d'un paragraphe
 *   { literal: 'Montre' }                   valeur constante, toujours émise
 *   { pairs: [...], part: 'label'|'value' } listes parallèles libellé / valeur, toujours émises
 * Une section n'est produite que si l'une des clés de `when` est présente dans le profil.
 * `foldInto` fusionne les extensions de la section dans une autre section, si celle-ci existe.
 */

const SPECIFICATION_PAIRS = [
  { from: 'manufactureYear', as: 'yearString', label: 'Année de fabrication' },
  { from: 'caliber', label: 'Calibre' },
];

export const CREATION_PROFILE_DEFINITIONS = {
  watch: {
    schemaId: 'watch',
    label: 'Montre',
    assetTypeValue: 'Montre',
    makerLabel: 'Marque',
    referenceLabel: 'Référence',
    serialLabel: 'Numéro de série',
    technicalLabel: 'Calibre',
    minYear: 1500,
    requires: [],
    sections: [
      { id: 'identity.summary', schemaSectionId: 'cover.watch', title: 'Identité de l’objet', fields: {
        'cover.asset.type': { literal: 'Montre' },
        'cover.watch.brand': { from: 'brand' },
        'cover.watch.model': { from: 'model' },
        'cover.watch.reference': { from: 'reference' },
        'cover.watch.status': { literal: 'Patrimonial' },
      } },
      { id: 'ownership.history', schemaSectionId: 'cover.ownership_history', title: "Historique de l'objet - Propriétaires précédents", fields: {} },
      { id: 'watch.reference', schemaSectionId: 'reference.specifications', title: 'Spécifications de référence', fields: {
        'reference.specifications[].label': { pairs: SPECIFICATION_PAIRS, part: 'label' },
        'reference.specifications[].value': { pairs: SPECIFICATION_PAIRS, part: 'value' },
      } },
      { id: 'watch.instance.private', schemaSectionId: 'watch.instance.private', title: 'Identité confidentielle de l’exemplaire', status: 'imported_unmapped', fields: {}, extensions: {
        'watch.serialNumber': { from: 'serialNumber' },
      } },
      { id: 'condition.description', schemaSectionId: 'condition.description', title: 'Description de l’objet', when: ['description'], fields: {
        'condition.description.paragraphs[]': { from: 'description', as: 'paragraph' },
      } },
      { id: 'condition.summary', schemaSectionId: 'condition.summary', title: 'État déclaré', when: ['conditionSummary'], fields: {
        'condition.summary.paragraphs[]': { from: 'conditionSummary', as: 'paragraph' },
        'condition.summary.conclusion': { literal: 'État déclaré lors de la création ; revue humaine requise.' },
        'condition.summary.openPoint': { literal: 'Authenticité, configuration et état à confirmer à partir des pièces versées.' },
      } },
      { id: 'value.purchase', schemaSectionId: 'value.cost_basis', title: 'Acquisition', when: ['purchaseDate', 'purchasePrice'], fields: {
        'value.purchase.date': { from: 'purchaseDate' },
        'value.purchase.price': { from: 'purchasePrice', as: 'money' },
      }, extensions: {
        'value.purchase.seller': { from: 'seller' },
      } },
      { id: 'value.market-depth', schemaSectionId: 'value.market_depth', title: 'Fourchette de marché déclarée', when: ['valuationMid'], fields: {
        'value.market.analysisDate': { from: 'valuationDate' },
        'value.market.lowValue': { from: 'valuationLow', as: 'money' },
        'value.market.midValue': { from: 'valuationMid', as: 'money' },
        'value.market.highValue': { from: 'valuationHigh', as: 'money' },
      } },
      { id: 'value.retained', schemaSectionId: 'value.retained_value', title: 'Valeur de travail', when: ['valuationMid'], fields: {
        'value.retained.amount': { from: 'valuationMid', as: 'money' },
        'value.retained.explanation': { literal: 'Valeur déclarée lors de la création ; sources et méthode à revalider.' },
      } },
    ],
  },
  car: {
    schemaId: 'car',
    label: 'Automobile',
    assetTypeValue: 'Voiture',
    makerLabel: 'Constructeur',
    referenceLabel: 'Version',
    serialLabel: 'VIN / numéro de châssis',
    technicalLabel: 'Motorisation',
    minYear: 1886,
    requires: ['serialNumber', 'manufactureYear'],
    sections: [
      { id: 'cover.asset', schemaSectionId: 'cover.asset', title: 'Type de bien', fields: {
        'cover.asset.type': { literal: 'Voiture' },
      } },
      { id: 'identity.summary', schemaSectionId: 'cover.car', title: 'Identité de l’objet', fields: {
        'cover.car.maker': { from: 'brand' },
        'cover.car.model': { from: 'model' },
        'cover.car.version': { from: 'reference' },
        'cover.car.year': { from: 'manufactureYear', as: 'year' },
      } },
      { id: 'ownership.history', schemaSectionId: 'cover.ownership_history', title: "Historique de l'objet - Propriétaires précédents", fields: {} },
      { id: 'technical.powertrain', schemaSectionId: 'technical.powertrain', title: 'Spécifications de référence', fields: {
        'technical.engine.architecture': { from: 'caliber' },
      } },
      { id: 'identity.private', schemaSectionId: 'identity.private', title: 'Identité confidentielle de l’exemplaire', status: 'imported_unmapped', fields: {
        'identity.car.vin': { from: 'serialNumber' },
      }, extensions: {} },
      { id: 'condition.description', schemaSectionId: 'condition.current', title: 'Description de l’objet', when: ['description'], fields: {}, extensions: {
        'creation.description': { from: 'description' },
      }, foldInto: 'condition.summary' },
      { id: 'condition.summary', schemaSectionId: 'condition.current', title: 'État déclaré', when: ['conditionSummary'], fields: {
        'condition.overall.conclusion': { from: 'conditionSummary' },
      } },
      // Le schéma automobile n'a pas de section de prix de revient : l'acquisition est rangée en
      // extensions de la provenance (défaut corrigé par le contrôle contre le catalogue, ADR-030).
      { id: 'value.purchase', schemaSectionId: 'value.provenance', title: 'Acquisition', when: ['purchaseDate', 'purchasePrice'], fields: {}, extensions: {
        'value.purchase.seller': { from: 'seller' },
        'value.purchase.date': { from: 'purchaseDate' },
        'value.purchase.price': { from: 'purchasePrice', as: 'money' },
      } },
      { id: 'value.market-depth', schemaSectionId: 'value.market', title: 'Fourchette de marché déclarée', when: ['valuationMid'], fields: {
        'value.market.analysisDate': { from: 'valuationDate' },
      }, extensions: {
        'value.market.lowValue': { from: 'valuationLow', as: 'money' },
        'value.market.midValue': { from: 'valuationMid', as: 'money' },
        'value.market.highValue': { from: 'valuationHigh', as: 'money' },
      } },
      { id: 'value.retained', schemaSectionId: 'value.retained', title: 'Valeur de travail', when: ['valuationMid'], fields: {
        'value.retained.amount': { from: 'valuationMid', as: 'money' },
        'value.retained.explanation': { literal: 'Valeur déclarée lors de la création ; sources et méthode à revalider.' },
      } },
    ],
  },
};

export const SUPPORTED_CREATION_ASSET_TYPES = Object.keys(CREATION_PROFILE_DEFINITIONS);

/** Sections dont le schéma doit connaître l'identifiant et les champs (les sections `imported_unmapped` en sont dispensées). */
export const mappedSchemaSections = (definition) => definition.sections
  .filter((section) => section.status !== 'imported_unmapped')
  .map((section) => ({ schemaSectionId: section.schemaSectionId, fieldIds: Object.keys(section.fields) }));

const isPresent = (value) => typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined;

/**
 * Applique la table à un profil normalisé. `provenance(value)` enveloppe chaque valeur ;
 * `normalized` contient les valeurs déjà validées (texte épuré, montants, année).
 */
export const materializeCreationSections = ({ definition, normalized, provenance, schemaVersion }) => {
  const resolve = (spec) => {
    if ('literal' in spec) return provenance(spec.literal);
    if ('pairs' in spec) {
      return spec.pairs
        .filter((pair) => isPresent(normalized[pair.from]))
        .map((pair) => provenance(spec.part === 'label' ? pair.label : convert(pair, normalized[pair.from])));
    }
    const value = normalized[spec.from];
    if (!isPresent(value)) return undefined;
    if (spec.as === 'paragraph') return [provenance(value)];
    return provenance(convert(spec, value));
  };
  const convert = (spec, value) => {
    if (spec.as === 'yearString') return String(value);
    if (spec.as === 'money') return { amount: value, currency: normalized.currency };
    return value;
  };
  const materialize = (specs = {}) => Object.fromEntries(
    Object.entries(specs).flatMap(([fieldId, spec]) => {
      const value = resolve(spec);
      return value === undefined ? [] : [[fieldId, value]];
    }),
  );
  const sections = definition.sections
    .filter((section) => !section.when || section.when.some((key) => isPresent(normalized[key])))
    .map((section) => ({
      id: section.id,
      schemaSectionId: section.schemaSectionId,
      schemaVersion: `${definition.schemaId}@${schemaVersion}`,
      title: section.title,
      visibility: 'secret',
      status: section.status ?? 'imported_unreviewed',
      fields: materialize(section.fields),
      ...(section.extensions ? { extensions: materialize(section.extensions) } : {}),
      revision: 1,
      ...(section.foldInto ? { foldInto: section.foldInto } : {}),
    }));
  for (const section of [...sections]) {
    if (!section.foldInto) continue;
    const target = sections.find((candidate) => candidate.id === section.foldInto);
    delete section.foldInto;
    if (!target) continue;
    target.extensions = { ...(target.extensions ?? {}), ...(section.extensions ?? {}) };
    sections.splice(sections.indexOf(section), 1);
  }
  return sections;
};
