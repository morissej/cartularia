import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const projectRoot = new URL('../', import.meta.url);

test('Hosting publishes defensive headers without enforcing CSP yet', async () => {
  const config = JSON.parse(await readFile(new URL('firebase.json', projectRoot), 'utf8'));
  const headers = Object.fromEntries(config.hosting.headers[0].headers.map(({ key, value }) => [key, value]));

  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.match(headers['Content-Security-Policy-Report-Only'], /frame-ancestors 'none'/);
  assert.equal(headers['Content-Security-Policy'], undefined);
});

test('App Check is initialized only outside Firebase emulators', async () => {
  const source = await readFile(new URL('src/firebase.ts', projectRoot), 'utf8');

  assert.match(source, /ReCaptchaEnterpriseProvider/);
  assert.match(source, /!usesFirebaseEmulators && appCheckSiteKey/);
  assert.match(source, /isTokenAutoRefreshEnabled: true/);
});
