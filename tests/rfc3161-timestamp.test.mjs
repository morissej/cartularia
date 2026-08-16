import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TimestampGatewayError,
  parseRfc3161ReplyText,
  validateTimestampRequest,
} from '../scripts/lib/rfc3161-timestamp.mjs';

test('la passerelle n’accepte qu’une empreinte SHA-256 et un identifiant opaque', () => {
  const digest = `sha256:${'a'.repeat(64)}`;
  assert.deepEqual(validateTimestampRequest({ digest, requestId: 'timestamp-request-001' }), {
    digest,
    requestId: 'timestamp-request-001',
  });
  assert.throws(
    () => validateTimestampRequest({ digest: 'IWC Flieger UTC', requestId: 'timestamp-request-001' }),
    (error) => error instanceof TimestampGatewayError && error.code === 'invalid_digest',
  );
  assert.throws(
    () => validateTimestampRequest({ digest, requestId: 'court' }),
    (error) => error instanceof TimestampGatewayError && error.code === 'invalid_request_id',
  );
});

test('la réponse RFC 3161 doit être accordée, SHA-256, datée et protégée par nonce', () => {
  const parsed = parseRfc3161ReplyText(`
Status info:
Status: Granted.

TST info:
Policy OID: 2.16.840.1.114412.7.1
Hash Algorithm: sha256
Serial number: 0x1234
Time stamp: Aug 16 08:02:36 2026 GMT
Nonce: 0x9876
`);
  assert.deepEqual(parsed, {
    issuedAt: '2026-08-16T08:02:36.000Z',
    policyOid: '2.16.840.1.114412.7.1',
    serialNumber: '0x1234',
    hashAlgorithm: 'sha256',
    nonce: '0x9876',
  });
  assert.throws(
    () => parseRfc3161ReplyText('Status: Rejection.\nFailure info: badAlg'),
    (error) => error instanceof TimestampGatewayError && error.code === 'tsa_rejected',
  );
});
