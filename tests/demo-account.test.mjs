import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import test from 'node:test';
import { validRegistryThumbnail } from '../scripts/lib/presentation-variants.mjs';
import { normalizeRegistryThumbnail } from '../src/domain/registryThumbnail.ts';
import sharp from 'sharp';
import {
  DEMO_REVIEWED_AT, buildDemoAccessDocuments, buildDemoAssetDocuments, buildDemoCartularyEnvelope, buildDemoCartularySections, buildDemoRegistryItem, buildDemoRegistryThumbnail, buildDemoReminderDocuments, demoValuationAmounts,
} from '../src/data/demoCartularyDocuments.ts';
import { presentationImageSetFor } from '../src/media/presentationDerivatives.ts';
import { buildDemoAccessProjections } from '../scripts/lib/demo-data-repair.mjs';
import { buildDemoCartularyAssets, DEMO_ACCOUNT, DEMO_CARTULARIES, DEMO_SUBMARINER_CARTULARY_ID, DEMO_SUBMARINER_PUBLIC_CODE, demoCartularyContentById } from '../src/data/demoCartularies.ts';
import { buildCartularyHref } from '../src/features/registry/registryCatalog.ts';

const homePage = readFileSync(new URL('../src/features/public/HomePage.tsx', import.meta.url), 'utf8');
const accountPage = readFileSync(new URL('../src/features/public/AccountAccessPage.tsx', import.meta.url), 'utf8');
const rootPage = readFileSync(new URL('../src/RootPage.tsx', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const hostingConfig = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));
const seedScript = readFileSync(new URL('../scripts/seed-demo-account.mjs', import.meta.url), 'utf8');

test('la Galerie et le Registre démo utilisent les médias et montants du Cartulaire', () => {
  for (const cartulary of DEMO_CARTULARIES) {
    const assets = buildDemoAssetDocuments(cartulary);
    const item = buildDemoRegistryItem(cartulary, 'sha256:test');
    assert.ok(assets.some((asset) => asset.id === item.primaryAssetId && asset.tags.includes('main-photo') && asset.presentationDerivative.url.startsWith('/assets/')));
    assert.equal(buildDemoCartularyEnvelope(cartulary).primaryAssetId, item.primaryAssetId);
    assert.equal(buildDemoCartularyEnvelope(cartulary).costBasis, item.costBasis);
    assert.equal(buildDemoCartularyEnvelope(cartulary).netValuation, item.netValuation);
    assert.equal(item.costBasis, cartulary.purchasePrice + demoCartularyContentById(cartulary.id).expenses.reduce((sum, entry) => sum + entry.amount, 0));
    assert.equal(item.netValuation, item.grossValuation - demoValuationAmounts(cartulary).saleCostAmount);
    assert.equal(item.netAfterTaxValuation, item.netValuation);
    assert.ok(assets.every((asset) => asset.visibility === 'secret'));
  }
  assert.match(seedScript, /buildDemoAssetDocuments\(cartulary\)/);
  assert.equal(DEMO_ACCOUNT.collectionName, 'Les cinq icônes');
  assert.match(seedScript, /name: DEMO_ACCOUNT\.collectionName/);
  assert.match(seedScript, /description: DEMO_ACCOUNT\.collectionDescription/);
});

