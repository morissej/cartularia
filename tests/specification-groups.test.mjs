import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  PROTECTED_SPECIFICATION_IDS,
  UNTITLED_SPECIFICATION_GROUP_TITLE,
  appendSpecification,
  ensureProtectedSpecificationRows,
  isDuplicateSpecificationLabel,
  mergeStoredSpecificationGroups,
  specificationGroupsFromLegacyWatchData,
} from '../src/domain/specificationGroups.ts';
import { SUPPORTED_CREATION_PROFILES, buildCreationSpecificationGroups } from '../src/domain/cartularyCreation.ts';
import { buildRolexDossierState } from '../src/migrations/rolexImport.ts';

// V5 point 3 (P-C4) : relecture fidèle de `cartularia-specification-groups`, ajout à la validation,
// lignes d'identité protégées. Le catalogue réduit reprend les libellés réels des lignes protégées.

const DEFAULTS = Object.freeze([
  { id: 'basic', title: 'Données de base', items: [
    { id: 'brand', label: 'Marque', value: 'Marque à documenter' },
    { id: 'model', label: 'Modèle', value: 'Modèle à documenter' },
    { id: 'reference', label: 'Numéro de référence', value: 'Référence à documenter' },
    { id: 'year', label: 'Année de fabrication', value: 'À documenter' },
  ] },
  { id: 'caliber', title: 'Calibre', items: [
    { id: 'caliber', label: 'Calibre', value: 'Calibre à documenter' },
    { id: 'power-reserve', label: 'Réserve de marche', value: 'À documenter' },
  ] },
  { id: 'other', title: 'Autres', items: [
    { id: 'crown', label: 'Couronne', value: 'À documenter' },
  ] },
]);

const clone = (value) => JSON.parse(JSON.stringify(value));
const readerState = () => clone(DEFAULTS);
const itemsOf = (groups, groupId) => groups.find((group) => group.id === groupId).items;
const itemIn = (groups, groupId, itemId) => itemsOf(groups, groupId).find((item) => item.id === itemId);

const CREATION_PROFILE = { brand: 'Rolex', model: 'GMT-Master', reference: '1675', manufactureYear: null, caliber: '1575' };

