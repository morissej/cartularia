// V7, point « décisions » (journal docs/audits/2026-09-16-execution-v7.md § 2, D3 et D5) : verrous des
// décisions du plan § V7.2 qui se lisent dans le dépôt. Aucune assertion sur l'arbre de travail (D9 : les
// copies « 2 » ne sont pas suivies par git ; ce qui est livré est verrouillé ailleurs) ; la remontée IWC
// (décision (d)) est un constat de production (journal V1 § 10), sans test.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('firebase/schema-catalog/manifest.json'));
const versionsOf = (schemaId) => Object.keys(manifest.schemas)
  .filter((key) => key.startsWith(`${schemaId}@`))
  .map((key) => key.split('@')[1])
  .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

test('décision (a), D3 A : le manifeste automobile est inchangé — seule watch est active, car@1.2.0 reste la dernière version publiée (règle latest) ; toute nouvelle version car rejoue la décision', () => {
  assert.deepEqual(Object.keys(manifest.activeVersions), ['watch'], 'aucune version automobile active dans le manifeste');
  assert.deepEqual(versionsOf('car'), ['1.0.0', '1.1.0', '1.2.0']);
  assert.equal(versionsOf('car').at(-1), '1.2.0', 'une car@1.3.0 baseline deviendrait version de création par la règle latest : décision à rejouer');
  const carSchema = read('src/schema/carSchema.ts');
  assert.match(carSchema, /export const CAR_SCHEMA_VERSION = '1\.2\.0';/);
  assert.match(carSchema, /\n  status: 'baseline',\n/);
  // Règle de création identique côté client et côté serveur (ADR-030) : version active, à défaut dernière publiée ; le statut n'est jamais lu.
  const client = read('src/services/schemaCatalog.ts');
  const clientRule = client.slice(client.indexOf('export const loadCreationSchemaVersion'), client.indexOf('export const loadVerticalSchema'));
  assert.match(clientRule, /const version = data\?\.activeVersion \|\| data\?\.latestVersion;/);
  assert.doesNotMatch(clientRule, /status/, 'la version de création ne dépend pas du statut de l’artefact');
  const server = read('scripts/lib/create-cartulary-command.mjs');
  const serverRule = server.slice(server.indexOf('export const resolveCreationSchemaVersion'), server.indexOf('return { schemaVersion: resolved'));
  assert.match(serverRule, /pointerData\?\.activeVersion \|\| pointerData\?\.latestVersion \|\| requestedVersion \|\| null/);
  assert.doesNotMatch(serverRule, /status/, 'même règle côté serveur, sans lecture du statut');
});

test('décision (b), D5 : le mini-site public /watch-website n’ouvre pas l’écoute Firestore des rappels de l’objet actif ni ne lit le stockage local des suivis', () => {
  const app = read('src/App.tsx');
  const hookCall = '\n  const followUp = useCartularyFollowUp({ cartularyId: ACTIVE_CARTULARY_ID, language, readOnlyPreview: isDemoCartulary || isWatchWebsite });\n';
  assert.ok(app.includes(hookCall), 'App.tsx : readOnlyPreview vaut isDemoCartulary || isWatchWebsite (une seule ligne, App.tsx inchangé en taille)');
  assert.ok(app.indexOf('const isWatchWebsite = window.location.pathname') < app.indexOf('const followUp = useCartularyFollowUp('), 'isWatchWebsite est défini avant le hook de suivi');
  // Le hook court-circuite l'écoute et les lectures locales sur readOnlyPreview (couvert par tests/ui/demo-follow-up-isolation.test.tsx).
  const hook = read('src/features/cartulary/state/useCartularyFollowUp.ts');
  assert.ok(hook.includes('useState<CartularyFollowUpTodo[]>(() => readOnlyPreview ? [] : readStoredTodos())'), 'aucune lecture du stockage local en aperçu');
  assert.ok(hook.indexOf('if (readOnlyPreview) {') < hook.indexOf('observeCartularyFollowUpTodos(cartularyId'), 'la garde readOnlyPreview précède l’abonnement Firestore');
  // Le mini-site est rendu avant tout usage de followUp : aucun rappel n'y est affiché.
  const websiteReturn = app.indexOf('\n  if (isWatchWebsite) {\n');
  assert.ok(websiteReturn > 0 && app.indexOf('followUp={followUp}') > websiteReturn, 'le rendu du mini-site précède les consommateurs de followUp');
});