// ---------------------------------------------------------------------------------------------
// V3 — vignettes de bundle (contrat unique K3/K8) : chaque projection démo porte `thumbnail`
// kind 'bundle', entrée exacte du catalogue statique, sans lecture d'actif ni de Storage.
test('chaque projection démo porte une vignette de bundle issue du catalogue (kind bundle, ≤ 240 px, empreinte du fichier servi)', async () => {
  const THUMBNAIL_KEYS = ['kind', 'path', 'width', 'height', 'assetId', 'sha256'];
  for (const cartulary of DEMO_CARTULARIES) {
    const item = buildDemoRegistryItem(cartulary, 'sha256:test');
    const thumbnail = item.thumbnail;
    assert.deepEqual(Object.keys(thumbnail).sort(), [...THUMBNAIL_KEYS].sort());
    assert.equal(thumbnail.kind, 'bundle');
    assert.equal(thumbnail.assetId, item.primaryAssetId);
    assert.match(thumbnail.path, new RegExp(`^/assets/demo-watches/derivatives/${cartulary.mediaSlug}/[a-z0-9-]+\\.240\\.webp$`));
    assert.ok(thumbnail.width <= 240 && thumbnail.height <= 240 && thumbnail.width > 0 && thumbnail.height > 0);
    const file = new URL(`../public${thumbnail.path}`, import.meta.url);
    const bytes = readFileSync(file);
    assert.equal(`sha256:${createHash('sha256').update(bytes).digest('hex')}`, thumbnail.sha256, `${thumbnail.path} : empreinte préfixée du fichier servi (contrat K3)`);
    assert.ok(validRegistryThumbnail(thumbnail), `${thumbnail.path} : vignette d’item valide côté serveur`);
    assert.ok(normalizeRegistryThumbnail(thumbnail), `${thumbnail.path} : vignette d’item acceptée côté client`);
    assert.ok(statSync(file).size < 12_000, `${thumbnail.path} : vignette légère`);
    const metadata = await sharp(bytes).metadata();
    assert.deepEqual([metadata.format, metadata.width, metadata.height], ['webp', thumbnail.width, thumbnail.height]);
    assert.deepEqual(buildDemoRegistryThumbnail(cartulary), thumbnail, 'vignette déterministe');
    // Rien d'autre que des chemins de fichiers : ni marque ni identifiant d'objet hors du chemin.
    assert.doesNotMatch(JSON.stringify({ ...thumbnail, path: '', assetId: '' }), /demo|rolex|breguet|tudor|audemars|jaeger/i);
  }
  // Le seed complet écrit la projection avec sa vignette ; la migration v3 la pose sur l'existant.
  assert.match(seedScript, /\.\.\.buildDemoRegistryItem\(cartulary, contentDigest\)/);
});

test('toutes les images de démonstration sont cataloguées : jamais un JPEG original pour une vignette', () => {
  for (const cartulary of DEMO_CARTULARIES) {
    for (const asset of buildDemoCartularyAssets(cartulary)) {
      if (asset.type === 'image') {
        const picture = presentationImageSetFor(asset.url);
        assert.ok(picture, `${asset.url} hors catalogue`);
        assert.ok(picture.webpSrcSet.includes('.240.webp 240w'), asset.url);
        assert.ok(picture.width >= 1024 && picture.height >= 1024, `${asset.url} : dimensions intrinsèques`);
        if (asset.thumbnailUrl) assert.ok(presentationImageSetFor(asset.thumbnailUrl), `${asset.thumbnailUrl} hors catalogue`);
      }
      if (asset.type === 'video') assert.ok(presentationImageSetFor(asset.posterUrl), `${asset.posterUrl} : affiche vidéo hors catalogue`);
    }
    for (const document of buildDemoAssetDocuments(cartulary)) {
      if (document.mediaKind === 'image') assert.ok(presentationImageSetFor(document.presentationDerivative.url), `${document.presentationDerivative.url} : Galerie sans dérivé`);
    }
  }
});

