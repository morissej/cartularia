import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  CARTULARY_PRESENTATION_CONTRACT_VERSION,
  COMMON_CARTULARY_STRUCTURE,
  cartularyPageDefinitions,
  cartularyPageForSchemaSection,
  SPECIALIZED_CARTULARY_SECTIONS,
} from '../src/features/cartulary/presentation/cartularyPresentationContract.ts';
import { filterPublicationBlockIds, getPublicationPolicy, PUBLISHED_BLOCK_IDS } from '../src/domain/publication.ts';
import { cartularyIdFromLocation, IWC_CARTULARY_ID } from '../src/domain/cartularyIds.ts';

test('tous les Cartulaires partagent les six pages et les structures communes', () => {
  assert.equal(CARTULARY_PRESENTATION_CONTRACT_VERSION, 'cartulary-presentation@1.4.0');
  assert.deepEqual(cartularyPageDefinitions('FR').map(({ id }) => id), ['cover', 'media', 'reference', 'condition', 'value', 'publication']);
  assert.deepEqual(COMMON_CARTULARY_STRUCTURE.map(({ id }) => id), [
    'cover.collection',
    'cover.todos',
    'condition.storage',
    'condition.transmission',
    'reference.reports',
    'publication.cartulary',
    'publication.collections',
    'publication.community',
    'publication.report',
  ]);
  assert.equal(cartularyPageForSchemaSection('technical.powertrain'), 'reference');
  assert.equal(cartularyPageForSchemaSection('history.service'), 'condition');
  assert.equal(cartularyPageForSchemaSection('value.market'), 'value');
  assert.equal(cartularyPageForSchemaSection('publication.report'), 'publication');
});

test('les deux lecteurs existants consomment le même contrat de présentation', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const generic = readFileSync(new URL('../src/components/GenericCartularyView.tsx', import.meta.url), 'utf8');
  for (const source of [app, generic]) {
    assert.match(source, /CARTULARY_PRESENTATION_CONTRACT_VERSION/);
    assert.match(source, /cartularyPageDefinitions/);
    assert.match(source, /data-cartulary-presentation-version/);
  }
});

test('la page Publication sélectionne les contenus autorisés sans confirmation à chaque case, puis confirme au serveur', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const sliceBetween = (source, from, to, label) => {
    const start = source.indexOf(from); const end = source.indexOf(to);
    assert.ok(start >= 0 && end > start, `tranche ${label} introuvable`);
    return source.slice(start, end);
  };
  const table = readFileSync(new URL('../src/features/cartulary/components/PublicationSelectionTable.tsx', import.meta.url), 'utf8');
  const model = readFileSync(new URL('../src/features/cartulary/components/publicationSummaryModel.ts', import.meta.url), 'utf8');
  const summary = readFileSync(new URL('../src/features/cartulary/components/PublicationReadOnlySummary.tsx', import.meta.url), 'utf8');
  // V4 P-D4 : une seule table de sélection, rendue une fois, alimentée par les quatre tranches et les commandes existantes.
  assert.equal((app.match(/<PublicationSelectionTable\b/g) ?? []).length, 1);
  assert.doesNotMatch(app, /renderPublicationBlockSelector/);
  assert.match(app, /<PublicationSelectionTable[\s\S]{0,400}onToggle=\{togglePublicationBlock\}\s*onReplace=\{replacePublicationBlocks\}/);
  const commands = sliceBetween(app, 'const replacePublicationBlocks', 'const ownershipSummary', 'commandes de publication');
  assert.match(commands, /const togglePublicationBlock[\s\S]{0,120}if \(!canEdit\) return;[\s\S]{0,80}getPublicationPolicy\(destination, blockId\)\.allowed/);
  assert.doesNotMatch(commands, /requestPublicationChange|À valider/);
  assert.match(table, /Tout sélectionner/);
  assert.doesNotMatch(table, /requestPublicationChange|À valider|firebase|firestore|isDemoCartulary/i, 'composant pur, sans validation par case');
  assert.doesNotMatch(table, /getPublicationPolicy\(/, 'la politique est portée par cellState (modèle), jamais recodée dans la table');
  assert.match(table, /aria-labelledby=\{`\$\{idPrefix\}-row-\$\{definition\.id\} \$\{idPrefix\}-col-\$\{destination\}`\}/, 'chaque case est nommée par sa ligne et sa colonne');
  assert.match(table, /cellState\(destination, definition/);
  assert.match(table, /Non proposé pour cette destination/);
  assert.match(model, /getPublicationPolicy\(destination, definition\.id\)\.allowed/);
  // D4-B : trois destinations à sélection de contenus, une seule constante.
  assert.match(model, /export const DESTINATIONS: readonly PublicationDestination\[\] = \['website', 'community', 'report'\];/);
  // Parité éditeur/lecture : les deux tables lisent le même modèle ; D6 (a) : même note Cercle des deux côtés.
  for (const source of [table, summary]) { assert.match(source, /from '\.\/publicationSummaryModel\.ts'/); assert.match(source, /communityPublicationNote\(language\)/); }
  assert.doesNotMatch(summary, /const DESTINATIONS\b|const DESTINATION_LABELS\b|getPublicationPolicy/);
  assert.match(summary, /la Collection renvoie au mini-site de l’objet ; aucune sélection de contenus propre/);
  assert.match(app, /La Collection renvoie au mini-site de l’objet ; aucune sélection de contenus propre/, 'l’article 02 de l’éditeur dit la même chose que la carte 02 du résumé');
  for (const destination of ['website', 'collection', 'community', 'report']) {
    const selection = filterPublicationBlockIds(destination, PUBLISHED_BLOCK_IDS);
    assert.ok(selection.length > 0);
    assert.ok(selection.every((id) => getPublicationPolicy(destination, id).allowed));
    for (const personal of ['cover-owner', 'cover-transmission', 'cover-storage']) assert.equal(selection.includes(personal), false);
  }
  assert.match(app, /Mini-site de votre objet/);
  assert.match(app, /<PublicWebsitePublicationPanel[^>]+blocks=\{websiteDraftRequest\(websiteDraft\)\}/);
  assert.match(app, /Valider au niveau Collection/);
  assert.match(app, /Valider la publication dans Le Cercle/);
  assert.match(app, /loadCartularyCollectionContext\(mockCartulary\.id, requestedRegistryId\)/);
  assert.match(app, /Associer le Cartulaire à plusieurs collections/);
  assert.match(app, /orderedReportBlocks\.length === 0/);
  assert.match(app, /downloadTextPdf/);
  assert.doesNotMatch(app, /window\.print\(\)/);
  assert.match(app, /localCollectionWebsiteUrl/);
  assert.match(app, /localCommunityWebsiteUrl/);
  // V2, décision (b) : la branche éditeur est enveloppée par le droit de gérer, jamais remplacée.
  assert.match(app, /canManagePublication \? \(\s*<div className="publication-center">/);
  assert.match(app, /<PublicationReadOnlySummary[\s\S]{0,900}publishedWebsiteUrl=\{publishedWebsiteUrl\}[\s\S]{0,600}onPrintReport=\{handleReportPrint\}/);
  assert.doesNotMatch(app, /isDemoCartulary\s*\?\s*\(?\s*<PublicationReadOnlySummary/);
  assert.match(app, /if \(isDemoCartulary \|\| isWatchWebsite\) return;[\s\S]{0,1500}Collections indisponibles/);
  assert.match(app, /if \(isDemoCartulary\) return; \/\/ démonstration : aucune journalisation locale/);
  // Publication absente ou révoquée : état définitif, sans bouton « Réessayer », avec retour à l’accueil.
  assert.match(app, /setPublicProjectionError\('Publication absente ou révoquée\.'\);\s*setPublicProjectionAbsent\(true\);/);
  assert.match(app, /!publicProjectionLoading && !publicProjectionAbsent && <button[^\n]*Réessayer/);
  assert.match(app, /!publicProjectionLoading && publicProjectionAbsent && <a className="button button--quiet" href="\/">/);
  // Décision (c) : la garde de démonstration ne coupe que la journalisation locale, jamais la préparation ni l’impression du rapport.
  const reportPrintBody = sliceBetween(app, 'const handleReportPrint', 'const handleDeleteAllData', 'handleReportPrint');
  const demoGuardIndex = reportPrintBody.indexOf('if (isDemoCartulary) return; // démonstration');
  assert.ok(demoGuardIndex > 0, 'garde de démonstration présente dans handleReportPrint');
  assert.ok(reportPrintBody.indexOf('reportPreparation.prepare()') < demoGuardIndex, 'la préparation du rapport précède la garde de démonstration');
  assert.ok(reportPrintBody.indexOf('downloadTextPdf(') < demoGuardIndex, 'l’impression du rapport précède la garde de démonstration');
  assert.ok(reportPrintBody.search(/journal\s*\.logEvent\(/) > demoGuardIndex, 'la journalisation locale suit la garde de démonstration');
});

test('l’aperçu local conserve le Cartulaire choisi sans changer une autre surface', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /localPublicationPreviewAllowed/);
  assert.match(app, /blocks: approvedWebsiteBlocks\.join\(','\)/);
  assert.match(app, /href=\{localPublicationPreviewUrl\}/);
  assert.match(app, /localPublicationPreviewAllowed\s*\? requestedPublishedBlocks \?\? approvedWebsiteBlocks/);
  assert.equal(cartularyIdFromLocation({ pathname: '/watch-website', search: '?preview=local&cartularyId=cart_fixture_object' }), 'cart_fixture_object');
  assert.equal(cartularyIdFromLocation({ pathname: '/registry', search: '?preview=local&cartularyId=cart_fixture_object' }), IWC_CARTULARY_ID);
  assert.equal(cartularyIdFromLocation({ pathname: '/watch-website', search: '?preview=local&cartularyId=../private' }), IWC_CARTULARY_ID);
});

test('le Cartulaire propriétaire ne propose plus de faux mode de consultation', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /Mode de consultation|Viewing mode|Choisir les données visibles|setAudience|AUDIENCE_STORAGE_KEY/);
  assert.doesNotMatch(css, /audience-toolbar/);
});

