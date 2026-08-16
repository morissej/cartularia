import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const separator = process.argv.indexOf('--');
const command = separator >= 0 ? process.argv[separator + 1] : null;
const commandArguments = separator >= 0 ? process.argv.slice(separator + 2) : [];
if (!command) throw new Error('Utilisation : node scripts/run-with-firebase-cli-adc.mjs -- <commande> [...arguments]');

const firebaseToolsLib = process.env.FIREBASE_TOOLS_LIB
  || fileURLToPath(new URL('../node_modules/firebase-tools/lib/', import.meta.url));
const auth = require(join(firebaseToolsLib, 'auth.js'));
const api = require(join(firebaseToolsLib, 'api.js'));
const account = auth.getGlobalDefaultAccount();
if (!account?.tokens?.refresh_token) throw new Error('Session Firebase CLI introuvable. Exécutez firebase login.');

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'cartularia-firebase-adc-'));
const credentialPath = join(temporaryDirectory, 'application-default.json');
try {
  await writeFile(credentialPath, JSON.stringify({
    type: 'authorized_user',
    client_id: api.clientId(),
    client_secret: api.clientSecret(),
    refresh_token: account.tokens.refresh_token,
  }), { mode: 0o600 });
  const status = await new Promise((resolve, reject) => {
    const child = spawn(command, commandArguments, {
      env: {
        ...process.env,
        GOOGLE_APPLICATION_CREDENTIALS: credentialPath,
        CARTULARIA_USE_FIREBASE_CLI_AUTH: 'false',
      },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  if (status.signal) throw new Error(`Commande interrompue par ${status.signal}.`);
  process.exitCode = status.code ?? 1;
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
