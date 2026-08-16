import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectRegistryPilotChecks,
  evaluateRegistryPilotReadiness,
} from './lib/registry-pilot-readiness.mjs';

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const productionPolicy = JSON.parse(readFileSync(resolve(rootDirectory, 'config/production-policy.json'), 'utf8'));
const checks = collectRegistryPilotChecks(rootDirectory);
const readiness = evaluateRegistryPilotReadiness({ checks, productionPolicy });
const report = {
  generatedAtIso: new Date().toISOString(),
  ...readiness,
};

const outputArgument = process.argv.find((argument) => argument.startsWith('--output='));
if (outputArgument) {
  const outputPath = resolve(outputArgument.slice('--output='.length));
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  chmodSync(outputPath, 0o600);
}

console.log(JSON.stringify(report, null, 2));
if (readiness.pilotStatus !== 'ready') process.exitCode = 1;