test('le mini-site publié reprend les pages du Cartulaire et préserve le ratio des images', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.match(app, /const publishedWebsitePages = pages/);
  assert.match(app, /page\.id !== 'publication'/);
  assert.match(app, /publicationPageNumberByBlock\.get\(blockId\) === page\.number/);
  assert.match(app, /page-tabs watch-website__tabs/);
  assert.match(app, /activeWebsitePage\.blockIds\.map/);
  assert.match(app, /setActivePage\(page\);\s*window\.location\.hash = page/);
  assert.doesNotMatch(app, /pathname\.replace\(\/\\\/\$\/, ''\) === '\/watch-website'\) return/);
  assert.match(app, /data-cartulary-presentation-version=\{CARTULARY_PRESENTATION_CONTRACT_VERSION\}/);
  assert.match(css, /\.watch-website__hero > \.presentation-picture > img[^}]+object-fit: contain/s);
});

test('ADR-028 : un seul lecteur, piloté par l’enveloppe et le schéma, pour tout type d’objet', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const catalog = readFileSync(new URL('../src/features/registry/registryCatalog.ts', import.meta.url), 'utf8');
  const rootPage = readFileSync(new URL('../src/RootPage.tsx', import.meta.url), 'utf8');
  assert.match(app, /useAuthoritativeCartulary\(ACTIVE_CARTULARY_ID/);
  for (const page of ['cover', 'media', 'reference', 'condition', 'value', 'publication']) {
    assert.match(app, new RegExp(`<GenericSchemaPageSections page="${page}"`), `page ${page} sans sections génériques`);
  }
  assert.doesNotMatch(catalog, /cartulary-view/, 'le Registre ne doit plus aiguiller par type d’objet');
  assert.doesNotMatch(catalog, /assetType === 'watch'/);
  assert.match(rootPage, /'cartulary-view'\s*\?\s*CartularyApp/);
});

test('ADR-028 : les blocs spécialisés ne s’affichent que si le schéma porte leur section', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  for (const sectionId of ['media.hero', 'reference.origins', 'reference.specifications', 'reference.checks', 'reference.popularity', 'condition.description', 'condition.summary', 'condition.documentation', 'condition.reports', 'value.market_depth', 'value.comparables', 'value.cost_basis', 'value.performance', 'value.sensitivity']) {
    assert.match(app, new RegExp(`schemaHas\\('${sectionId.replace('.', '\\.')}'\\)`), `bloc ${sectionId} non conditionné`);
  }
});

test('ADR-028 : la liste des sections spécialisées ne cite que des sections publiées du catalogue', () => {
  const published = new Set(['watch/1.6.0', 'car/1.2.0'].flatMap((path) => JSON.parse(readFileSync(new URL(`../firebase/schema-catalog/${path}.json`, import.meta.url), 'utf8')).sections));
  for (const sectionId of SPECIALIZED_CARTULARY_SECTIONS) assert.ok(published.has(sectionId), `${sectionId} absent du catalogue`);
  assert.ok(!SPECIALIZED_CARTULARY_SECTIONS.includes('technical.powertrain'), 'les sections propres à une autre verticale restent génériques');
});

// ADR-026, durcissement du 2026-09-08 : aucune condition par marque ou identifiant de Cartulaire
// dans l'application. Les seules mentions tolérées sont des fixtures de seed, des migrations datées
// et la correspondance de routage des codes publics du pilote.
const IDENTITY_ALLOWLIST = [
  'src/domain/cartularyIds.ts',
  'src/bootstrap/applicationBootstrap.ts',
  'src/persistence/localVault.ts',
  'src/data/mockData.ts',
];
const IDENTITY_PATTERN = /isIwcCartulary|isRolexCartulary|IWC_CARTULARY_ID|ROLEX_CARTULARY_ID|cart_iwc_flieger|cart_rolex_gmt|ROL-487D9CAD|OP-4892-XZ9/;
const BRAND_CONDITION_PATTERN = /\b(?:brand|makerName|maker)\s*(?:===|!==|==)\s*['"](?!all['"])[^'"]+['"]/;
// « brand » désigne ici le champ de conteneur QuickTime/MP4, pas une marque d'objet.
const BRAND_ALLOWLIST = ['src/security/fileValidation.ts'];

const walkSources = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  if (entry.isDirectory()) return walkSources(path);
  return /\.(ts|tsx)$/.test(entry.name) && !/ 2\.(ts|tsx)$/.test(entry.name) ? [path] : [];
});
const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
const relativeSource = (path) => `src/${relative(sourceRoot, path).split(sep).join('/')}`;