// Fixture IWC : copie de `buildSpecificationGroups` (`scripts/update-iwc-dossier.mjs`, non exporté),
// mêmes 38 identifiants et libellés que le catalogue du lecteur et que le seed Rolex.
const IWC_SPECIFICATION_GROUPS = [
  { id: 'basic', title: 'Données de base', items: [['ad-code', 'Code annonce'], ['brand', 'Marque'], ['collection', 'Collection'], ['model', 'Modèle'], ['reference', 'Numéro de référence'], ['movement', 'Mouvement'], ['case', 'Boîtier'], ['bracelet', 'Matière du bracelet'], ['year', 'Année de fabrication'], ['condition', 'État'], ['delivered', 'Contenu livré'], ['gender', 'Sexe'], ['location', 'Emplacement'], ['price', 'Prix'], ['availability', 'Disponibilité']] },
  { id: 'caliber', title: 'Calibre', items: [['cal-movement', 'Mouvement'], ['caliber', 'Calibre'], ['base-caliber', 'Calibre de base'], ['power-reserve', 'Réserve de marche'], ['jewels', 'Nombre de pierres']] },
  { id: 'case', title: 'Boîtier', items: [['case-material', 'Boîtier'], ['diameter', 'Diamètre'], ['height', 'Hauteur'], ['water', 'Étanche'], ['bezel', 'Matériau de la lunette'], ['crystal', 'Verre'], ['dial', 'Cadran'], ['numerals', 'Chiffres du cadran']] },
  { id: 'bracelet', title: 'Bracelet', items: [['strap-material', 'Matière du bracelet'], ['strap-color', 'Couleur du bracelet'], ['clasp', 'Boucle'], ['clasp-material', 'Matière de la boucle']] },
  { id: 'functions', title: 'Fonctions', items: [['date', 'Date'], ['gmt', 'GMT'], ['timezone', 'Second fuseau horaire']] },
  { id: 'other', title: 'Autres', items: [['seconds', 'Seconde'], ['crown', 'Couronne'], ['caseback', 'Fond']] },
].map((group) => ({
  id: group.id,
  title: group.title,
  items: group.items.map(([id, label]) => ({ id, label, value: {
    'ad-code': 'Non applicable · dossier OP-4892-XZ9', brand: 'IWC Schaffhausen', collection: 'Pilot’s Watches', model: 'Flieger UTC (Die Fliegeruhr)',
    reference: 'IW3251-001 · 3251-001', movement: 'Remontage automatique', case: 'Acier, brossé avec fins chanfreins polis de référence', bracelet: 'Cuir marron patiné',
    year: '2002', condition: 'État d’usage documenté · voir 03 · L’objet', delivered: 'Montre, boîte IWC et facture d’achat ; carte de garantie et manuel non retrouvés dans le dossier versé',
    gender: 'Montre homme / Unisexe', location: 'Accès restreint', price: 'Voir 04 · Valorisation', availability: 'Collection privée · conserver selon la note du 18/08/2026',
    'cal-movement': 'Automatique · 28 800 alternances/heure · stop seconde', caliber: 'IWC 37526 · module TZC', 'base-caliber': 'ETA 2893-2 selon les sources les mieux recoupées ; divergence interne avec ETA 2892-A2 + module IWC',
    'power-reserve': 'Environ 42 heures', jewels: '21 · visible sur le rotor et confirmé par plusieurs sources',
    'case-material': 'Acier inoxydable, protection antimagnétique interne en fer doux', diameter: '39,0 mm', height: '13,5 mm', water: '60 m · 6 bar (valeur constructeur ; contrôle actuel non fourni)',
    bezel: 'Acier, fixe', crystal: 'Saphir bombé', dial: 'Noir, chiffres arabes, mentions Universal Time Coordinated et TZC Automatic', numerals: 'Arabes peints ; matière lumineuse exacte à confirmer pour cet exemplaire de transition',
    'strap-material': 'Cuir marron, fortement patiné ; configuration catalogue -001 en buffle marron', 'strap-color': 'Marron foncé', clasp: 'Boucle ardillon IWC déclarée ; vue macro dédiée à compléter', 'clasp-material': 'Acier',
    date: 'Guichet à 3 heures ; date liée à l’heure locale dans les deux sens', gmt: 'Heure de référence sur disque UTC 24 heures à 12 heures', timezone: 'Heure locale sautante par pas de ±1 h via le module TZC',
    seconds: 'Seconde centrale', crown: 'Type et gravure à confirmer sur une vue dédiée ; la couronne poisson est attendue mais non établie par le dossier actuel', caseback: 'Fond plein acier vissé ; extérieur et intérieur photographiés le 05/08/2026',
  }[id] })),
}));

test('1. la forme de création « identity » est complétée par le catalogue, comme avant V5, et la fusion est idempotente', () => {
  const creation = buildCreationSpecificationGroups(SUPPORTED_CREATION_PROFILES.watch, CREATION_PROFILE);
  const merged = mergeStoredSpecificationGroups(creation, DEFAULTS);

  assert.deepEqual(merged.map((group) => [group.id, group.title, group.items.map((item) => item.id)]), DEFAULTS.map((group) => [group.id, group.title, group.items.map((item) => item.id)]));
  assert.deepEqual(merged.map((group) => group.items.map((item) => item.label)), DEFAULTS.map((group) => group.items.map((item) => item.label)));
  assert.equal(itemIn(merged, 'basic', 'brand').value, 'Rolex');
  assert.equal(itemIn(merged, 'basic', 'model').value, 'GMT-Master');
  assert.equal(itemIn(merged, 'basic', 'reference').value, '1675');
  assert.equal(itemIn(merged, 'basic', 'year').value, 'À documenter', 'l’année inconnue reçoit la valeur de repli');
  assert.equal(itemIn(merged, 'caliber', 'caliber').value, '1575');
  assert.equal(itemIn(merged, 'other', 'crown').value, 'À documenter');
  assert.deepEqual(mergeStoredSpecificationGroups(merged, DEFAULTS), merged, 'une seconde relecture ne change rien');
  assert.deepEqual(creation, buildCreationSpecificationGroups(SUPPORTED_CREATION_PROFILES.watch, CREATION_PROFILE), 'l’entrée n’est pas mutée');
});

test('2. le seed Rolex est relu à l’identique : aucune réécriture au montage', () => {
  const groups = buildRolexDossierState().get('cartularia-specification-groups');
  const serialized = JSON.stringify(groups);

  assert.equal(groups.flatMap((group) => group.items).length, 38);
  assert.equal(JSON.stringify(mergeStoredSpecificationGroups(groups, groups)), serialized);
  assert.equal(JSON.stringify(mergeStoredSpecificationGroups(groups, DEFAULTS)), serialized, 'un catalogue différent ne réécrit pas un état complet');
  assert.equal(JSON.stringify(groups), serialized, 'l’entrée n’est pas mutée');
});

