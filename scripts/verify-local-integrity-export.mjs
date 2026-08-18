import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyIndependentIntegrityBundle } from './lib/local-integrity-verifier.mjs';

const inputArgument = process.argv.find((argument) => argument.startsWith('--input='));
if (!inputArgument) {
  throw new Error('Usage : npm run integrity:verify-local -- --input=/chemin/export.json');
}

const inputPath = resolve(inputArgument.slice('--input='.length));
const bundle = JSON.parse(readFileSync(inputPath, 'utf8'));
const result = await verifyIndependentIntegrityBundle(bundle);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.valid) process.exitCode = 1;
