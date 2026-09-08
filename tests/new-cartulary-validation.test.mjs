import assert from 'node:assert/strict';
import test from 'node:test';

import { COLLECTION_ID_PATTERN } from '../src/domain/collectionIdentifiers.ts';
import {
  CARTULARY_CREATION_TIMEOUT_MESSAGE,
  CARTULARY_SLUG_MAX_LENGTH,
  resumeOrCreateCartulary,
  slugifyCartularyLabel,
} from '../src/domain/cartularyCreation.ts';

/** Regex la plus stricte rencontrée par un cartularyId côté serveur (scripts/lib/transfer-request-command.mjs). */
const STRICTEST_SERVER_CARTULARY_ID = /^[a-z0-9][a-z0-9_-]{5,127}$/;
/** Reproduit la concaténation de `createCartulary` (src/services/cartularyCreation.ts) avec un jeton de 12 hexadécimaux. */
const buildCartularyId = (label) => `cart_${slugifyCartularyLabel(label) || 'objet'}_${'a'.repeat(12)}`;

test('le pattern HTML de collection reste valide sous le drapeau v et rejette AB!', () => {
  const browserPattern = new RegExp(`^(?:${COLLECTION_ID_PATTERN})$`, 'v');
  assert.equal(browserPattern.test('AB!'), false);
  assert.equal(browserPattern.test('x'), false);
  assert.equal(browserPattern.test('col_divers'), true);
});

test('la limite du slug reste à 44 caractères', () => {
  assert.equal(CARTULARY_SLUG_MAX_LENGTH, 44);
});

test('une entrée courte garde exactement l’ancien slug (accents, ponctuation, casse)', () => {
  assert.equal(slugifyCartularyLabel('Breitling Navitimer A23322'), 'breitling_navitimer_a23322');
  assert.equal(slugifyCartularyLabel('Émile & Cie — série n°12'), 'emile_cie_serie_n_12');
  assert.equal(slugifyCartularyLabel('  --Rolex__Daytona--  '), 'rolex_daytona');
  assert.equal(slugifyCartularyLabel('Citroën DS 21 Pallas'), 'citroen_ds_21_pallas');
});

test('le cas D5 est tronqué sur une frontière de mot, sans soulignement final ni double soulignement', () => {
  const label = 'Audit Cartularia Parcours propriétaire 2026 Ref X';
  const slug = slugifyCartularyLabel(label);
  assert.equal(slug, 'audit_cartularia_parcours_proprietaire_2026');
  assert.equal(slug.length, 43);
  const cartularyId = buildCartularyId(label);
  assert.equal(cartularyId, 'cart_audit_cartularia_parcours_proprietaire_2026_aaaaaaaaaaaa');
  assert.doesNotMatch(cartularyId, /__/);
  assert.match(cartularyId, STRICTEST_SERVER_CARTULARY_ID);
});

test('une coupe au milieu d’un mot recule jusqu’au séparateur précédent', () => {
  // Normalisé : 'patek_philippe_nautilus_5711_1a_010_acier_bracelet_…' ; la limite de 44 tombe au milieu
  // de « bracelet » (une coupe brute suivie du retrait des `_` finaux donnerait '…_acier_br').
  const slug = slugifyCartularyLabel('Patek Philippe Nautilus 5711/1A-010 acier bracelet intégré cadran bleu');
  assert.equal(slug, 'patek_philippe_nautilus_5711_1a_010_acier');
  assert.equal(slugifyCartularyLabel('Audit Cartularia Parcours propriétaire 2026 documentaire'), 'audit_cartularia_parcours_proprietaire_2026');
});

test('un mot complet qui se termine exactement à la limite est conservé', () => {
  const prefix = 'audit_cartularia_parcours_proprietaire_2026'; // 43 caractères
  const slug = slugifyCartularyLabel(`${prefix}x suite`);
  assert.equal(slug, `${prefix}x`);
  assert.equal(slug.length, CARTULARY_SLUG_MAX_LENGTH);
});

test('un premier mot plus long que la limite est coupé brutalement à la limite', () => {
  const slug = slugifyCartularyLabel('a'.repeat(50));
  assert.equal(slug, 'a'.repeat(44));
  const withTail = slugifyCartularyLabel(`${'b'.repeat(50)} suite`);
  assert.equal(withTail, 'b'.repeat(44));
  assert.doesNotMatch(buildCartularyId('a'.repeat(50)), /__/);
});

test('une entrée vide donne un slug vide et l’appelant retombe sur « objet »', () => {
  assert.equal(slugifyCartularyLabel(''), '');
  assert.equal(slugifyCartularyLabel('   '), '');
  assert.equal(slugifyCartularyLabel('—&°'), '');
  assert.equal(buildCartularyId(''), 'cart_objet_aaaaaaaaaaaa');
});

