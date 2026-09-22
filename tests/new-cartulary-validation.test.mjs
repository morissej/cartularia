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

test('V3 : le bilan des médias de création distingue images prêtes, images sans aperçu, vidéos à la demande et documents', async () => {
  const { summarizeCreationMedia, describeCreationMediaSummary } = await import('../src/domain/cartularyCreation.ts');
  const variant = (width) => ({ width, height: width, storagePath: `private-derivatives/owner_bilan/cart_bilan_v3/bin_bilan/presentation-v3-${width}.webp`, sha256: `sha256:${'d'.repeat(64)}`, size: 100, mimeType: 'image/webp' });
  const ready = { type: 'image', privatePresentation: { binaryId: 'bin_bilan', version: 'presentation-v3', variants: [variant(240), variant(480)], thumbnail: null } };
  const summary = summarizeCreationMedia([
    ready,
    { type: 'image' },
    { type: 'image', privatePresentation: { binaryId: 'bin_vide', version: 'presentation-v3', variants: [], thumbnail: null } },
    { type: 'video' },
    { type: 'video' },
    { type: 'document' },
  ]);
  assert.deepEqual(summary, { total: 6, imagesReady: 1, imagesPending: 2, videosOnDemand: 2, documents: 1 });
  const notes = describeCreationMediaSummary(summary);
  assert.equal(notes.length, 2);
  assert.match(notes[0], /^2 photos sans aperçu pour l’instant/);
  assert.match(notes[0], /Aperçu en préparation/);
  assert.match(notes[0], /l’original reste consultable sur demande/);
  assert.equal(notes[1], '2 vidéos resteront consultables à la demande (copie de présentation non produite).');
  assert.deepEqual(describeCreationMediaSummary(summarizeCreationMedia([ready, { type: 'document' }])), [], 'rien à annoncer quand tout est prêt');
  assert.deepEqual(describeCreationMediaSummary(summarizeCreationMedia([{ type: 'video' }])), ['1 vidéo restera consultable à la demande (copie de présentation non produite).']);
  assert.deepEqual(describeCreationMediaSummary(undefined), [], 'une reprise antérieure à V3 n’annonce rien');
  for (const note of notes) {
    assert.doesNotMatch(note, /Accès restreint/, 'P-D3 : jamais « Accès restreint » pour un dérivé absent');
    assert.doesNotMatch(note, /presentation-v2|private-derivatives|storagePath/, 'aucun chemin de stockage sur l’écran de succès');
  }
});

