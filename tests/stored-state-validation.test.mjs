import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeCartularyStoredValue,
  normalizeWatchCreationProfile,
  readValidatedStoredJson,
} from '../src/persistence/storedStateValidation.ts';

const storageWith = (entries) => ({
  getItem: (key) => entries[key] ?? null,
});

test('un JSON invalide utilise le repli sans modifier la clé historique', () => {
  const repairs = [];
  const result = readValidatedStoredJson({
    storage: storageWith({ 'cartularia-owner-type': '{invalide' }),
    key: 'cartularia-owner-type',
    fallback: 'Personne physique',
    onRepair: (repair) => repairs.push(repair),
  });

  assert.equal(result, 'Personne physique');
  assert.deepEqual(repairs, [{ key: 'cartularia-owner-type', reason: 'invalid-json' }]);
});

test('un domaine absent conserve exactement sa valeur de repli', () => {
  const fallback = [{ id: 'owner-name', label: 'Nom', value: '' }];
  const result = readValidatedStoredJson({
    storage: storageWith({}),
    key: 'cartularia-owner-fields',
    fallback,
  });

  assert.equal(result, fallback);
});

test('les éléments valides sont conservés quand une entrée de collection est corrompue', () => {
  const value = [
    { id: 'check-1', title: 'Cadran', note: 'À revoir', checked: true, futureField: 'préservé' },
    { title: 'Sans identifiant', note: 42, checked: 'oui' },
  ];
  const normalized = normalizeCartularyStoredValue('cartularia-identification-checks', value, []);

  assert.equal(normalized.repaired, true);
  assert.deepEqual(normalized.value, [{
    id: 'check-1',
    title: 'Cadran',
    note: 'À revoir',
    checked: true,
    futureField: 'préservé',
  }]);
});

test('une entrée partielle est réparée champ par champ sans effacer les autres médias', () => {
  const value = [
    {
      id: 'media-1',
      name: 'Face',
      url: '/face.jpg',
      type: 'image',
      hash: 'abc',
      status: 'Archived',
      visibility: 'Secret',
      tags: ['main-photo', 12],
      futureMetadata: { retained: true },
    },
    { id: '', type: 'image' },
  ];
  const normalized = normalizeCartularyStoredValue('cartularia-media-assets-v3', value, []);

  assert.equal(normalized.value.length, 1);
  assert.deepEqual(normalized.value[0].tags, ['main-photo']);
  assert.deepEqual(normalized.value[0].futureMetadata, { retained: true });
  assert.equal(Object.hasOwn(normalized.value[0], 'derivativeStatus'), false);
});

test('les pièces jointes manquantes sont normalisées en liste vide', () => {
  const normalized = normalizeCartularyStoredValue('cartularia-condition-entries', [{
    id: 'condition-1',
    date: '2026-08-17',
    title: 'Contrôle',
    note: 'RAS',
  }], []);

  assert.deepEqual(normalized.value[0].attachments, []);
});

test('les anciennes valeurs groupées de publication restent disponibles pour la migration métier', () => {
  const value = ['condition-reports', 'value-comparables', 42];
  const normalized = normalizeCartularyStoredValue('cartularia-published-blocks', value, []);

  assert.deepEqual(normalized.value, ['condition-reports', 'value-comparables']);
});

test('les données financières non finies reviennent à des valeurs sûres', () => {
  const fallback = {
    analysisDate: '2026-08-17',
    activeListings: 0,
    transactions12m: 0,
    medianDaysOnMarket: 0,
    lowValue: 10,
    midValue: 20,
    highValue: 30,
  };
  const normalized = normalizeCartularyStoredValue('cartularia-market-depth', {
    ...fallback,
    activeListings: Number.POSITIVE_INFINITY,
    lowValue: -10,
  }, fallback);

  assert.equal(normalized.value.activeListings, 0);
  assert.equal(normalized.value.lowValue, 10);
  assert.equal(normalized.value.midValue, 20);
});

test('une ancienne valorisation reçoit les nouveaux niveaux nets sans perdre son montant brut', () => {
  const normalized = normalizeCartularyStoredValue('cartularia-retained-valuation', {
    amount: 20_000,
    explanation: 'Historique',
  }, {
    amount: 0,
    saleCostAmount: 2_000,
    taxAmount: 500,
    explanation: '',
  });
  assert.deepEqual(normalized.value, {
    amount: 20_000,
    saleCostAmount: 2_000,
    taxAmount: 500,
    explanation: 'Historique',
  });
});

test('un ancien état partiel ne remplace pas les défauts absents par des zéros', () => {
  const normalized = normalizeCartularyStoredValue('cartularia-market-depth', {
    activeListings: 12,
  }, {});

  assert.deepEqual(normalized.value, { activeListings: 12 });
});

test('un ancien texte éditable partiel reste partiel pour recevoir les défauts du domaine', () => {
  const normalized = normalizeCartularyStoredValue('cartularia-editable-copy', {
    heroSummary: 'Résumé historique',
    conditionFacts: { conclusion: 'À confirmer' },
  }, null);

  assert.deepEqual(normalized.value, {
    heroSummary: 'Résumé historique',
    conditionFacts: { conclusion: 'À confirmer' },
  });
});

test('une décision de publication invalide est rejetée et jamais transformée en confirmation', () => {
  const normalized = normalizeCartularyStoredValue('cartularia-publication-decisions-v1', [{
    requestId: 'request-1',
    destination: 'website',
    blockId: 'media-hero',
    blockLabel: 'Média principal',
    action: 'activate',
    status: 'pending',
    decisionSource: 'automatic',
    decidedAt: '2026-08-17T00:00:00.000Z',
    sourceRevision: 1,
    sourceDigest: 'digest',
    policyVersion: 'publication-policy-v1',
    prerequisites: [],
  }], []);

  assert.deepEqual(normalized.value, []);
});

test('un profil de création incomplet est refusé avant la construction du Cartulaire', () => {
  assert.equal(normalizeWatchCreationProfile({ profileVersion: '1.0.0', brand: 'Rolex' }), null);
});

test('un profil de création valide conserve les extensions et répare les nombres optionnels', () => {
  const profile = {
    profileVersion: '1.0.0',
    assetType: 'watch',
    schemaId: 'watch',
    schemaVersion: '1.5.0',
    collectionId: 'col_watch',
    brand: 'Rolex',
    model: 'GMT-Master',
    reference: '1675',
    manufactureYear: Number.NaN,
    serialNumber: '123',
    caliber: '1575',
    description: '',
    conditionSummary: '',
    purchaseDate: '',
    purchasePrice: Number.POSITIVE_INFINITY,
    currency: 'EUR',
    seller: '',
    valuationDate: '',
    valuationLow: null,
    valuationMid: 23_000,
    valuationHigh: null,
    sourceLabel: 'Dossier',
    assertedAt: '2026-08-17T00:00:00.000Z',
    futureField: 'préservé',
  };
  const normalized = normalizeWatchCreationProfile(profile);

  assert.equal(normalized.manufactureYear, null);
  assert.equal(normalized.purchasePrice, null);
  assert.equal(normalized.valuationMid, 23_000);
  assert.equal(normalized.futureField, 'préservé');
});