test('3. la fixture IWC (38 identifiants) est relue à l’identique', () => {
  const serialized = JSON.stringify(IWC_SPECIFICATION_GROUPS);
  const ids = IWC_SPECIFICATION_GROUPS.flatMap((group) => group.items.map((item) => item.id));

  assert.equal(ids.length, 38);
  assert.equal(new Set(ids).size, 38);
  assert.ok(IWC_SPECIFICATION_GROUPS.every((group) => group.items.every((item) => item.value.trim())));
  assert.equal(JSON.stringify(mergeStoredSpecificationGroups(IWC_SPECIFICATION_GROUPS, IWC_SPECIFICATION_GROUPS)), serialized);
  assert.equal(JSON.stringify(mergeStoredSpecificationGroups(IWC_SPECIFICATION_GROUPS, DEFAULTS)), serialized);
});

test('4. une ligne ajoutée par le propriétaire est conservée à sa position, libellé et valeur intacts', () => {
  const stored = readerState();
  const added = { id: 'spec-1', label: 'Réserve de marche', value: '48 h' };
  itemsOf(stored, 'basic').splice(1, 0, { ...added });
  const merged = mergeStoredSpecificationGroups(stored, DEFAULTS);

  assert.deepEqual(itemsOf(merged, 'basic')[1], added);
  assert.deepEqual(itemsOf(merged, 'basic').map((item) => item.id), ['brand', 'spec-1', 'model', 'reference', 'year']);
  assert.equal(JSON.stringify(merged), JSON.stringify(stored), 'l’état complet est relu sans réécriture');
});

test('5. la suppression d’une ligne non protégée est durable et un groupe vide est accepté', () => {
  const stored = readerState();
  stored.find((group) => group.id === 'other').items = [];
  stored.find((group) => group.id === 'caliber').items = itemsOf(stored, 'caliber').filter((item) => item.id !== 'power-reserve');
  const merged = mergeStoredSpecificationGroups(stored, DEFAULTS);

  assert.equal(itemIn(merged, 'other', 'crown'), undefined);
  assert.deepEqual(itemsOf(merged, 'other'), []);
  assert.deepEqual(itemsOf(merged, 'caliber').map((item) => item.id), ['caliber']);
  assert.equal(JSON.stringify(merged), JSON.stringify(stored));
});

test('6. une valeur vide reçoit la valeur de repli du catalogue et la valeur héritée « Voir 04 · Valeur » est remplacée', () => {
  const stored = readerState();
  itemIn(stored, 'other', 'crown').value = '';
  itemIn(stored, 'caliber', 'power-reserve').value = 'Voir 04 · Valeur';
  itemsOf(stored, 'caliber').push({ id: 'spec-9', label: 'Fréquence', value: '' });
  const merged = mergeStoredSpecificationGroups(stored, DEFAULTS);

  assert.equal(itemIn(merged, 'other', 'crown').value, 'À documenter');
  assert.equal(itemIn(merged, 'caliber', 'power-reserve').value, 'Voir 04 · Valorisation');
  assert.equal(itemIn(merged, 'caliber', 'spec-9').value, '', 'une ligne ajoutée sans repli reste vide');

  const creation = buildCreationSpecificationGroups(SUPPORTED_CREATION_PROFILES.watch, { ...CREATION_PROFILE, caliber: 'Voir 04 · Valeur' });
  assert.equal(itemIn(mergeStoredSpecificationGroups(creation, DEFAULTS), 'caliber', 'caliber').value, 'Voir 04 · Valorisation');
});

test('7. le libellé enregistré fait foi sauf pour les lignes protégées et les libellés blancs des lignes du catalogue', () => {
  const stored = readerState();
  itemIn(stored, 'basic', 'brand').label = 'Fabricant';
  itemIn(stored, 'other', 'crown').label = 'Remontoir';
  itemIn(stored, 'caliber', 'power-reserve').label = '  ';
  itemsOf(stored, 'other').push({ id: 'spec-2', label: '', value: 'Sans libellé' });
  const merged = mergeStoredSpecificationGroups(stored, DEFAULTS);

  assert.equal(itemIn(merged, 'basic', 'brand').label, 'Marque');
  assert.equal(itemIn(merged, 'other', 'crown').label, 'Remontoir');
  assert.equal(itemIn(merged, 'caliber', 'power-reserve').label, 'Réserve de marche');
  assert.equal(itemIn(merged, 'other', 'spec-2').label, '', 'une ligne ajoutée sans libellé est conservée telle quelle');
});

