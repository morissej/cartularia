import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readProjectFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('le worker local de création écoute les demandes pending et câble les deux commandes', async () => {
  const [worker, packageJson, readme] = await Promise.all([
    readProjectFile('scripts/run-cartulary-create-worker.mjs'),
    readProjectFile('package.json'),
    readProjectFile('README.md'),
  ]);
  assert.match(worker, /collection\('cartularyCreateRequests'\)/);
  assert.match(worker, /where\('status', '==', 'pending'\)/);
  assert.match(worker, /processCartularyCreateRequest/);
  assert.match(worker, /markCartularyCreateRequestFailed/);
  assert.equal(JSON.parse(packageJson).scripts['create:worker'], 'node scripts/run-cartulary-create-worker.mjs');
  assert.match(readme, /npm run create:worker/);
});

test('le service de création écrit les spécifications et le slug par les constructeurs purs du domaine', async () => {
  const service = await readProjectFile('src/services/cartularyCreation.ts');
  assert.match(service, /buildCreationSpecificationGroups\(definition, profile\)/);
  assert.match(service, /slugifyCartularyLabel\(/);
  assert.doesNotMatch(service, /label: 'Identification'/, 'le groupe de spécifications ne doit plus être écrit en ligne avec « label »');
  assert.doesNotMatch(service, /\.slice\(0, 44\)/);
});

test('V3 : la création référence les variantes de présentation dès la vérification et n’expose jamais l’original par défaut', async () => {
  const [verification, service, domain, modals, spin, page] = await Promise.all([
    readProjectFile('src/services/privateUploadVerification.ts'),
    readProjectFile('src/services/cartularyCreation.ts'),
    readProjectFile('src/domain/cartularyCreation.ts'),
    readProjectFile('src/features/cartulary/modals/CartularyModals.tsx'),
    readProjectFile('src/components/Spin360.tsx'),
    readProjectFile('src/features/registry/NewCartularyPage.tsx'),
  ]);
  // Référence figée : lue par le module pur du contrat unique, restreinte à l'identité, sans vignette inline.
  assert.match(verification, /presentationFromBinaryRecord\(data, binaryId\)/);
  assert.match(verification, /restrictPresentationToIdentity\(/);
  assert.match(verification, /thumbnail: null/);
  assert.doesNotMatch(verification, /presentation-v2|getDownloadURL|\/original/);
  assert.match(service, /privatePresentation: verification\.privatePresentation/);
  assert.match(service, /media: summarizeCreationMedia\(mediaAssets\)/);
  assert.match(domain, /privatePresentation\?: PrivatePresentation;/);
  assert.doesNotMatch(domain, /presentationDerivative/, 'aucun second contrat de dérivé sur l’asset de création (C2)');
  // Visionneuse : variante de scène par défaut, original seulement après le bouton.
  assert.match(modals, /role=\{showOriginal \? 'original' : 'stage'\}/);
  assert.match(modals, /Afficher l’original/);
  assert.match(modals, /originalOnDemand = true/);
  // Séquence 360° : variantes 768/1200, jamais l'original (G1).
  assert.match(spin, /acquirePrivatePresentationObjectUrl\(\{ binaryId: asset\.binaryId, cartularyId: asset\.cartularyId, asset, role: 'stage' \}\)/);
  assert.match(spin, /\{ role: 'stage' \}\)/);
  assert.doesNotMatch(spin, /acquirePrivateMediaObjectUrl/);
  // Écran de succès : bilan honnête des médias.
  assert.match(page, /describeCreationMediaSummary\(pendingCreation\?\.media\)/);
});

test('V5 : le pipeline de création est borné par le serveur et la demande est écoutée', async () => {
  const [service, functions, page] = await Promise.all([
    readProjectFile('src/services/cartularyCreation.ts'),
    readProjectFile('scripts/firebase-functions.mjs'),
    readProjectFile('src/features/registry/NewCartularyPage.tsx'),
  ]);
  // Borne client ≤ maxInstances de verifyPrivateDraftUpload (concurrency 1 par instance) : aucune vérification retenue en file.
  const clientBound = /export const MAXIMUM_CONCURRENT_CREATION_UPLOADS = (\d+);/.exec(service);
  assert.ok(clientBound, 'borne client exportée');
  const verifySlice = /export const verifyPrivateDraftUpload = onObjectFinalized\(\{([\s\S]*?)\}, async/.exec(functions);
  assert.ok(verifySlice, 'tranche de configuration de verifyPrivateDraftUpload');
  const maxInstances = /maxInstances: (\d+),/.exec(verifySlice[1]);
  assert.ok(maxInstances, 'maxInstances lu dans le source serveur');
  assert.match(verifySlice[1], /concurrency: 1,/);
  assert.ok(Number(clientBound[1]) >= 1 && Number(clientBound[1]) <= Number(maxInstances[1]), `borne client ${clientBound[1]} ≤ maxInstances ${maxInstances[1]}`);
  // Service : file bornée existante, écoute de la demande, plus aucun sondage.
  assert.match(service, /runBoundedPreloadQueue\(\{/);
  assert.match(service, /concurrency: MAXIMUM_CONCURRENT_CREATION_UPLOADS,/);
  assert.match(service, /onSnapshot\(requestRef/);
  assert.doesNotMatch(service, /getDoc\(/);
  assert.match(service, /sha256Serialized\(file\)/, 'hachage sérialisé : un seul arrayBuffer() à la fois');
  // Page : étapes du domaine, liste nommée, plus de pourcentage global ni de promesse de raccordement.
  assert.match(page, /describeCreationProgress\(/);
  assert.match(page, /aria-label="Étapes de la création"/);
  assert.match(page, /CARTULARY_CREATION_DURATION_NOTE/);
  assert.doesNotMatch(page, /Création autoritaire et raccordement/);
  assert.doesNotMatch(page, /progressPercent/);
  assert.match(page, /waitForCartularyCreation\(result\.cartularyId, \{ onStatus: setServerStatus \}\)/);
  // Le mock à trois exports de tests/ui/registry-correction-loop.test.tsx reste suffisant.
  const serviceImport = /import \{([^}]*)\} from '\.\.\/\.\.\/services\/cartularyCreation\.ts';/.exec(page);
  assert.ok(serviceImport, 'import du service');
  const valueImports = serviceImport[1].split(',').map((entry) => entry.trim()).filter((entry) => entry && !entry.startsWith('type '));
  assert.deepEqual(valueImports.sort(), ['CartularyCreationFailedError', 'createCartulary', 'waitForCartularyCreation']);
});
