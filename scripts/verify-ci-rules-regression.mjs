import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const reservePort = () => new Promise((resolvePort, reject) => {
  const server = createServer();
  server.unref();
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    server.close((error) => (error ? reject(error) : resolvePort(port)));
  });
});

const workspace = process.cwd();
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'cartularia-p9-regression-'));
const mutatedRulesPath = join(temporaryDirectory, 'firestore.rules');
const markerPath = join(temporaryDirectory, 'probe-connected.txt');
const configPath = join(temporaryDirectory, 'firebase.json');
const xdgPath = join(temporaryDirectory, 'xdg');
mkdirSync(xdgPath);

try {
  const source = readFileSync(resolve(workspace, 'firestore.rules'), 'utf8');
  const finalDeny = '    match /{document=**} {\n      allow read, write: if false;\n    }';
  const finalDenyIndex = source.lastIndexOf(finalDeny);
  if (finalDenyIndex < 0) throw new Error('Garde finale Firestore introuvable ; aucune mutation temporaire effectuée.');
  const mutated = `${source.slice(0, finalDenyIndex)}${finalDeny.replace('if false', 'if true')}${source.slice(finalDenyIndex + finalDeny.length)}`;
  writeFileSync(mutatedRulesPath, mutated);

  const [firestorePort, websocketPort, hubPort, loggingPort] = await Promise.all([
    reservePort(), reservePort(), reservePort(), reservePort(),
  ]);
  writeFileSync(configPath, `${JSON.stringify({
    firestore: { rules: 'firestore.rules' },
    emulators: {
      firestore: { host: '127.0.0.1', port: firestorePort, websocketPort },
      hub: { host: '127.0.0.1', port: hubPort },
      logging: { host: '127.0.0.1', port: loggingPort },
      ui: { enabled: false },
      singleProjectMode: true,
    },
  }, null, 2)}\n`);

  const firebaseCli = resolve(workspace, 'node_modules/.bin/firebase');
  const probePath = resolve(workspace, 'tests/firestore-rule-regression-probe.test.mjs');
  const result = spawnSync(firebaseCli, [
    'emulators:exec',
    '--config', configPath,
    '--project', 'cartularia-p9-regression-test',
    '--only', 'firestore',
    `node --test ${JSON.stringify(probePath)}`,
  ], {
    cwd: temporaryDirectory,
    encoding: 'utf8',
    env: {
      ...process.env,
      CARTULARIA_FIRESTORE_RULES_PATH: mutatedRulesPath,
      CARTULARIA_REGRESSION_PROBE_MARKER: markerPath,
      CARTULARIA_RULES_PROJECT_ID: 'cartularia-p9-regression-test',
      FIREBASE_CLI_DISABLE_UPDATE_CHECK: 'true',
      XDG_CONFIG_HOME: xdgPath,
    },
  });

  if (result.error) throw result.error;
  if (!existsSync(markerPath)) {
    throw new Error(`La sonde n'a pas atteint l'émulateur.\n${result.stdout}\n${result.stderr}`);
  }
  if (result.status === 0) {
    throw new Error('La copie volontairement affaiblie des règles n’a pas été détectée.');
  }
  console.log('Régression temporaire détectée : la lecture anonyme élargie fait échouer la sonde Firestore.');
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