test('8. un titre vide reprend celui du catalogue ; un groupe inconnu sans titre devient « Caractéristiques »', () => {
  const stored = readerState();
  stored.find((group) => group.id === 'basic').title = '';
  stored.push({ id: 'custom', title: '', items: [{ id: 'spec-4', label: 'Gravure', value: 'Fond gravé' }] });
  stored.push({ id: 'custom-titled', title: 'Mon groupe', items: [] });
  const merged = mergeStoredSpecificationGroups(stored, DEFAULTS);

  assert.equal(merged.find((group) => group.id === 'basic').title, 'Données de base');
  assert.equal(merged.find((group) => group.id === 'custom').title, UNTITLED_SPECIFICATION_GROUP_TITLE);
  assert.equal(UNTITLED_SPECIFICATION_GROUP_TITLE, 'Caractéristiques');
  assert.equal(merged.find((group) => group.id === 'custom-titled').title, 'Mon groupe');
  assert.deepEqual(itemsOf(merged, 'custom'), [{ id: 'spec-4', label: 'Gravure', value: 'Fond gravé' }]);
});

test('9. une ligne d’identité absente est réinsérée depuis le catalogue, groupe recréé à sa place s’il manque', () => {
  const withoutBrand = readerState();
  withoutBrand.find((group) => group.id === 'basic').items = itemsOf(withoutBrand, 'basic').filter((item) => item.id !== 'brand');
  const mergedBrand = mergeStoredSpecificationGroups(withoutBrand, DEFAULTS);
  assert.deepEqual(itemsOf(mergedBrand, 'basic').map((item) => item.id), ['model', 'reference', 'year', 'brand']);
  assert.deepEqual(itemsOf(mergedBrand, 'basic').at(-1), { id: 'brand', label: 'Marque', value: 'Marque à documenter' });

  const withoutCaliberGroup = readerState().filter((group) => group.id !== 'caliber');
  const mergedCaliber = mergeStoredSpecificationGroups(withoutCaliberGroup, DEFAULTS);
  assert.deepEqual(mergedCaliber.map((group) => group.id), ['basic', 'caliber', 'other'], 'le groupe recréé reprend sa place du catalogue');
  assert.deepEqual(mergedCaliber.find((group) => group.id === 'caliber'), { id: 'caliber', title: 'Calibre', items: [{ id: 'caliber', label: 'Calibre', value: 'Calibre à documenter' }] });

  const moved = readerState();
  const caliberItem = itemsOf(moved, 'caliber').shift();
  itemsOf(moved, 'other').push(caliberItem);
  assert.deepEqual(ensureProtectedSpecificationRows(moved, DEFAULTS), moved, 'une ligne d’identité déplacée n’est ni dupliquée ni déplacée');
});

test('10. appendSpecification refuse le libellé blanc, le doublon dans le groupe et le groupe inconnu, sinon ajoute en fin de groupe sans muter l’entrée', () => {
  const groups = readerState();
  const snapshot = JSON.stringify(groups);

  assert.equal(appendSpecification(groups, 'other', { id: 'spec-5', label: '  ', value: 'x' }), null);
  assert.equal(appendSpecification(groups, 'other', { id: 'spec-5', label: 'couronne', value: '' }), null, 'doublon à la casse près');
  assert.equal(appendSpecification(groups, 'other', { id: 'spec-5', label: ' COURONNE ', value: '' }), null, 'doublon aux espaces près');
  assert.equal(appendSpecification(groups, 'unknown', { id: 'spec-5', label: 'Fréquence', value: '' }), null);
  assert.ok(isDuplicateSpecificationLabel(['Couronne'], ' couronne '));
  assert.equal(isDuplicateSpecificationLabel(['Couronne'], '   '), false, 'un libellé blanc n’est jamais un doublon');

  const result = appendSpecification(groups, 'caliber', { id: 'spec-6', label: ' Fréquence ', value: ' 28 800 ' });
  assert.deepEqual(itemsOf(result, 'caliber').at(-1), { id: 'spec-6', label: 'Fréquence', value: '28 800' });
  assert.equal(itemsOf(result, 'caliber').length, 3);
  assert.equal(result[0], groups[0], 'les autres groupes sont renvoyés tels quels');
  assert.equal(result[2], groups[2]);
  assert.equal(JSON.stringify(groups), snapshot, 'l’entrée n’est pas mutée');

  const crossGroup = appendSpecification(groups, 'basic', { id: 'spec-7', label: 'Couronne', value: '' });
  assert.equal(itemsOf(crossGroup, 'basic').at(-1).label, 'Couronne', 'le même libellé reste admis dans un autre groupe');
});

