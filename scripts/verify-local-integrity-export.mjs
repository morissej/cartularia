import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyLocalIntegrityBundle } from './lib/local-integrity-verifier.mjs';
import { verifyPortableRfc3161Receipts } from './lib/rfc3161-verifier.mjs';

const inputArgument = process.argv.find((argument) => argument.startsWith('--input='));
if (!inputArgument) {
  throw new Error('Usage : npm run integrity:verify-local -- --input=/chemin/export.json');
}

const inputPath = resolve(inputArgument.slice('--input='.length));
const bundle = JSON.parse(readFileSync(inputPath, 'utf8'));
const localResult = verifyLocalIntegrityBundle(bundle);
const timestampResult = await verifyPortableRfc3161Receipts(bundle);
const result = {
  ...localResult,
  valid: localResult.valid && timestampResult.valid,
  externalTimestamps: timestampResult,
  errors: [...localResult.errors, ...timestampResult.errors],
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.valid) process.exitCode = 1;