test('le seed complet garde sa double garde : options analysées en amont puis refus explicite hors émulateurs', () => {
  // demoRepairOptions refuse déjà tout seed complet hors émulateurs (tests/demo-data-repair.test.mjs) ;
  // la garde du script reste en place, lue avant toute initialisation Firebase.
  assert.match(seedScript, /const repairOptions = demoRepairOptions\(process\.argv\.slice\(2\), process\.env\);/);
  assert.match(seedScript, /if \(!usesEmulator && !allowRemote\) \{/);
  assert.ok(seedScript.indexOf('demoRepairOptions(process.argv') < seedScript.indexOf('initializeApp('));
});

test('le compte démo réunit exactement les cinq Cartulaires demandés', () => {
  assert.equal(DEMO_CARTULARIES.length, 5);
  assert.deepEqual(DEMO_CARTULARIES.map(({ brand }) => brand), [
    'Rolex',
    'Audemars Piguet',
    'Tudor',
    'Jaeger-LeCoultre',
    'Breguet',
  ]);
  assert.equal(new Set(DEMO_CARTULARIES.map(({ id }) => id)).size, 5);
  assert.equal(DEMO_SUBMARINER_CARTULARY_ID, DEMO_CARTULARIES[0].id);
  assert.ok(DEMO_ACCOUNT.password.length >= 12);
});

test('chaque Cartulaire démo est réaliste, complet et explicitement fictif', () => {
  for (const cartulary of DEMO_CARTULARIES) {
    const sections = buildDemoCartularySections(cartulary);
    const content = demoCartularyContentById(cartulary.id);
    const envelope = buildDemoCartularyEnvelope(cartulary);
    const projection = buildDemoRegistryItem(cartulary, 'sha256:test');
    assert.equal(envelope.registryId, DEMO_ACCOUNT.registryId);
    assert.equal(envelope.defaultVisibility, 'secret');
    assert.equal(envelope.publicationStatus, 'none');
    assert.equal(projection.objectCode, cartulary.publicCode);
    assert.equal(projection.projectionStatus, 'active');
    assert.ok(cartulary.description.toLocaleLowerCase('fr').includes('fictif'));
    assert.ok(cartulary.technicalSpecs.length >= 6);
    assert.ok(cartulary.documents.every((document) => document.toLocaleLowerCase('fr').includes('fict')));
    assert.ok(content);
    assert.equal(Object.values(content.specificationValues).some((value) => /à documenter|non renseigné/i.test(value)), false);
    assert.equal(content.checks.length, 6);
    assert.equal(content.documentation.length, 7);
    assert.ok(content.documentation.every(({ description }) => description.toLocaleLowerCase('fr').includes('fict')));
    assert.equal(content.comparables.length, 3);
    assert.ok(content.comparables.every(({ source }) => source.includes('Simulation Cartularia')));
    assert.equal(content.conditionReports.length, 2);
    assert.ok(content.expenses.length >= 3);
    assert.ok(content.valuationHistory.length >= 4);
    assert.deepEqual(
      content.valuationHistory.map(({ date }) => date),
      [...content.valuationHistory.map(({ date }) => date)].sort(),
    );
    assert.equal(content.valuationHistory.at(-1).midValue, cartulary.valuationMid);
    assert.ok(content.valuationHistory.every(({ source }) => /fictif|démonstration/i.test(source)));
    assert.ok(content.ownershipHistory.length > 0);
    assert.ok(content.storageCodes.length > 0);
    assert.ok(content.transmissionCodes.length > 0);
    assert.deepEqual(
      new Set(sections.map(({ schemaSectionId }) => schemaSectionId.split('.')[0])),
      new Set(['cover', 'media', 'reference', 'condition', 'value', 'publication']),
    );
  }
});

test('l’accueil ouvre la Submariner et rend le Registre démo visible', () => {
  assert.match(homePage, /DEMO_SUBMARINER_CARTULARY_ID/);
  assert.match(homePage, /\/cartulary-demo\?cartularyId=/);
  assert.match(homePage, /Registre démo/);
  assert.match(accountPage, /Ouvrir le Registre démo/);
  assert.match(accountPage, /signInToCartularia\(DEMO_ACCOUNT\.userName, DEMO_ACCOUNT\.password\)/);
});

test('le seed limite le compte partagé à la lecture', () => {
  const permissionsBlock = seedScript.match(/permissions: \[(.*?)\],\n\s+createdAt:/s)?.[1] || '';
  assert.match(permissionsBlock, /'cartulary\.read'/);
  assert.match(permissionsBlock, /'registry\.read'/);
  assert.doesNotMatch(permissionsBlock, /'cartulary\.edit'/);
  assert.doesNotMatch(permissionsBlock, /'publication\.manage'/);
});

test('les Cartulaires du compte démo utilisent le gabarit Cartulaire standard', () => {
  for (const cartulary of DEMO_CARTULARIES) {
    assert.match(buildCartularyHref(cartulary.id, '/registry/reg_cartularia_demo/items', 'watch'), /^\/cartulary-demo\?/);
  }
  assert.match(rootPage, /'cartulary-view'\s*\?\s*CartularyApp/);
});

test('le déploiement évite les vues sans style après une nouvelle version', () => {
  assert.match(mainSource, /vite:preloadError/);
  const globalHeaders = hostingConfig.hosting.headers.find(({ source }) => source === '**')?.headers || [];
  const assetHeaders = hostingConfig.hosting.headers.find(({ source }) => source === '/assets/**')?.headers || [];
  assert.ok(globalHeaders.some(({ key, value }) => key === 'Cache-Control' && value.includes('no-cache')));
  assert.ok(assetHeaders.some(({ key, value }) => key === 'Cache-Control' && value.includes('immutable')));
});

test('chaque Cartulaire remplit tous les rôles média du gabarit standard', () => {
  const expectedRoles = new Set(['main-photo', 'main-video', 'spin-3d', 'slideshow', 'accessories', 'documentation', 'other']);
  for (const cartulary of DEMO_CARTULARIES) {
    const assets = buildDemoCartularyAssets(cartulary);
    assert.deepEqual(new Set(assets.flatMap(({ tags }) => tags)), expectedRoles);
    assert.ok(assets.some(({ type, tags }) => type === 'video' && tags.includes('main-video')));
    assert.ok(assets.filter(({ type, tags }) => type === 'image' && tags.includes('spin-3d')).length >= 2);
  }
});

// ------------------------------------------------------------------------------------------------
// Enrichissement démo v2 (V2.3) : dossiers revus, rappels de Suivi et projections d'Accès.
// ------------------------------------------------------------------------------------------------

const REMINDER_KEYS = ['id', 'cartularyId', 'organizationId', 'title', 'dueAt', 'category', 'reminderStatus', 'visibility', 'source', 'createdBy'];
const REMINDER_CATEGORIES = ['insurance', 'visual_evidence', 'maintenance', 'custom'];
const REMINDER_STATUSES = ['planned', 'active', 'completed', 'dismissed'];

test('les rappels de Suivi fictifs respectent le contrat des règles et alimentent chaque état de la page Suivi', () => {
  const reminders = DEMO_CARTULARIES.flatMap((cartulary) => buildDemoReminderDocuments(cartulary, 'uid-demo'));
  assert.equal(reminders.length, 6);
  assert.equal(new Set(reminders.map(({ id }) => id)).size, 6);
  assert.deepEqual(reminders.map(({ id }) => id), DEMO_CARTULARIES.flatMap((cartulary) => buildDemoReminderDocuments(cartulary, 'uid-demo')).map(({ id }) => id), 'identifiants déterministes');
  for (const cartulary of DEMO_CARTULARIES) {
    assert.ok(buildDemoReminderDocuments(cartulary).length >= 1, `${cartulary.id} : au moins un rappel`);
    for (const reminder of buildDemoReminderDocuments(cartulary, 'uid-demo')) {
      assert.deepEqual(Object.keys(reminder).sort(), [...REMINDER_KEYS].sort(), 'clés exactement celles autorisées par firestore.rules');
      assert.match(reminder.id, new RegExp(`^rem_demo_${cartulary.mediaSlug}_[a-z]+$`));
      assert.equal(reminder.cartularyId, cartulary.id);
      assert.equal(reminder.organizationId, DEMO_ACCOUNT.organizationId);
      assert.match(reminder.dueAt, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(REMINDER_CATEGORIES.includes(reminder.category));
      assert.ok(REMINDER_STATUSES.includes(reminder.reminderStatus));
      assert.equal(reminder.visibility, 'secret');
      assert.equal(reminder.source, 'registry');
      assert.equal(reminder.createdBy, 'uid-demo');
      assert.ok(reminder.title.length > 0 && reminder.title.length <= 200);
      assert.match(reminder.title.toLocaleLowerCase('fr'), /fictif|fictive|fictives/);
    }
  }
  // Un rappel actif en retard (alerte « Échéances en retard ») et un rappel planifié à venir.
  assert.ok(reminders.some(({ reminderStatus, dueAt }) => reminderStatus === 'active' && dueAt < '2026-09-01'));
  assert.ok(reminders.some(({ reminderStatus, dueAt }) => reminderStatus === 'planned' && dueAt > '2026-09-01'));
  assert.ok(reminders.some(({ reminderStatus }) => reminderStatus === 'completed'));
  assert.ok(reminders.some(({ reminderStatus }) => reminderStatus === 'dismissed'));
  assert.ok(buildDemoReminderDocuments(DEMO_CARTULARIES[0]).length >= 1, 'la Submariner ouverte depuis l’accueil porte au moins un rappel');
});

test('les projections d’Accès fictives couvrent invitation, mandat et lien révoqué sans aucune donnée personnelle', () => {
  const accesses = buildDemoAccessDocuments();
  assert.equal(accesses.length, 3);
  assert.equal(new Set(accesses.map(({ id }) => id)).size, 3);
  for (const access of accesses) {
    assert.match(access.id, /^acc_demo_/);
    assert.equal(access.organizationId, DEMO_ACCOUNT.organizationId);
    assert.equal(access.registryId, DEMO_ACCOUNT.registryId);
    assert.equal(access.projectionStatus, 'active');
    assert.deepEqual(access.permissions, ['read']);
    assert.equal(access.sourceRevision, 1);
    assert.doesNotMatch(access.recipientLabel, /^[^\s@*]+@[^\s@]+$/, 'aucune adresse lisible');
    if (access.recipientLabel.includes('@')) assert.match(access.recipientLabel, /\.invalid$/);
    assert.match(`${access.displayTitle} ${access.recipientLabel}`.toLocaleLowerCase('fr'), /fictif|fictive|révoqué/);
    assert.ok(access.cartularyId === null || DEMO_CARTULARIES.some(({ id }) => id === access.cartularyId));
    assert.ok(access.collectionId === null || access.collectionId === DEMO_ACCOUNT.collectionId);
    assert.equal(access.scopeId, access.scopeType === 'collection' ? access.collectionId : access.cartularyId);
  }
  assert.deepEqual(accesses.map(({ accessKind }) => accessKind).sort(), ['invitation', 'mandate', 'shared_link']);
  const pending = accesses.find(({ sourceStatus }) => sourceStatus === 'pending');
  const active = accesses.find(({ sourceStatus }) => sourceStatus === 'active');
  const revoked = accesses.find(({ sourceStatus }) => sourceStatus === 'revoked');
  assert.ok(pending && pending.revokedAt === null && pending.consultationCount === 0);
  assert.ok(active && active.expiresAt === null && active.revokedAt === null, 'le mandat actif ne dérive jamais vers « expiré »');
  assert.ok(revoked && typeof revoked.revokedAt === 'string');
  // Écriture en base : dates converties, empreinte stable entre deux appels, horodatages laissés à l’écrivain.
  const [first, second] = [buildDemoAccessProjections(), buildDemoAccessProjections()];
  assert.deepEqual(first.map(({ contentHash }) => contentHash), second.map(({ contentHash }) => contentHash));
  assert.ok(first.every(({ contentHash }) => /^sha256:[a-f0-9]{64}$/.test(contentHash)));
  assert.ok(first.every((access) => typeof access.issuedAt?.toDate === 'function' && !('generatedAt' in access) && !('updatedAt' in access)));
});

test('les cinq dossiers démo sont « Complet » et datés d’une revue fictive, dans l’enveloppe comme dans la projection', () => {
  assert.equal(DEMO_REVIEWED_AT, '2026-09-01T09:00:00.000Z');
  for (const cartulary of DEMO_CARTULARIES) {
    assert.equal(buildDemoCartularyEnvelope(cartulary).completenessLevel, 'complete');
    assert.equal(buildDemoCartularyEnvelope(cartulary).lastVerifiedAt, DEMO_REVIEWED_AT);
    assert.equal(buildDemoRegistryItem(cartulary, 'sha256:test').completenessLevel, 'complete');
  }
});

test('le seed complet écrit rappels et accès fictifs sans registryInvitations, mail ni envoi', () => {
  assert.match(seedScript, /buildDemoReminderDocuments\(cartulary, demoUser\.uid\)/);
  assert.match(seedScript, /cartularies\/\$\{cartulary\.id\}\/reminders\/\$\{reminder\.id\}/);
  assert.match(seedScript, /buildDemoAccessProjections\(\)/);
  assert.match(seedScript, /registries\/\$\{DEMO_ACCOUNT\.registryId\}\/accesses\/\$\{access\.id\}/);
  assert.doesNotMatch(seedScript, /registryInvitations/);
  assert.doesNotMatch(seedScript, /['`]mail\b|\/mail\//);
  assert.doesNotMatch(seedScript, /createRegistryInvitation|sendMail|nodemailer/);
});

// ---------------------------------------------------------------------------------------------
// V2 — blocs livrés par publication-demo et retours-demo, appliqués par l'intégrateur App.tsx.
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const registryApp = readFileSync(new URL('../src/features/registry/RegistryApp.tsx', import.meta.url), 'utf8');
const publicationCommand = readFileSync(new URL('../scripts/lib/demo-publication-command.mjs', import.meta.url), 'utf8');
const publicationWrapper = readFileSync(new URL('../scripts/publish-demo-website.mjs', import.meta.url), 'utf8');

test('la commande de publication démo n’accorde aucun droit : users et memberships seulement lus, acteur demo_seed, initialisation Firebase différée', () => {
  const sensitiveLines = publicationCommand.split('\n').filter((line) => /users\/|memberships\//.test(line));
  assert.ok(sensitiveLines.length >= 2);
  for (const line of sensitiveLines) assert.doesNotMatch(line, /\.(set|update|create|delete)\(/, line);
  assert.doesNotMatch(publicationCommand, /permissions:\s*\[/);
  assert.doesNotMatch(publicationCommand, /roles:\s*\[/);
  assert.doesNotMatch(publicationCommand, /FieldValue\.arrayUnion/);
  assert.match(publicationCommand, /DEMO_AUDIT_ROLE = 'demo_seed'/);
  assert.match(publicationCommand, /demo_account_privileged/);
  assert.doesNotMatch(publicationCommand, /firebase-admin\/app|initializeApp|applicationDefault/);
  assert.match(publicationWrapper, /runDemoPublicationCli\(/);
  assert.match(publicationWrapper, /firestore: \(context\) =>/);
  assert.match(publicationWrapper, /process\.exitCode = exitCode/);
});

test('un seul objet démo est publié en V2 : la Submariner, code DEMO-ROL-124060', () => {
  assert.equal(DEMO_CARTULARIES[0].id, DEMO_SUBMARINER_CARTULARY_ID);
  assert.equal(DEMO_CARTULARIES[0].publicCode, 'DEMO-ROL-124060');
  assert.equal(DEMO_SUBMARINER_PUBLIC_CODE, 'DEMO-ROL-124060');
  assert.match(publicationCommand, /DEMO-ROL-124060|definition\.publicCode/);
  // Le client n'annonce un mini-site que constaté à l'exécution : aucune constante ne décide du « publié ».
  assert.doesNotMatch(app, /DEMO_SUBMARINER_PUBLIC_CODE/);
});

test('le retour d’un Cartulaire démo et l’écran de connexion du Registre proposent le Registre démo (V-A4, V-A5)', () => {
  assert.match(app, /resolveRegistryReturn\(routeParameters\.get\('returnTo'\), \{ demo: isDemoCartulary \}\)/);
  assert.match(app, /returnHref=\{registryReturnHref\}/);
  assert.match(app, /registryReturn\.label\[language\]/);
  assert.doesNotMatch(app, /isRegistryReturnPath/);
  assert.match(registryApp, /demoRequested=\{shouldOfferDemoRegistryEntry\(route\.registryId\)\}/);
  assert.match(registryApp, /Ouvrir le Registre démo/);
  assert.match(homePage, /DEMO_REGISTRY_HREF = DEMO_REGISTRY_ENTRY_HREF/);
});
