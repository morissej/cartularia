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
