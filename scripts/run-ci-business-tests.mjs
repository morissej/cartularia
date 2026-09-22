import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const roots = [
  'test:v7',
  'test:account-suspension:unit',
  'test:private-binary-trust:unit',
  'test:sync-recovery:unit',
  'test:imports:unit',
  'test:follow-up-reliability',
  'test:p7-integrity-cost',
  'test:p8-dependency-security',
];
const visitedScripts = new Set();
const testFiles = new Set();

const collect = (scriptName) => {
  if (visitedScripts.has(scriptName)) return;
  visitedScripts.add(scriptName);
  const command = packageJson.scripts[scriptName];
  if (!command) throw new Error(`Script npm absent : ${scriptName}`);
  for (const match of command.matchAll(/npm run ([A-Za-z0-9:_-]+)/g)) collect(match[1]);
  for (const match of command.matchAll(/tests\/[A-Za-z0-9_./-]+\.test\.mjs/g)) testFiles.add(match[0]);
};

roots.forEach(collect);
const files = [...testFiles].sort();
if (files.length === 0) throw new Error('Aucun test métier collecté.');
for (const file of files) {
  if (!existsSync(resolve(file))) throw new Error(`Test métier absent : ${file}`);
}

console.log(`Suite métier CI : ${files.length} fichiers Node uniques.`);
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=4', ...files], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