test('11. la migration de « cartularia-basic-watch-data » reprend la table historique du lecteur (15 clés)', () => {
  const table = [
    ['ad-code', 'adCode'], ['brand', 'brand'], ['collection', 'collection'], ['model', 'model'], ['reference', 'reference'],
    ['movement', 'movement'], ['case', 'caseMaterial'], ['bracelet', 'braceletMaterial'], ['year', 'productionYear'],
    ['condition', 'condition'], ['delivered', 'deliveredContent'], ['gender', 'gender'], ['location', 'location'],
    ['price', 'price'], ['availability', 'availability'],
  ];
  const defaults = [
    { id: 'basic', title: 'Données de base', items: table.map(([id]) => ({ id, label: `Libellé ${id}`, value: `Repli ${id}` })) },
    { id: 'caliber', title: 'Calibre', items: [{ id: 'caliber', label: 'Calibre', value: 'Calibre à documenter' }] },
  ];
  const legacy = Object.fromEntries(table.map(([, field]) => [field, `Ancien ${field}`]));
  legacy.availability = '';
  delete legacy.price;

  const migrated = specificationGroupsFromLegacyWatchData(legacy, defaults);
  for (const [id, field] of table) {
    const expected = field === 'availability' ? '' : field === 'price' ? 'Repli price' : `Ancien ${field}`;
    assert.equal(itemIn(migrated, 'basic', id).value, expected, `${id} ← ${field}`);
  }
  assert.deepEqual(itemsOf(migrated, 'basic').map((item) => item.label), defaults[0].items.map((item) => item.label));
  assert.deepEqual(itemsOf(migrated, 'caliber'), defaults[1].items, 'les lignes hors table gardent leur repli');
  assert.deepEqual(migrated.map((group) => Object.keys(group)), [['id', 'title', 'items'], ['id', 'title', 'items']]);
});

test('12. les lignes protégées sont exactement celles posées à la création, et le module reste pur', () => {
  const creationIds = buildCreationSpecificationGroups(SUPPORTED_CREATION_PROFILES.watch, CREATION_PROFILE).flatMap((group) => group.items.map((item) => item.id));
  assert.deepEqual([...PROTECTED_SPECIFICATION_IDS].sort(), [...creationIds].sort());
  assert.deepEqual([...PROTECTED_SPECIFICATION_IDS], ['brand', 'model', 'reference', 'year', 'caliber']);

  const source = readFileSync(new URL('../src/domain/specificationGroups.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /isDemoCartulary|mockCartulary|activeCreationProfile|from 'react'|firebase/);
  assert.doesNotMatch(source, /^import /m, 'aucune dépendance');
});

// Livré en `test.todo` par le socle S3 (coherence.md § 6 M10), activé par I2 avec le câblage d’App.tsx.
test('13. garde de source : App.tsx passe par le module et ne crée plus de « Nouvelle donnée »', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const missing = [
    'mergeStoredSpecificationGroups(',
    'appendSpecification(',
    'specificationGroupsFromLegacyWatchData(',
    'PROTECTED_SPECIFICATION_IDS.has(item.id)',
    '<SpecificationAddForm',
    "aiFieldProps('reference.specifications[].label'",
    "aiFieldProps('reference.specifications[].value'",
    // V5 relecture (C7) : les deux couches de protection des lignes d'identité sont figées une à une —
    // la garde de deleteSpecification (défense en profondeur) et l'attribut disabled du bouton « Retirer ».
    'if (PROTECTED_SPECIFICATION_IDS.has(itemId)) return;',
    ' disabled={PROTECTED_SPECIFICATION_IDS.has(item.id)}',
    // V5 relecture (A1, WCAG 2.5.3) : le nom accessible du bouton contient son libellé visible « Retirer ».
    'aria-label={tx(`Retirer ${item.label}`, `Remove ${item.label}`)}',
  ].filter((anchor) => !app.includes(anchor));
  assert.deepEqual(missing, [], 'ancres attendues dans App.tsx (dont celles de validate:ai)');
  assert.equal(app.includes('Supprimer ${item.label}'), false, 'A1 : plus aucun nom accessible « Supprimer … » sur le bouton « Retirer »');
  assert.equal(app.includes('Nouvelle donnée'), false, 'plus aucune ligne « Nouvelle donnée » créée par App.tsx');
});