test('V5 : les étapes de création sont honnêtes (trois étapes, barre déterminée en phase fichiers seulement, jamais « 100 % » en phase serveur)', async () => {
  const { CARTULARY_CREATION_DURATION_NOTE, describeCreationProgress } = await import('../src/domain/cartularyCreation.ts');
  const input = (phase, overrides = {}) => ({ phase, activeFileNames: [], completedFiles: 0, totalFiles: 5, uploadedBytes: 0, totalBytes: 1000, ...overrides });
  const states = (result) => result.steps.map((step) => step.state);
  const labels = ['Fichiers téléversés et vérifiés', 'Demande de création envoyée', 'Cartulaire créé et projeté au Registre'];

  // Ligne 1 : préparation.
  const preparing = describeCreationProgress(input('preparing'), null);
  assert.deepEqual(preparing.steps.map((step) => step.id), ['files', 'request', 'creation']);
  assert.deepEqual(preparing.steps.map((step) => step.label), labels);
  assert.deepEqual(states(preparing), ['current', 'pending', 'pending']);
  assert.equal(preparing.steps[0].detail, 'Préparation du brouillon privé…');
  assert.equal(preparing.percent, 0);

  // Ligne 2 : phase fichiers, pourcentage sur les octets, détail « k/N vérifié(s) · en cours : A, B ».
  for (const phase of ['hashing', 'uploading', 'verifying']) {
    const files = describeCreationProgress(input(phase, { activeFileNames: ['a.jpg', 'b.pdf'], completedFiles: 2, uploadedBytes: 250 }), null);
    assert.deepEqual(states(files), ['current', 'pending', 'pending'], phase);
    assert.equal(files.steps[0].detail, '2/5 vérifiés · en cours : a.jpg, b.pdf', phase);
    assert.equal(files.percent, 25, phase);
  }
  assert.equal(describeCreationProgress(input('uploading', { completedFiles: 1, activeFileNames: ['c.mov'] }), null).steps[0].detail, '1/5 vérifié · en cours : c.mov', 'singulier à 1');
  assert.equal(describeCreationProgress(input('uploading', { completedFiles: 0, activeFileNames: ['c.mov'] }), null).steps[0].detail, '0/5 vérifié · en cours : c.mov', 'singulier à 0');
  assert.equal(describeCreationProgress(input('verifying', { completedFiles: 5 }), null).steps[0].detail, '5/5 vérifiés', 'sans « en cours » quand aucun fichier n’est en vol');
  assert.equal(describeCreationProgress(input('uploading', { uploadedBytes: 1000 }), null).percent, 100);
  assert.equal(describeCreationProgress(input('uploading', { uploadedBytes: 1500 }), null).percent, 100, 'borné à 100');
  assert.equal(describeCreationProgress(input('uploading', { uploadedBytes: -5 }), null).percent, 0, 'borné à 0');
  assert.equal(describeCreationProgress(input('uploading', { uploadedBytes: 0, totalBytes: 0 }), null).percent, 0, '0 si totalBytes = 0');

  // Ligne 3 : enregistrement des métadonnées.
  const finalizing = describeCreationProgress(input('finalizing', { completedFiles: 5, uploadedBytes: 1000 }), null);
  assert.deepEqual(states(finalizing), ['done', 'current', 'pending']);
  assert.equal(finalizing.steps[1].detail, 'Enregistrement des métadonnées privées…');
  assert.equal(finalizing.percent, null);

  // Ligne 4 : demande envoyée, serveur pas encore saisi (statut absent ou pending) ; reprise (progress nul).
  for (const [progress, status] of [[input('processing', { completedFiles: 5, uploadedBytes: 1000 }), null], [input('processing', { completedFiles: 5, uploadedBytes: 1000 }), 'pending'], [null, null], [null, 'pending']]) {
    const waiting = describeCreationProgress(progress, status);
    assert.deepEqual(states(waiting), ['done', 'current', 'pending'], JSON.stringify([progress?.phase, status]));
    assert.equal(waiting.steps[1].detail, 'En attente de prise en charge par le serveur…');
    assert.equal(waiting.percent, null, 'mutant : 100 en phase serveur');
  }

  // Ligne 5 : serveur en cours.
  for (const progress of [input('processing', { completedFiles: 5, uploadedBytes: 1000 }), null]) {
    const creating = describeCreationProgress(progress, 'processing');
    assert.deepEqual(states(creating), ['done', 'done', 'current']);
    assert.equal(creating.steps[2].detail, 'Création du Cartulaire et de sa projection au Registre…');
    assert.equal(creating.percent, null);
  }

  // Aucun libellé ni détail ne promet un raccordement ni n'affiche « 100 ».
  for (const [progress, status] of [[input('preparing'), null], [input('uploading', { uploadedBytes: 1000, activeFileNames: ['x.jpg'] }), null], [input('finalizing'), null], [input('processing'), 'pending'], [null, 'processing']]) {
    for (const step of describeCreationProgress(progress, status).steps) {
      assert.doesNotMatch(`${step.label} ${step.detail ?? ''}`, /raccordement|100/i);
    }
  }

  // Estimation honnête : un ordre de grandeur, jamais un compte à rebours.
  assert.match(CARTULARY_CREATION_DURATION_NOTE, /^Ordre de grandeur/);
  assert.doesNotMatch(CARTULARY_CREATION_DURATION_NOTE, /\d\s*s\b/);
  assert.doesNotMatch(CARTULARY_CREATION_DURATION_NOTE, /%/);
});
