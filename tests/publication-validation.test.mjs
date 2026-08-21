import assert from 'node:assert/strict';
import test from 'node:test';
import { PUBLIC_BLOCK_ALLOWLIST } from '../scripts/lib/projection-command.mjs';
import {
  WEBSITE_BLOCK_ALLOWLIST,
  applyPublicationDecision,
  evaluatePublicationEligibility,
  filterRequestedWebsiteBlocks,
  getPublicationPolicy,
  isSelectionValidated,
  publicationActionFor,
  validatedBlockIds,
} from '../src/domain/publication.ts';

const publicPhoto = {
  id: 'main-photo-1',
  type: 'image',
  status: 'Archived',
  visibility: 'Tous',
  url: '/main.jpg',
};

const decision = (overrides = {}) => ({
  requestId: 'publication-test-request',
  destination: 'website',
  blockId: 'cover-watch',
  blockLabel: 'Accueil de la montre',
  action: 'activate',
  status: 'confirmed',
  decisionSource: 'human_confirmed',
  decidedAt: '2026-08-16T10:00:00.000Z',
  sourceRevision: 4,
  sourceDigest: `sha256:${'a'.repeat(64)}`,
  policyVersion: 'publication-policy-v2',
  prerequisites: [
    { id: 'brand', label: 'Marque', satisfied: true, detail: 'IWC' },
    { id: 'model', label: 'Modèle', satisfied: true, detail: 'Flieger UTC' },
    { id: 'main-photo', label: 'Photo principale', satisfied: true, detail: 'main-photo-1' },
  ],
  ...overrides,
});

test('les prérequis exigent marque, modèle et photo principale durable', () => {
  const eligible = evaluatePublicationEligibility({ brand: ' IWC ', model: 'Flieger UTC', mainPhoto: publicPhoto, destination: 'website' });
  assert.equal(eligible.isEligible, true);
  assert.deepEqual(eligible.missing, []);

  const missing = evaluatePublicationEligibility({ brand: ' ', model: '', mainPhoto: { ...publicPhoto, status: 'Processing' }, destination: 'website' });
  assert.equal(missing.isEligible, false);
  assert.deepEqual(missing.missing, ['brand', 'model', 'main-photo']);
});

test('la visibilité de la photo est contrôlée selon chaque destination', () => {
  const secretPhoto = { ...publicPhoto, visibility: 'Secret' };
  assert.equal(evaluatePublicationEligibility({ brand: 'IWC', model: 'UTC', mainPhoto: secretPhoto, destination: 'website' }).isEligible, false);
  assert.equal(evaluatePublicationEligibility({ brand: 'IWC', model: 'UTC', mainPhoto: secretPhoto, destination: 'community' }).isEligible, false);
  assert.equal(evaluatePublicationEligibility({ brand: 'IWC', model: 'UTC', mainPhoto: secretPhoto, destination: 'report' }).isEligible, true);
  assert.equal(evaluatePublicationEligibility({ brand: 'IWC', model: 'UTC', mainPhoto: secretPhoto, destination: 'collection' }).isEligible, false);
});

test('la liste blanche W du client reste identique à la commande serveur', () => {
  assert.deepEqual([...WEBSITE_BLOCK_ALLOWLIST].sort(), [...PUBLIC_BLOCK_ALLOWLIST].sort());
  assert.equal(getPublicationPolicy('website', 'cover-owner').allowed, false);
  assert.equal(getPublicationPolicy('website', 'cover-ownership-history').allowed, false);
  assert.equal(getPublicationPolicy('website', 'value-market').allowed, false);
  assert.equal(getPublicationPolicy('report', 'cover-owner').allowed, false);
  assert.equal(getPublicationPolicy('report', 'cover-ownership-history').allowed, true);
  assert.equal(getPublicationPolicy('report', 'cover-storage').allowed, false);
  assert.equal(getPublicationPolicy('community', 'cover-owner').allowed, false);
  assert.equal(getPublicationPolicy('community', 'cover-ownership-history').allowed, false);
  assert.equal(getPublicationPolicy('collection', 'media-hero').allowed, true);
  assert.equal(getPublicationPolicy('collection', 'cover-storage').allowed, false);
});

test('une sélection historique sans décision humaine reste en attente de validation', () => {
  const digest = `sha256:${'a'.repeat(64)}`;
  assert.equal(isSelectionValidated({ selected: true, destination: 'website', blockId: 'cover-watch', decisions: [], sourceDigest: digest, sourceRevision: 4 }), false);
  assert.equal(publicationActionFor({ selected: true, validated: false }), 'validate');
  assert.deepEqual(validatedBlockIds(['cover-watch'], 'website', [], digest, 4), []);
});

test('la décision doit correspondre au digest courant et la révocation retire le bloc', () => {
  const digest = `sha256:${'a'.repeat(64)}`;
  assert.equal(isSelectionValidated({ selected: true, destination: 'website', blockId: 'cover-watch', decisions: [decision()], sourceDigest: digest, sourceRevision: 4 }), true);
  assert.equal(isSelectionValidated({ selected: true, destination: 'website', blockId: 'cover-watch', decisions: [decision()], sourceDigest: `sha256:${'b'.repeat(64)}`, sourceRevision: 4 }), false);
  assert.equal(isSelectionValidated({ selected: true, destination: 'website', blockId: 'cover-watch', decisions: [decision()], sourceDigest: digest, sourceRevision: 5 }), false);
  assert.deepEqual(applyPublicationDecision(['cover-watch'], decision({ action: 'revoke' })), []);
});

test('un paramètre blocks forgé ne peut pas contourner sélection, validation ou liste blanche', () => {
  assert.deepEqual(
    filterRequestedWebsiteBlocks(['cover-owner', 'cover-watch', 'media-hero'], ['cover-watch']),
    ['cover-watch'],
  );
});
