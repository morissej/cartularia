import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readProjectFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('la synchronisation descendante notifie React sans rechargement de page', async () => {
  const source = await readProjectFile('src/persistence/useHybridPersistence.ts');
  assert.doesNotMatch(source, /window\.location\.reload/);
  assert.match(source, /CLOUD_PULL_APPLIED_EVENT/);
  assert.match(source, /pulledStateKeys/);
});

test('les nouveaux profils de montre disposent d’un repli neutre distinct des deux démonstrateurs', async () => {
  const source = await readProjectFile('src/App.tsx');
  assert.match(source, /isRolexCartulary \? \[/);
  assert.match(source, /Calibre à documenter/);
  assert.match(source, /Histoire de la référence/);
  assert.match(source, /Configuration et accessoires à inventorier/);
});

test('l’export diffère la révocation Blob et le suivi utilise le fuseau du navigateur', async () => {
  const [auditPanel, followUp] = await Promise.all([
    readProjectFile('src/components/AuditPanel.tsx'),
    readProjectFile('src/features/registry/RegistryFollowUp.tsx'),
  ]);
  assert.match(auditPanel, /setTimeout\(\(\) => URL\.revokeObjectURL\(url\), 1_000\)/);
  assert.doesNotMatch(followUp, /timeZone:\s*['"]UTC['"]/);
});