test('ADR-026 durci : aucune condition par marque ou identifiant hors fixtures, migrations datées et routage', () => {
  const offenders = [];
  for (const path of walkSources(sourceRoot)) {
    const relativePath = relativeSource(path);
    if (relativePath.startsWith('src/migrations/') || IDENTITY_ALLOWLIST.includes(relativePath)) continue;
    const source = readFileSync(path, 'utf8');
    const identity = source.match(IDENTITY_PATTERN);
    if (identity) offenders.push(`${relativePath} : ${identity[0]}`);
    const brand = BRAND_ALLOWLIST.includes(relativePath) ? null : source.match(BRAND_CONDITION_PATTERN);
    if (brand) offenders.push(`${relativePath} : ${brand[0]}`);
  }
  assert.deepEqual(offenders, []);
  const bootstrap = readFileSync(new URL('../src/bootstrap/applicationBootstrap.ts', import.meta.url), 'utf8');
  assert.match(bootstrap, /Migration datée \(ADR-029\)/, 'l’hydratation IWC reste documentée comme migration datée');
  const active = readFileSync(new URL('../src/data/activeCartulary.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(active, /mockData/, 'le Cartulaire actif ne lit plus la fixture IWC');
});

test('ADR-026 durci : le mode démonstration ne décide ni des pages ni des structures communes', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  for (const page of ['CoverPage', 'MediaPage', 'ReferencePage', 'ConditionPage', 'ValuePage', 'PublicationPage']) {
    assert.doesNotMatch(app, new RegExp(`isDemoCartulary\\s*(?:&&|\\?)\\s*\\(?\\s*<${page}\\b`), `${page} conditionnée par la démo`);
  }
  assert.doesNotMatch(app, /isDemoCartulary\s*(?:&&|\?)\s*\(?\s*<CartularyTodoBoard\b/);
  assert.doesNotMatch(app, /isDemoCartulary\s*(?:&&|\?)\s*\(?\s*<GenericSchemaPageSections\b/);
});

test('V2 décision (b) : la page Publication bascule en rendu lecture sur le droit de gérer, sans branche démo sur les structures communes', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  // La bascule ne dépend que du droit reconnu par le serveur (faux en démonstration, hook désactivé).
  assert.match(app, /const canManagePublication = authoritative\.canManage;/);
  const publication = app.slice(app.indexOf('<PublicationPage'), app.indexOf('</PublicationPage>'));
  assert.doesNotMatch(publication, /isDemoCartulary\s*(?:&&|\?)\s*\(?\s*</, 'aucune structure de la page Publication n’est conditionnée par la démo');
  // Les quatre structures communes restent dans la branche éditeur, et le rendu lecture est un seul composant pur.
  for (const scope of ['cartulary', 'collection', 'community', 'report']) assert.match(publication, new RegExp(`publication-scope--${scope}`));
  assert.match(publication, /\) : \(\s*<PublicationReadOnlySummary/);
  assert.match(publication, /demonstration=\{isDemoCartulary\}/, 'la démo ne fournit que les textes contextuels');
  const summary = readFileSync(new URL('../src/features/cartulary/components/PublicationReadOnlySummary.tsx', import.meta.url), 'utf8');
  for (const title of ['Mini-site de votre objet', 'Publiez votre objet dans une Collection', 'Publiez votre objet dans Le Cercle', 'Rapport PDF']) assert.match(summary, new RegExp(title));
  assert.doesNotMatch(summary, /firebase|firestore|isDemoCartulary/i);
});

test('le panneau Preuves reçoit le mode lecture et la publication constatée depuis App.tsx (V2 messages-techniques)', () => {
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const start = appSource.indexOf('<AuditPanel');
  const auditPanelBlock = appSource.slice(start, appSource.indexOf('/>', start));
  // V5 point 1 (2/2, I4) : la lecture suit le droit de gérer (canEdit) ; la démo ne fournit que les textes (ADR-026).
  assert.match(auditPanelBlock, /readOnly=\{!canEdit\}/);
  assert.match(auditPanelBlock, /demonstration=\{isDemoCartulary\}/);
  assert.doesNotMatch(auditPanelBlock, /readOnly=\{isDemoCartulary\}/);
  assert.match(auditPanelBlock, /publishedWebsiteUrl=\{publishedWebsiteUrl\}/);
  assert.match(auditPanelBlock, /demoRegistryProofsHref=\{isDemoCartulary \?/);
  assert.match(appSource, /const handleDeleteAllData = async \(\) => \{\s*if \(isDemoCartulary\) return;/);
  assert.match(appSource, /useEffect\(\(\) => \{\s*if \(isDemoCartulary\) return undefined;[\s\S]{0,200}journal\.reconcileSnapshot/);
  // Décision (c) étendue : la consultation démo n'écrit pas non plus l'événement d'accès dans le navigateur.
  assert.match(appSource, /useEffect\(\(\) => \{\s*if \(isDemoCartulary\) return;[^\n]*\n\s*journal\s*\.logEvent\(\s*'ACCESS_CARTULARY'/);
  // Les autres journalisations locales sont derrière des gestes d'édition (canEdit) ou le mode propriétaire du panneau Preuves.
  // V4 D5 : 6 → 5, le dialogue de décision par bloc (PUBLICATION_SELECTION_CONFIRMED / _REVOKED) a été retiré avec son chemin mort.
  assert.equal((appSource.match(/journal\s*\.logEvent\(/g) ?? []).length, 5);
  assert.match(appSource, /loadPublicPublicationSummaries\(\[cartularyPublicCode\]\)/);
  // Le compte « en ligne » du résumé lecture vient des blocs réellement publiés, jamais de la sélection démo.
  assert.match(appSource, /setPublishedWebsiteBlockIds\(summary\?\.published === true \? summary\.blockIds : null\)/);
  assert.match(appSource, /publishedWebsiteBlockIds=\{publishedWebsiteBlockIds\}/);
  // Décision (d) : le lien mini-site dérive uniquement de l'état constaté, jamais d'une constante.
  assert.match(appSource, /const publishedWebsiteUrl = websitePublished \? publicShareUrl : null;/);
  // V4 relecture H4 : la source du « publié » (QR, résumé lecture) est la lecture de publications/{code}, remise à faux sur échec.
  assert.match(appSource, /setWebsitePublished\(summary\?\.published === true\);/);
  assert.match(appSource, /\.catch\(\(\) => \{ if \(active\) \{ setWebsitePublished\(false\); setPublishedWebsiteBlockIds\(null\); \} \}\);/);
  // V4 point 2 : code public réel, plus d'adresse dérivée du code, relecture du constat après chaque action du panneau.
  assert.match(auditPanelBlock, /publicShareCode=\{cartularyPublicCode\}/);
  assert.doesNotMatch(auditPanelBlock, /publicShareUrl=|seal\?\.supportCode/);
  assert.match(appSource, /<PublicWebsitePublicationPanel[^\n]*language=\{language\} onStateChanged=\{\(\) => setWebsitePublicationCheck\(\(value\) => value \+ 1\)\}/);
  assert.match(appSource, /\[cartularyPublicCode, isWatchWebsite, websitePublicationCheck\]\);/);
  // QR de partage : un seul composant, alimenté par la seule adresse publiée, monté sous publishedWebsiteUrl dans les deux branches.
  const auditPanelSource = readFileSync(new URL('../src/components/AuditPanel.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(auditPanelSource, /publicShareUrl|from 'qrcode'|fiche publique/);
  assert.match(auditPanelSource, /publishedWebsiteUrl\s*\?\s*<div[^\n]*<PublishedWebsiteQr/);
  assert.match(auditPanelSource, /\{publishedWebsiteUrl && \([\s\S]{0,1200}<PublishedWebsiteQr/);
  assert.match(auditPanelSource, /Aucun mini-site publié : le QR code de partage apparaît une fois la publication confirmée depuis la page Publication\./);
  const qrImporters = walkSources(sourceRoot).filter((path) => readFileSync(path, 'utf8').includes("from 'qrcode'")).map(relativeSource);
  assert.deepEqual(qrImporters, ['src/components/PublishedWebsiteQr.tsx']);
  // États du panneau (vocabulaire du plan) et demande persistée par onglet (lot B) : libellés nommés, jamais « en cours » sans « demandé(e) ».
  const panelSource = readFileSync(new URL('../src/components/PublicWebsitePublicationPanel.tsx', import.meta.url), 'utf8');
  assert.match(panelSource, /Publication demandée · en cours \(10 à 30 s\)…/);
  assert.match(panelSource, /Retrait demandé · en cours…/);
  assert.doesNotMatch(panelSource, /Publication en cours…|Retrait en cours…/);
  assert.match(panelSource, /Demande conservée, confirmation serveur non reçue/);
  assert.match(panelSource, /readWebsiteRequestSession\(cartularyId\)/);
});

// V3 — contrat unique des dérivés (K4, K6, K9) : variantes de présentation, jamais de repli sur l'original, aucune branche démo.
const readSource = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('V3 K6 : séquence 360° et grille d’impression chargées à la demande, dérivés du bundle par catalogue', () => {
  const app = readSource('../src/App.tsx');
  const block = app.slice(app.indexOf("case 'media-spin':"), app.indexOf("case 'media-library':"));
  assert.match(block, /<SpinSequence images=\{spinAssets\} language=\{language\} \/>/);
  assert.doesNotMatch(block, /<Spin360/);
  assert.match(block, /\{forPrint && \(\s*<div className="report-slideshow-gallery">/);
  assert.doesNotMatch(app, /import\('\.\/components\/Spin360\.tsx'\)/);
  assert.equal((app.match(/fetchPriority="high"/g) ?? []).length, 2);
  const derivatives = readSource('../src/media/presentationDerivatives.ts');
  assert.doesNotMatch(derivatives, /\/assets\/IWC\//);
  const spinSequence = readSource('../src/components/SpinSequence.tsx');
  assert.match(spinSequence, /<PrivateMediaImage asset=\{poster\}[^>]*role="stage"/);
  const reportItem = readSource('../src/components/ReportMediaItem.tsx');
  assert.match(reportItem, /role=\{original \? 'original' : 'stage'\}/);
});

test('V3 K4 : App.tsx et PrivateMediaImage ne servent que des variantes ; l’original n’est jamais un repli', () => {
  const app = readSource('../src/App.tsx');
  const privateImage = readSource('../src/components/PrivateMediaImage.tsx');
  const privateMedia = readSource('../src/services/privateMedia.ts');
  const failure = readSource('../src/utils/mediaFailure.ts');
  // App.tsx : aucune acquisition directe d'original, aucun rôle 'original' posé par le lecteur, aucune lecture de presentation-v2.
  assert.doesNotMatch(app, /acquirePrivateMediaObjectUrl\(/);
  assert.doesNotMatch(app, /role="original"/);
  assert.doesNotMatch(app, /presentation-v2|getDownloadURL|private-derivatives/);
  for (const role of ['thumbnail', 'stage']) assert.match(app, new RegExp(`<PrivateMediaImage[^>]*role="${role}"`));
  // Modale : l'original ne s'affiche que sur action explicite, liée à la capacité reconnue par le serveur (tour 4, point 7) —
  // jamais à une branche démo ni au seul droit d'édition local (un membre non propriétaire recevrait un « shared-unavailable »).
  assert.match(app, /originalOnDemand=\{authoritative\.canManage\}/);
  assert.doesNotMatch(app, /originalOnDemand=\{!?isDemoCartulary\}|originalOnDemand=\{canEdit\}/);
  // PrivateMediaImage : un seul chemin vers l'original (rôle explicite) ; le rejet d'une variante mène à un état, pas à l'original.
  assert.match(privateImage, /role\?: PrivateMediaImageRole;/);
  assert.match(privateImage, /role = 'stage',/);
  const resolve = privateImage.slice(privateImage.indexOf('const resolve = () => {'), privateImage.indexOf('if (eager || typeof IntersectionObserver'));
  assert.equal((resolve.match(/acquirePrivateMediaObjectUrl\(/g) ?? []).length, 1);
  assert.match(resolve, /role === 'original'\s*\?/);
  const rejection = resolve.slice(resolve.indexOf('.catch('));
  assert.doesNotMatch(rejection, /acquirePrivate|import\(/, 'le rejet d’une variante ne déclenche aucune acquisition');
  assert.match(rejection, /const kind = mediaFailureKind\(error\);[^]*?setFailureKind\(kind\)/);
  assert.match(privateImage, /data-media-failure=\{failureKind\}/);
  // Deux états de dérivé distincts (décision (d)) : 'pending' (« Aperçu en préparation », reprise offerte) et
  // 'unavailable' (« Copie de présentation non produite », échec définitif consigné : aucune reprise) ; jamais confondus.
  assert.match(privateImage, /failureKind === 'derivative-pending' \? 'pending' : failureKind === 'derivative-failed' \|\| failureKind === 'shared-unavailable' \? 'unavailable' : null/);
  assert.match(privateImage, /data-media-state=\{derivativeState \?\? 'error'\}/);
  assert.match(privateImage, /derivativeState === 'unavailable' \? null :/);
  assert.doesNotMatch(privateImage, /presentation-v2|getDownloadURL/);
  // Service : les variantes se lisent par getBlob sous règles, jamais presentation-v2 ; l'état « Aperçu en préparation » existe.
  // Section « variantes » du service : lecture du manifeste (état des dérivés), helper d'état, acquisition.
  const presentation = privateMedia.slice(privateMedia.indexOf('const loadPresentationFromManifest'), privateMedia.indexOf('export const releasePrivateMediaObjectUrl'));
  assert.match(presentation, /getBlob\(/);
  assert.doesNotMatch(presentation, /getDownloadURL\(|acquirePrivateMediaObjectUrl\(/);
  assert.doesNotMatch(privateMedia, /loadPrivateMediaObjectUrl/, 'export mort retiré : un seul chemin vers l’original, acquirePrivateMediaObjectUrl');
  assert.match(presentation, /'derivative-pending'/);
  assert.match(presentation, /'derivative-failed'/);
  assert.match(presentation, /presentationDerivativeStateFromBinaryRecord\(/);
  assert.match(failure, /'derivative-pending': \['Aperçu en préparation', 'Preview in preparation'\]/);
  assert.match(failure, /'derivative-failed': \['Copie de présentation non produite', 'Presentation copy not produced'\]/);
});

test('V3 tour 4 : original du rapport à la préparation seulement, getDownloadURL réservé à l’original explicite, rôles explicites, thumbnailStatus', () => {
  const app = readSource('../src/App.tsx');
  const privateImage = readSource('../src/components/PrivateMediaImage.tsx');
  const privateMedia = readSource('../src/services/privateMedia.ts');
  const reportItem = readSource('../src/components/ReportMediaItem.tsx');
  const projectedBlock = readSource('../src/components/ProjectedPublicBlock.tsx');
  // Point 3 : le rapport est monté sous la préparation explicite ; ReportPrintImage est le seul à répondre « true » au signal
  // d'absence de variante (il bascule alors sur l'original, par binaire) ; PrivateMediaImage n'acquiert jamais l'original de lui-même.
  assert.match(app, /\{orderedReportBlocks\.length > 0 && reportPreparation\.active && \(\s*<div className="report-print-view"/);
  assert.match(app, /renderWatchWebsiteBlock\(blockId, reportPreparation\.active\)/);
  assert.match(reportItem, /onDerivativeUnavailable=\{\(\) => \{ setOriginalFor\(asset\.binaryId \?\? null\); return true; \}\}/);
  assert.match(reportItem, /export function ReportPrintImage/);
  const srcFiles = walkSources(sourceRoot);
  const usersOf = (pattern) => srcFiles.filter((file) => pattern.test(readFileSync(file, 'utf8'))).map((file) => relativeSource(file)).sort();
  const derivativeHandlerUsers = usersOf(/onDerivativeUnavailable/);
  assert.deepEqual(derivativeHandlerUsers, ['src/components/PrivateMediaImage.tsx', 'src/components/ReportMediaItem.tsx'], 'le repli sur l’original n’existe que pour l’impression du rapport');
  const rejection = privateImage.slice(privateImage.indexOf('.catch('), privateImage.indexOf('if (eager || typeof IntersectionObserver'));
  assert.match(rejection, /derivativeHandlerRef\.current\?\.\(kind\) === true\) return;/);
  assert.doesNotMatch(rejection, /acquirePrivate|import\(/);
  // Les grilles imprimées d'App.tsx passent par ReportPrintImage / ReportMediaItem ; aucun rôle « original » dans App.tsx.
  const spinPrint = app.slice(app.indexOf("case 'media-spin':"), app.indexOf("case 'media-slideshow':"));
  assert.match(spinPrint, /forPrint \? <div className="report-slideshow-gallery__grid">\{spinAssets\.map\(\(asset\) => <figure key=\{asset\.id\}><ReportPrintImage /);
  const libraryStart = app.indexOf("case 'media-library':");
  const libraryEnd = app.indexOf("\n      case '", libraryStart + 1);
  const library = app.slice(libraryStart, libraryEnd === -1 ? libraryStart + 6_000 : libraryEnd);
  assert.match(library, /forPrint\s*\?\s*<ReportPrintImage /);
  assert.match(library, /: <PrivateMediaImage asset=\{asset\} alt="" sizes="\(max-width: 720px\) 50vw, 33vw" role="thumbnail" \/>/);
  assert.doesNotMatch(app, /role="original"|role=\{[^}]*'original'/);
  // Point 4 : plus d'export mort ; getDownloadURL n'existe que pour l'original explicite (une seule occurrence, dans
  // downloadPrivateStorageBlob, appelé une seule fois par acquirePrivateMediaObjectUrl) ; ailleurs dans src/, seul le
  // rapatriement explicite d'un original cloud vers le coffre local (cloudDraft.ts, résolution de conflit) l'emploie.
  assert.doesNotMatch(privateMedia, /loadPrivateStorageObjectUrl|ownerUidFromPrivateDraftStoragePath/);
  assert.equal((privateMedia.match(/getDownloadURL\(/g) ?? []).length, 1);
  assert.equal((privateMedia.match(/downloadPrivateStorageBlob\(/g) ?? []).length, 1, 'un seul appelant : l’original explicite');
  const originalSection = privateMedia.slice(privateMedia.indexOf('export const acquirePrivateMediaObjectUrl'), privateMedia.indexOf('export interface PrivatePresentationRequest'));
  assert.match(originalSection, /downloadPrivateStorageBlob\(record\.cloudStoragePath\)/);
  assert.deepEqual(usersOf(/getDownloadURL/), ['src/persistence/cloudDraft.ts', 'src/services/privateMedia.ts']);
  assert.deepEqual(usersOf(/loadPrivateStorageObjectUrl/), [], 'aucun appelant ne subsiste');
  // Point 5 : aucun rôle implicite — chaque PrivateMediaImage d'App.tsx, de ProjectedPublicBlock.tsx et du lecteur
  // générique nomme son rôle (la grille « Médias de l’objet » est une grille de vignettes : 240 px, jamais l'original).
  const generic = readSource('../src/components/GenericCartularyView.tsx');
  assert.match(generic, /<PrivateMediaImage asset=\{asset\} alt=\{asset\.name\} role="thumbnail" sizes="240px" \/>/);
  for (const [name, source] of [['App.tsx', app], ['ProjectedPublicBlock.tsx', projectedBlock], ['GenericCartularyView.tsx', generic]]) {
    const tags = source.match(/<PrivateMediaImage\b[^]*?\/>/g) ?? [];
    assert.ok(tags.length > 0, `${name} : aucune balise trouvée`);
    for (const tag of tags) assert.match(tag, /\srole=(?:"thumbnail"|"stage")/, `${name} : rôle implicite dans ${tag.slice(0, 80)}`);
  }
  assert.match(projectedBlock, /className="media-library public-media-library">[^]*?<PrivateMediaImage[^>]*sizes="240px" role="thumbnail"/);
  // Point 2 : thumbnailStatus du serveur (K3 étendu) lu par le Registre, trois libellés honnêtes.
  const thumbnail = readSource('../src/domain/registryThumbnail.ts');
  assert.match(thumbnail, /export type RegistryItemThumbnailStatus = 'ready' \| 'pending' \| 'failed' \| 'none';/);
  assert.match(thumbnail, /failed: 'Copie de présentation non produite'/);
  assert.match(readSource('../src/domain/projections.ts'), /thumbnailStatus\?: RegistryItemThumbnailStatus \| null;/);
  const registryThumbnailServer = readSource('../scripts/lib/registry-thumbnail.mjs');
  assert.match(registryThumbnailServer, /export const registryThumbnailStatusFor/);
  for (const file of ['../scripts/lib/live-sync-command.mjs', '../scripts/lib/projection-command.mjs']) assert.match(readSource(file), /primaryBinary/);
  // Point 1 : un seul prédicat « binaire vérifié », défini une fois et réutilisé par les miroirs.
  const variants = readSource('../scripts/lib/presentation-variants.mjs');
  assert.equal((variants.match(/export const privateBinaryIsVerified/g) ?? []).length, 1);
  assert.doesNotMatch(variants, /verificationStatus !== 'accepted'/);
  assert.match(readSource('../scripts/lib/private-upload-command.mjs'), /export \{ PRIVATE_UPLOAD_VERIFICATION_CUTOFF_MS, privateBinaryIsVerified \};/);
});

test('V3 tour 5 : dans renderWatchWebsiteBlock, toute image imprimée passe par ReportPrintImage — jamais une PrivateMediaImage nue sous forPrint', () => {
  const app = readSource('../src/App.tsx');
  const start = app.indexOf('const renderWatchWebsiteBlock = (blockId: PublishedBlockId, forPrint = false) => {');
  assert.ok(start > 0, 'renderWatchWebsiteBlock introuvable');
  const end = app.indexOf('\n  };\n', start);
  assert.ok(end > start);
  const renderer = app.slice(start, end);
  // Chaque <PrivateMediaImage …/> du rendu des blocs publiés est la branche NON imprimée d'un ternaire
  // `forPrint ? <ReportPrintImage …/> : <PrivateMediaImage …/>` : sous reportPreparation.active, une image sans variante
  // (pending/failed) charge son original par ReportPrintImage au lieu de rendre .media-load-error (rapport non imprimable).
  const tags = [...renderer.matchAll(/<PrivateMediaImage\b[^]*?\/>/g)];
  assert.ok(tags.length >= 4, `balises attendues sur couverture, hero, bibliothèque et documentation : ${tags.length}`);
  for (const match of tags) {
    const before = renderer.slice(Math.max(0, match.index - 800), match.index);
    assert.match(before, /(?<![!\w])forPrint\s*\?\s*<ReportPrintImage\b[^]*?\/>\s*:\s*$/, `PrivateMediaImage nue dans une branche imprimable : ${match[0].slice(0, 90)}`);
  }
  assert.doesNotMatch(renderer, /eager=\{forPrint\}/, 'une image imprimée ne se contente jamais de eager={forPrint}');
  // Les trois blocs relevés au tour 5 (PUBLISHED_BLOCK_IDS, donc imprimés) : couverture, hero Médias, documentation.
  const blockOf = (id) => {
    const from = renderer.indexOf(`case '${id}':`);
    assert.ok(from >= 0, `${id} introuvable`);
    const to = renderer.indexOf("\n      case '", from + 1);
    return renderer.slice(from, to === -1 ? undefined : to);
  };
  for (const id of ['cover-watch', 'media-hero', 'condition-documentation', 'media-library']) {
    const block = blockOf(id);
    assert.match(block, /(?<![!\w])forPrint\s*\?\s*<ReportPrintImage\b[^]*?language=\{language\}/, `${id} : ReportPrintImage absent de la branche imprimée`);
    assert.equal((block.match(/<ReportPrintImage\b/g) ?? []).length, 1, `${id} : une seule image imprimée`);
    assert.equal((block.match(/<PrivateMediaImage\b/g) ?? []).length, 1, `${id} : une seule image de lecture`);
  }
  assert.equal((renderer.match(/<ReportPrintImage\b/g) ?? []).length, 5, 'couverture, hero, séquence 360°, bibliothèque, documentation');
  // Le rapport reste le seul lieu de ReportPrintImage dans App.tsx : le module de lecture (pages) ne l’emploie pas.
  assert.equal((app.match(/<ReportPrintImage\b/g) ?? []).length, 5);
});

test('V3.4 : original à la demande dans la visionneuse, variantes seules dans Spin360', () => {
  const modals = readSource('../src/features/cartulary/modals/CartularyModals.tsx');
  const spin = readSource('../src/components/Spin360.tsx');
  assert.match(modals, /role=\{showOriginal \? 'original' : 'stage'\}/);
  assert.match(modals, /originalOnDemand = true,/);
  assert.match(modals, /Afficher l’original/);
  assert.doesNotMatch(spin, /acquirePrivateMediaObjectUrl/);
  assert.match(spin, /acquirePrivatePresentationObjectUrl\(\{[^}]*role: 'stage'/);
  assert.match(spin, /useMediaSource\(currentImage \|\| \{ url: posterImageUrl \}, true, \{ role: 'stage' \}\)/);
});

test('V3 K5 : Galerie et Catalogue lisent la vignette de l’item, sans lecture d’assets ni Storage au chargement', () => {
  const galleryService = readSource('../src/services/registryGallery.ts');
  const gallery = readSource('../src/features/registry/RegistryGallery.tsx');
  const items = readSource('../src/features/registry/RegistryItems.tsx');
  assert.doesNotMatch(galleryService, /\/assets\/IWC\/|loadPrivateStorageObjectUrl|isIwcCartulary/);
  assert.doesNotMatch(galleryService, /\b(?:setDoc|updateDoc|runTransaction|addDoc|writeBatch)\(/);
  assert.match(gallery, /Photos privées non accessibles avec ce compte/);
  assert.doesNotMatch(gallery, /role="original"/);
  assert.match(items, /data-thumbnail-state/);
  const thumbnail = readSource('../src/domain/registryThumbnail.ts');
  assert.match(thumbnail, /Vignette en préparation/);
  assert.match(thumbnail, /Aucune vignette disponible/);
  assert.doesNotMatch(thumbnail, /Accès restreint/);
});

test('V4 point 1 : l’aperçu local rend la projection publique, sans bloc personnel ni original', () => {
  const app = readSource('../src/App.tsx');
  const start = app.indexOf('const renderWatchWebsiteBlock = (blockId: PublishedBlockId, forPrint = false) => {');
  assert.ok(start > 0, 'renderWatchWebsiteBlock introuvable');
  const end = app.indexOf('\n  };\n', start);
  assert.ok(end > start, 'fin du renderer introuvable');
  const renderer = app.slice(start, end);
  assert.doesNotMatch(renderer, /case '(?:cover-owner|cover-transmission|cover-storage)':/, 'aucun rendu des blocs personnels');
  assert.doesNotMatch(renderer, /userAlias|transmissionCodes|storageCodes/, 'aucune donnée personnelle dans le rendu des blocs');
  assert.match(renderer, /if \(isWatchWebsite && localPublicationPreviewAllowed\) \{\s*const preview = localPreviewBlocks\.find\(/, 'l’aperçu passe toujours par ProjectedPublicBlock');
  const draft = readSource('../src/domain/websiteDraft.ts');
  assert.match(draft, /localPreview: \{ binaryId: asset\.binaryId, cartularyId: asset\.cartularyId, privatePresentation: asset\.privatePresentation \}/);
  assert.doesNotMatch(draft, /localPreview:[^}]*\b(?:url|downloadUrl|storagePath)\b/, 'la source privée d’aperçu ne porte jamais d’adresse');
  const projected = readSource('../src/components/ProjectedPublicBlock.tsx');
  assert.match(projected, /preview \? asset\.localPreview : undefined/, 'la source privée n’est lue qu’en aperçu');
  assert.doesNotMatch(projected, /acquirePrivateMediaObjectUrl|role="original"/);
  assert.match(projected, /const privateInPreview = \(asset: Asset\) => preview && Boolean\(asset\.binaryId\);/, 'un binaire privé en aperçu n’offre jamais l’original');
  assert.match(projected, /downloads=\{!preview\}/, 'le carrousel n’offre pas l’original en aperçu');
  assert.match(projected, /originalOnDemand=\{!preview\}/);
  assert.match(readSource('../src/components/MediaCarousel.tsx'), /\{downloads && <MediaDownloadLink media=\{current\}/);
  // Décision 2 : un paramètre blocks= ne dépasse jamais la sélection locale.
  assert.match(app, /filterRequestedWebsiteBlocks\(requestedUrlBlocks, approvedWebsiteBlocks\)/);
  // D3 (a) : sélection démo du mini-site = les 8 blocs réellement publiés (constante partagée client / script Admin).
  assert.match(app, /if \(isDemoCartulary\) return \[\.\.\.DEMO_WEBSITE_BLOCK_IDS\];/);
  assert.match(readSource('../scripts/lib/demo-publication-command.mjs'), /export const DEFAULT_DEMO_WEBSITE_BLOCKS = DEMO_WEBSITE_BLOCK_IDS;/);
});

test('V4 relecture : correctifs d’honnêteté, de régression et d’accessibilité verrouillés à la source', () => {
  const app = readSource('../src/App.tsx');
  const css = readSource('../src/index.css');
  const panel = readSource('../src/components/PublicWebsitePublicationPanel.tsx');
  const projected = readSource('../src/components/ProjectedPublicBlock.tsx');
  const summary = readSource('../src/features/cartulary/components/PublicationReadOnlySummary.tsx');
  const table = readSource('../src/features/cartulary/components/PublicationSelectionTable.tsx');
  const collectionSite = readSource('../src/components/CollectionWebsitePage.tsx');
  // F3 (M43) : les quatre tranches sont passées à la table dans l'ordre des destinations, jamais croisées.
  assert.match(app, /<PublicationSelectionTable language=\{language\} selections=\{\{ website: publishedBlocks, collection: collectionBlocks, community: communityBlocks, report: reportBlocks \}\} canEdit=\{canEdit\} onToggle=\{togglePublicationBlock\} onReplace=\{replacePublicationBlocks\} \/>/);
  // F4 : « Supprimer toutes les données » oublie aussi la demande de mini-site conservée dans l'onglet, avant la redirection.
  const deleteAll = app.slice(app.indexOf('const handleDeleteAllData'), app.indexOf('const toggleMediaTag'));
  assert.ok(deleteAll.indexOf('await persistence.deleteAllData();') < deleteAll.indexOf('clearWebsiteRequestSession(mockCartulary.id);'), 'la demande est oubliée après la suppression du coffre');
  assert.ok(deleteAll.indexOf('clearWebsiteRequestSession(mockCartulary.id);') < deleteAll.indexOf("window.location.replace('/?data-deleted=1');"), 'et avant la redirection');
  // H10 : l'article 03 de l'éditeur porte la note D6 (a) à l'endroit où l'on bascule et copie l'adresse, nommée aperçu local.
  const community = app.slice(app.indexOf('publication-scope--community">'), app.indexOf('publication-scope--report">'));
  assert.match(community, /communityPublicationNote\(language\)/);
  assert.match(community, /Adresse du Cercle \(aperçu local\)/);
  assert.doesNotMatch(community, /Adresse du site Le Cercle/);
  // H3 : l'aperçu propriétaire d'une Collection se nomme « Aperçu local » et lit l'état réel des Collections.
  assert.match(collectionSite, /collectionWebsiteIsPublished\(entry\)/);
  assert.match(collectionSite, /`Aperçu local · \$\{previewStatus\}` : 'Mini-site de Collection'/);
  // H1 : une vidéo téléversée en aperçu ne reçoit jamais la promesse de lecture ; l'aperçu annonce le refus serveur.
  assert.match(projected, /const privateVideoInPreview = \(asset: Asset\) => privateInPreview\(asset\) && asset\.type === 'video';/);
  assert.match(projected, /le serveur refusera la publication s’il n’en a pas produit/);
  // F2 (sécurité) : la visionneuse ne parcourt que les médias ouvrables ; un binaire privé en aperçu reste hors de sa navigation.
  assert.match(projected, /<MediaViewerModal asset=\{selected\} assetCount=\{downloadableAssets\.length\}/);
  assert.match(projected, /onMove=\{\(direction\) => setSelectedId\(downloadableAssets\[/);
  assert.doesNotMatch(projected, /assetCount=\{assets\.length\}|setSelectedId\(assets\[/);
  // H6/H7/F2 (régression) : demande conservée seulement tant que le serveur n'a pas répondu (révision, ou fin du nettoyage), oubliée en mémoire aussi.
  assert.match(panel, /const requestSettled = \(entry: PendingRequest, latest: WebsitePublicationState\) => latest\.revision !== entry\.request\.expectedRevision\s*\|\| \(entry\.action === 'cleanup' && latest\.cleanupPending !== true\);/);
  assert.match(panel, /if \(entry && !requestSettled\(entry, value\)\) \{ pending\.current = entry; setRetained\(entry\); \} else \{ pending\.current = null; clearWebsiteRequestSession\(cartularyId\); setRetained\(null\); \}/);
  assert.match(panel, /if \(overtaken\) \{ forgetRequest\(\); onStateChanged\?\.\(latest\); \}/);
  // A2/A3/F1 : aucun jeton nu du SDK ni de chaîne française hors tx dans le panneau bilingue.
  assert.match(panel, /tx\('État de publication indisponible\. Connectez-vous avec le compte propriétaire puis réessayez\.'/);
  assert.match(panel, /Le serveur n’a pas répondu dans le délai\./);
  assert.match(panel, /réponse serveur non concluante \(erreur ou refus non détaillé\)/);
  // A4/A6/A8 : régions nommées, cellule interdite distinguée en lecture, label de cellule comme cible tactile.
  for (const source of [table, summary]) assert.match(source, /className="publication-summary__scroll" role="region"/);
  assert.match(summary, /state === 'unavailable' \? 'is-unavailable' : 'is-excluded'/);
  assert.match(table, /<label className="publication-summary__cell">\s*<input/);
  // A1/A8/A9 (mise en page mobile) : piste bornée, libellés sr-only confinés au cadre défilant, cible 44 px, titre lié qui se replie.
  assert.match(css, /\.publication-center \{ display: grid; grid-template-columns: minmax\(0, 1fr\); gap: var\(--s5\); \}/);
  assert.match(css, /\.publication-summary__scroll \{ position: relative; overflow-x: auto;/);
  assert.match(css, /\.publication-summary td\.is-unavailable \{ color: var\(--muted\); \}/);
  assert.match(css, /\.publication-summary__cell \{ display: grid; place-items: center; min-height: 44px; cursor: pointer; \}/);
  assert.match(css, /\.catalog-site__grid h3 a \{ display: inline; width: auto;/);
  assert.match(css, /\.publication-summary thead th \{ position: sticky;/, 'l’en-tête collant est conservé');
});

// V5 — points 5 et 6 (P-D1 Preuves, P-D2 À faire, P-D3 Médias) : blocs fournis par les lots socle S6, S5, S4, posés au commit I1.
test('V5 P-D1 : les outils d’essai du carnet n’ont aucun appelant hors integrityJournal.ts ; export avec le carnet, migration sous rupture seule, suppression en dernière section', () => {
  const offenders = walkSources(sourceRoot)
    .filter((path) => relativeSource(path) !== 'src/utils/integrityJournal.ts' && /simulateTampering|createLocalTestTimestamp/.test(readFileSync(path, 'utf8')))
    .map(relativeSource);
  assert.deepEqual(offenders, []);
  const panel = readSource('../src/components/AuditPanel.tsx');
  assert.doesNotMatch(panel, /Simulation technique|Technical Simulation|Falsifier|fixture locale|showTechnicalSim|sensitiveActionError/);
  // Ordre des sections propriétaires : Conservation → Cession → Preuve serveur → Carnet local (Horodater puis Exporter) → Historique (Migrer) → Suppression.
  const order = ['Conservation des données', '<CartularyTransferPanel', 'aria-labelledby="server-proof-title"', 'Carnet local de travail', 'Horodater le carnet local', 'Exporter le carnet local', 'Historique local conservé', 'Migrer la chaîne rompue', 'Suppression des données', 'Supprimer mes données'];
  const owner = panel.slice(panel.indexOf('if (readOnly) {'));
  const positions = order.map((needle) => owner.indexOf(needle));
  assert.ok(positions.every((position) => position >= 0), `repères manquants : ${order.filter((_, index) => positions[index] < 0).join(', ')}`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'ordre des sections du panneau propriétaire');
  // Section dédiée nommée (rôle region), erreurs distinctes, migration rendue seulement sous rupture.
  assert.match(panel, /<section aria-labelledby="deletion-title"/);
  assert.match(panel, /\{!integrityStatus\.isValid && \([\s\S]{0,2000}Migrer la chaîne rompue/);
  assert.match(panel, /setExportError\(/);
  assert.match(panel, /setDeleteError\(/);
  assert.equal((panel.match(/role="alertdialog"/g) ?? []).length, 1);
  assert.ok(panel.indexOf('role="alertdialog"') > panel.indexOf('aria-labelledby="deletion-title"'));
});

test('V5 P-D2 : le popover À faire laisse le titre sur sa propre rangée', () => {
  const css = readSource('../src/index.css');
  // Largeur : 480 px sur ordinateur, 100vw − 32px en mobile (règle unique, la règle mobile ne fixe pas de largeur).
  assert.match(css, /\.todo-popover \{[^}]*width: min\(480px, calc\(100vw - 32px\)\);/s, 'popover 480 px, 100vw − 32px en mobile');
  assert.doesNotMatch(css, /min\(360px, calc\(100vw - 32px\)\)/, 'l’ancienne largeur a disparu');
  // Ligne de tâche : statut (col. 1) puis titre pleine largeur (col. 2) ; les actions passent en rangée 2, colonne 2.
  assert.match(css, /\.todo-list > li \{[^}]*grid-template-columns: auto minmax\(0, 1fr\);/s, 'deux colonnes : statut, puis titre pleine largeur');
  assert.match(css, /\.todo-list > li \{[^}]*gap: var\(--s1\) var\(--s3\);/s, 'interligne serré entre titre et actions, colonnes espacées');
  assert.match(css, /\.todo-list__actions \{[^}]*grid-column: 2;/s, 'les actions passent sous le titre, alignées sur lui');
  assert.match(css, /\.todo-edit-form \{[^}]*grid-column: 1 \/ -1;/s, 'le formulaire d’édition reste pleine largeur');
  assert.match(css, /\.todo-popover \{ position: fixed; top: 69px; right: var\(--s3\); \}/, 'la règle mobile ne fixe pas de largeur : min(480px, 100vw − 32px) s’applique');
});

test('V5 P-D3 : la page Médias ne présente jamais l’absence de vidéo ou de séquence comme un accès restreint', () => {
  const app = readSource('../src/App.tsx');
  const media = app.slice(app.indexOf('<MediaPage'), app.indexOf('</MediaPage>'));
  assert.doesNotMatch(media, /<AccessRestricted/);
  assert.equal((media.match(/<EmptyMediaSlot slot="main-video"/g) ?? []).length, 1);
  assert.equal((media.match(/<EmptyMediaSlot slot="spin-3d"/g) ?? []).length, 1);
  assert.doesNotMatch(media, /isDemoCartulary\s*(?:&&|\?)\s*\(?\s*<EmptyMediaSlot/);
  for (const tag of media.match(/<EmptyMediaSlot\b[^]*?\/>/g) ?? []) {
    assert.match(tag, /canEdit=\{canEdit\}/, 'le bouton d’ajout dépend du droit d’édition, jamais de la démo');
    assert.match(tag, /busy=\{mediaImportBusy\}/);
    assert.match(tag, /onAddFiles=\{\(files\) => void importMediaFiles\(files, (?:\['(?:main-video|spin-3d)'\]|\[MEDIA_SLOT_TAGS\['(?:main-video|spin-3d)'\]\])\)\}/, 'tag imposé par l’emplacement');
  }
  assert.doesNotMatch(app, /const digestFile = async|const newId = \(prefix/);
  assert.match(app, /import \{ newId \} from '\.\/utils\/identifiers';/);
  assert.match(app, /import \{ digestFile \} from '\.\/utils\/fileDigest';/);
  assert.equal((app.match(/buildImportedAssets\(/g) ?? []).length, 1, 'un seul pipeline d’import dans App.tsx');
  // Le corps d'import des médias (mimeType déclaré par le navigateur) ne vit plus dans App.tsx ; le dépôt des rapports
  // (mimeType canonique de l'inspection) reste, d'où la clause `mimeType: file\.type` qui distingue les deux corps.
  assert.doesNotMatch(app, /putValidatedBinary\(\{\s*binaryId,\s*kind: 'media',\s*fileName: file\.name,\s*mimeType: file\.type,/, 'l’import média ne passe plus par un corps local dans App.tsx');
  const slot = readSource('../src/features/cartulary/components/EmptyMediaSlot.tsx');
  assert.doesNotMatch(slot, /Lock|Accès restreint|Restricted access|isDemoCartulary|firebase/i);
  assert.match(slot, /Aucune vidéo ajoutée/); assert.match(slot, /Aucune séquence 3D ajoutée/);
  assert.match(slot, /No video added/); assert.match(slot, /No 3D sequence added/);
  assert.match(slot, /type="file"/); assert.match(slot, /className="sr-only"/);
  const pipeline = readSource('../src/features/cartulary/media/importMediaFiles.ts');
  assert.doesNotMatch(pipeline, /firebase|firestore|isDemoCartulary|from 'react'/i);
  assert.match(pipeline, /export const buildImportedAssets/);
  assert.match(pipeline, /export const MEDIA_SLOT_TAGS: Record<MediaSlotKind, MediaTag> = \{ 'main-video': 'main-video', 'spin-3d': 'spin-3d' \};/);
  assert.match(readSource('../src/utils/fileDigest.ts'), /globalThis\.crypto\.subtle\.digest\('SHA-256'/);
  assert.match(readSource('../src/index.css'), /\.empty-media-slot \{[^}]*border: 1px dashed var\(--rule\)/s);
});

// V5 — point 1 (V-D1, P-D6), commit 1/2 (I3) : lecture en texte pur, édition à la demande par crayon sur les pages 00-04.
test('V5 point 1 : le mode lecture suit le droit de gérer, sans contrôle désactivé sur les pages 00-04', () => {
  const app = readSource('../src/App.tsx');
  const presentation = readSource('../src/features/cartulary/components/CartularyPresentation.tsx');
  const css = readSource('../src/index.css');
  // Une seule source de vérité, la même que la page Publication (décision V2 (b) généralisée, D5 (a)).
  assert.match(app, /const canEdit = authoritative\.canManage;/);
  assert.doesNotMatch(app, /const canEdit = !isDemoCartulary;/);
  assert.doesNotMatch(app, /showCompleteContent/);
  assert.doesNotMatch(app, /isEditingChecks/);
  // Pages 00-04 : plus aucun fieldset désactivé, aucun contrôle grisé, aucune option démo.
  const pages = app.slice(app.indexOf('<CoverPage'), app.indexOf('<PublicationPage'));
  assert.doesNotMatch(pages, /<fieldset className="cartulary-readonly-scope"/);
  assert.doesNotMatch(pages, /cartulary-readonly-scope/);
  assert.doesNotMatch(pages, /disabled=\{!canEdit\}/);
  assert.doesNotMatch(pages, /`demo:\$\{/);
  assert.doesNotMatch(pages, /disabled=\{isDemoCartulary\}/);
  // Le crayon n'est posé que si l'édition est possible ; jamais rendu grisé.
  assert.match(app, /\.\.\.\(editable && canEdit \? \{/);
  assert.doesNotMatch(app, /disabled: !canEdit/);
  assert.doesNotMatch(presentation, /disabled=\{selection\.edit\.disabled\}|disabled\?: boolean/);
  // Les treize blocs restés en champs permanents (fiche de spécifications comprise — P-D6) plus les points à contrôler portent un crayon.
  for (const id of ['reference-specs', 'reference-checks', 'reference-popularity', 'cover-ownership-history', 'cover-storage', 'cover-transmission', 'condition-documentation', 'value-market', 'value-comparables-listings', 'value-comparables-transactions', 'value-comparables-analysis', 'value-cost-basis', 'value-performance', 'value-sensitivity']) {
    assert.match(app, new RegExp(`publishProps\\('${id}', true\\)`), `crayon absent sur ${id}`);
  }
  // Fiche de spécifications : champs et « Ajouter une donnée » sous l'édition du bloc, ancres IA sur dt/dd en lecture (C5).
  assert.match(app, /editingBlock === 'reference-specs' \? \(/);
  assert.match(app, /\{editingBlock === 'reference-specs' && \(pendingSpecificationGroupId === group\.id/);
  assert.match(app, /<dt \{\.\.\.aiFieldProps\('reference\.specifications\[\]\.label', item\.id\)\}>\{item\.label\}<\/dt><dd \{\.\.\.aiFieldProps\('reference\.specifications\[\]\.value', item\.id\)\}>\{item\.value\}<\/dd>/);
  // Aucune affordance inerte : ni onActivate ni onClick conditionnés par « canEdit && ».
  assert.doesNotMatch(app, /onActivate=\{\(\) => canEdit &&/);
  assert.doesNotMatch(app, /onClick=\{\(\) => canEdit && setEditingBlock/);
  assert.doesNotMatch(pages, /<h1[^\n]*<button[^\n]*editable-click-target[^\n]*canEdit &&/);
  // Perte du droit pendant une édition : retour au texte.
  assert.match(app, /useEffect\(\(\) => \{ if \(!canEdit\) \{ setEditingBlock\(null\); setPendingSpecificationGroupId\(null\); \} \}, \[canEdit\]\);/);
  // Les trois faits d'état passent par EditableFact (ancres collectées par validate:ai dans App.tsx).
  for (const field of ['condition.summary.lastCondition', 'condition.summary.conclusion', 'condition.summary.openPoint']) {
    assert.match(app, new RegExp(`<EditableFact aiField="${field.replace(/\./g, '\\.')}"`), `${field} sans EditableFact`);
  }
  assert.match(presentation, /export function EditableFact\(/);
  // « Valeur retenue » de la page 01 toujours affichée (décision 1-D4).
  assert.doesNotMatch(app, /ACCÈS RESTREINT|RESTRICTED ACCESS/);
  // Visionneuse : lecture sur le droit de gérer, original à la demande inchangé.
  assert.match(app, /<MediaViewerModal[\s\S]{0,1200}readOnly=\{!canEdit\}/);
  assert.match(app, /readOnly=\{!canEdit\}\s*originalOnDemand=\{authoritative\.canManage\}/);
  // Composants de lecture purs : neuf exports, aucun contrôle, aucune branche démo, aucune donnée distante.
  const readOnlyBlocks = readSource('../src/features/cartulary/components/CartularyReadOnlyBlocks.tsx');
  assert.doesNotMatch(readOnlyBlocks, /firebase|firestore|isDemoCartulary|<input|<select|<textarea|<button|<fieldset|editable-click-target|role="button"/i);
  for (const name of ['CoverFactsReadOnly', 'OwnershipHistoryReadOnly', 'VaultCodeListReadOnly', 'DocumentationRegisterReadOnly', 'MarketDepthReadOnly', 'ValuationLevelsReadOnly', 'AnalysisRowsReadOnly', 'CostBasisReadOnly', 'ExitAssumptionsReadOnly']) {
    assert.match(readOnlyBlocks, new RegExp(`export function ${name}\\(`), `${name} absent`);
    assert.match(pages, new RegExp(`<${name}\\b`), `${name} non rendu par les pages`);
  }
  assert.equal((readOnlyBlocks.match(/^export /gm) ?? []).length, 9, 'exactement neuf exports');
  // C4 : AccessRestricted, Lock (présentation) et .restricted-card retirés ensemble ; règles CSS mortes retirées.
  assert.doesNotMatch(app, /AccessRestricted/);
  assert.doesNotMatch(presentation, /AccessRestricted|\bLock\b|Accès restreint/);
  assert.doesNotMatch(css, /\.restricted-card|\.cartulary-readonly-scope|\.content-marker:disabled|input:disabled \+ span|select:disabled/);
  // Inchangés (verrous existants) : page 05 sur canManagePublication, gardes canEdit des commandes, sélection de publication.
  assert.match(app, /const canManagePublication = authoritative\.canManage;/);
  assert.equal((app.match(/if \(!canEdit\) return;/g) ?? []).length, 3);
});

// V5 — point 1 (V-D1, D5 (a)), commit 2/2 (I4) : structures communes et bandeau d'accès sur le droit de gérer.
test('V5 point 1 (2/2) : barre À faire, tableau À faire, Preuves et visionneuse en lecture sur le droit de gérer ; bandeau d’accès pur', () => {
  const app = readSource('../src/App.tsx');
  // Les quatre structures communes basculent sur !canEdit ; la démo n'alimente que la prop texte `demonstration`.
  for (const component of ['BarreDossier', 'CartularyTodoBoard', 'AuditPanel', 'MediaViewerModal']) {
    const start = app.indexOf(`<${component}`);
    assert.ok(start >= 0, `${component} absent d’App.tsx`);
    const tag = app.slice(start, app.indexOf('/>', start));
    assert.match(tag, /readOnly=\{!canEdit\}/, `${component} n’est pas en lecture sur !canEdit`);
    assert.doesNotMatch(tag, /readOnly=\{isDemoCartulary\}/, `${component} encore en lecture sur la démo`);
    if (component !== 'MediaViewerModal') assert.match(tag, /demonstration=\{isDemoCartulary\}/, `${component} sans prop texte demonstration`);
  }
  // Le seul readOnly={isDemoCartulary} restant est celui du panneau de publication, dans la branche éditeur (canManagePublication).
  assert.equal((app.match(/readOnly=\{isDemoCartulary\}/g) ?? []).length, 1);
  assert.match(app, /<PublicWebsitePublicationPanel[^\n]*readOnly=\{isDemoCartulary\}/);
  // Bandeau d'accès : un composant pur remplace l'aside démo ; il lit le statut du hook autoritaire, jamais canManage.
  assert.match(app, /<CartularyAccessNotice demonstration=\{isDemoCartulary\} status=\{authoritative\.status\} language=\{language\} \/>/);
  assert.doesNotMatch(app, /isDemoCartulary && \(\s*<aside className="cartulary-(?:demo|access)-notice"/);
  assert.doesNotMatch(app, /cartulary-demo-notice|cartulary-access-notice/);
  const notice = readSource('../src/features/cartulary/components/CartularyAccessNotice.tsx');
  assert.doesNotMatch(notice, /firebase|firestore|isDemoCartulary|canManage|<button|<input|<a |Mode de consultation|setAudience|AUDIENCE_STORAGE_KEY/i);
  assert.match(notice, /export function CartularyAccessNotice\(/);
  assert.match(notice, /className="cartulary-access-notice no-print" role="note"/);
  for (const text of ['Démonstration en lecture seule', 'Read-only demonstration', 'Lecture seule', 'Connectez-vous avec le compte propriétaire pour modifier ce Cartulaire\\.', 'Sign in with the owner account to edit this Cartulary\\.', 'n’a pas pu être chargé depuis le serveur', 'could not be loaded from the server']) {
    assert.match(notice, new RegExp(text), `texte du bandeau manquant : ${text}`);
  }
  assert.match(notice, /status === 'signed-out'/);
  assert.match(notice, /status === 'denied' \|\| status === 'error' \|\| status === 'empty'/);
  assert.match(notice, /if \(!notice\) return null;/, 'idle, loading et ready ne rendent rien (aucun clignotement pour le propriétaire)');
  assert.match(readSource('../src/index.css'), /\.cartulary-access-notice \{/);
  // M1 : en lecture, la barre et le tableau ne montrent ni pastille-bouton ni état de synchronisation (un lecteur ne synchronise rien).
  const header = readSource('../src/components/BarreDossier.tsx');
  const board = readSource('../src/components/CartularyTodoBoard.tsx');
  for (const [name, source] of [['BarreDossier', header], ['CartularyTodoBoard', board]]) {
    assert.doesNotMatch(source, /disabled=\{readOnly\}/, `${name} : contrôle grisé en lecture`);
    assert.match(source, /\{!readOnly && (?:todoSyncError|syncError) && <p className="todo-sync-error" role="status">/, `${name} : syncError rendu en lecture`);
    assert.match(source, /demonstration = false/, `${name} : prop demonstration absente`);
    assert.match(source, /demonstration \? \(isFrench \? 'Démonstration en lecture seule' : 'Read-only demonstration'\) : \(isFrench \? 'Lecture seule' : 'Read-only'\)/, `${name} : mention de lecture sans parité`);
    assert.match(source, /<span className="sr-only">\{todo\.status === 'completed' \? \(isFrench \? 'Terminée' : 'Completed'\) : \(isFrench \? 'Planifiée' : 'Planned'\)\}<\/span>/, `${name} : pastille de lecture sans texte`);
  }
  assert.match(header, /\{readOnly \? \(\s*<span className="todo-list__status">/);
  assert.match(board, /todos\.map\(\(todo\) => readOnly \? \(/);
  assert.match(board, /<time dateTime=\{todo\.dueAt \|\| undefined\}>/);
  assert.match(board, /<span className="cover-todo-board__category">\{categoryLabel\(todo\.category\)\}<\/span>/);
  // Preuves en lecture pour tout non-éditeur : textes contextuels sans mot « démonstration » hors démo, aucun message technique.
  const panel = readSource('../src/components/AuditPanel.tsx');
  assert.match(panel, /demonstration \? tx\(\s*'Démonstration en lecture seule\. Rien n’est enregistré dans ce navigateur/);
  assert.match(panel, /Votre accès à ce Cartulaire est en lecture seule : aucune action propriétaire n’est disponible depuis cette vue\./);
  assert.match(panel, /Your access to this Cartulary is read-only: no owner action is available from this view\./);
  assert.match(panel, /La cession relève du compte propriétaire\./);
  assert.match(panel, /demonstration \? tx\('Chaîne fictive de démonstration', 'Fictional demonstration chain'\) : tx\('Chaîne serveur', 'Server chain'\)/);
  assert.match(panel, /<ReadOnlyProofs\s*language=\{language\}\s*demonstration=\{demonstration\}/);
  assert.doesNotMatch(panel, /readOnly=\{isDemoCartulary\}/);
  // M4 : la case des points à contrôler en lecture porte son état en texte pour le lecteur d'écran (aucun aria-label sur un span sans rôle).
  assert.match(app, /<span className="control-check control-check--static"[^\n]*<span aria-hidden="true"[^\n]*<span className="sr-only">\{item\.checked \? tx\('Contrôlé', 'Checked'\) : tx\('À contrôler', 'To check'\)\}<\/span><\/span>/);
  assert.doesNotMatch(app, /className="control-check[^\n]*aria-label=/);
  // M6 (ADR-026) : dans la coque du lecteur, isDemoCartulary n'alimente que des props texte `demonstration`, des textes
  // et des données de repli — jamais une structure ni un droit. Formes admises, comptées une à une.
  const shell = app.slice(app.indexOf('<div className="app-shell"'), app.indexOf('<AuditPanel'));
  const admitted = [
    /demonstration=\{isDemoCartulary\}/g,
    /<PublicWebsitePublicationPanel[^\n]*readOnly=\{isDemoCartulary\}/g,
    /collectionName=\{isDemoCartulary \? DEMO_ACCOUNT\.collectionName : authoritative\.collectionName\}/g,
    /\{isDemoCartulary \? tx\(/g,
    // Hérité : aperçu local de l'adresse dédiée, dans la branche éditeur (canManagePublication, inaccessible en démo).
    /\(externalPublicationEnabled \|\| isDemoCartulary\) && \(/g,
  ];
  const explained = admitted.reduce((sum, pattern) => sum + (shell.match(pattern) ?? []).length, 0);
  assert.equal((shell.match(/isDemoCartulary/g) ?? []).length, explained, 'isDemoCartulary conditionne une structure ou un droit dans la coque du lecteur');
  assert.equal((shell.match(/demonstration=\{isDemoCartulary\}/g) ?? []).length, 4, 'BarreDossier, CartularyAccessNotice, CartularyTodoBoard, PublicationReadOnlySummary');
});