test('aucun slug ne dépasse la limite, ne finit par _ ni ne produit d’identifiant hors regex serveur', () => {
  const labels = [
    'Audit Cartularia Parcours propriétaire 2026 Ref X',
    'Audit Cartularia Parcours propriétaire 2026 documentaire',
    'Patek Philippe Nautilus 5711/1A-010 acier bracelet intégré cadran bleu',
    `${'x'.repeat(43)} y`,
    `${'x'.repeat(44)} y`,
    `${'x'.repeat(45)} y`,
    'a b c d e f g h i j k l m n o p q r s t u v w x y z aa bb cc',
    'Émile & Cie — série n°12',
    '',
  ];
  for (const label of labels) {
    const slug = slugifyCartularyLabel(label);
    assert.ok(slug.length <= CARTULARY_SLUG_MAX_LENGTH, `${JSON.stringify(label)} → ${slug.length} caractères`);
    assert.doesNotMatch(slug, /_$/, `${JSON.stringify(label)} → ${slug}`);
    assert.doesNotMatch(slug, /__/, `${JSON.stringify(label)} → ${slug}`);
    const cartularyId = buildCartularyId(label);
    assert.doesNotMatch(cartularyId, /__/, cartularyId);
    assert.match(cartularyId, STRICTEST_SERVER_CARTULARY_ID, cartularyId);
    assert.ok(cartularyId.length <= 62, cartularyId);
  }
});

test('une reprise réutilise la demande existante sans relancer la création', async () => {
  const pending = {
    cartularyId: 'cart_breitling_navitimer_attempt01',
    requestId: 'create_attempt01',
    publicCode: 'BRE-ATTEMPT01',
    uploadedFileCount: 4,
    uploadedBytes: 1024,
  };
  let createCalls = 0;
  const result = await resumeOrCreateCartulary(pending, async () => {
    createCalls += 1;
    return { ...pending, cartularyId: 'cart_duplicate' };
  });
  assert.equal(result, pending);
  assert.equal(createCalls, 0);
});

test('le délai prévient qu’une création peut encore aboutir avant toute nouvelle tentative', () => {
  assert.match(CARTULARY_CREATION_TIMEOUT_MESSAGE, /peut encore aboutir/);
  assert.match(CARTULARY_CREATION_TIMEOUT_MESSAGE, /Vérifiez le catalogue/);
  assert.match(CARTULARY_CREATION_TIMEOUT_MESSAGE, /même demande sans téléverser à nouveau/);
});

test('sans profil de création, l’identité se relit dans la fiche de spécifications enregistrée', async () => {
  const { creationProfileFromSpecificationGroups } = await import('../src/domain/cartularyCreation.ts');
  const base = { profileVersion: '1.0.0', assetType: 'watch', schemaId: 'watch', schemaVersion: '1.6.0', collectionId: 'col_pilots', brand: 'Montre', model: 'Dossier à compléter', reference: 'À documenter', manufactureYear: null, serialNumber: '', caliber: 'À documenter', description: '', conditionSummary: '', purchaseDate: '', purchasePrice: null, currency: 'EUR', seller: '', valuationDate: '', valuationLow: null, valuationMid: null, valuationHigh: null, sourceLabel: 'Dossier privé', assertedAt: '2026-08-16T00:00:00.000Z' };
  const groups = [
    { id: 'basic', title: 'Données de base', items: [
      { id: 'ad-code', label: 'Code annonce', value: 'Non applicable · dossier OP-4892-XZ9' },
      { id: 'brand', label: 'Marque', value: 'IWC Schaffhausen' },
      { id: 'model', label: 'Modèle', value: 'Flieger UTC (Die Fliegeruhr)' },
      { id: 'reference', label: 'Numéro de référence', value: 'IW3251-001 · 3251-001' },
      { id: 'year', label: 'Année de fabrication', value: '2002' },
    ] },
    { id: 'caliber', title: 'Calibre', items: [{ id: 'caliber', label: 'Calibre', value: 'IWC 37526 · module TZC' }] },
  ];
  const profile = creationProfileFromSpecificationGroups(groups, base);
  assert.equal(profile.brand, 'IWC Schaffhausen');
  assert.equal(profile.model, 'Flieger UTC (Die Fliegeruhr)');
  assert.equal(profile.reference, 'IW3251-001 · 3251-001');
  assert.equal(profile.manufactureYear, 2002);
  assert.equal(profile.caliber, 'IWC 37526 · module TZC');
  assert.equal(profile.sourceLabel, 'Fiche de spécifications enregistrée');
  assert.equal(profile.serialNumber, '', 'aucune donnée confidentielle n’est déduite');
  assert.equal(creationProfileFromSpecificationGroups(null, base), null);
  assert.equal(creationProfileFromSpecificationGroups([{ id: 'basic', title: 'x', items: [{ id: 'brand', label: 'Marque', value: '   ' }] }], base), null);
  const partial = creationProfileFromSpecificationGroups([{ id: 'basic', title: 'x', items: [{ id: 'brand', label: 'Marque', value: 'Tudor' }, { id: 'year', label: 'Année', value: 'inconnue' }] }], base);
  assert.deepEqual([partial.brand, partial.model, partial.reference, partial.manufactureYear], ['Tudor', 'Dossier à compléter', 'À documenter', null]);
});
