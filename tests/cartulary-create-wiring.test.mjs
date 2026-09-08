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
