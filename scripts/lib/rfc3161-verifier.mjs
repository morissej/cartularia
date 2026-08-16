import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rootCertificates } from 'node:tls';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const decodeBase64 = (value) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new TypeError('base64 invalide');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw new TypeError('base64 non canonique');
  return bytes;
};

export const verifyPortableRfc3161Receipt = async (receipt) => {
  const errors = [];
  if (receipt?.protocol !== 'rfc3161-v1') return { valid: true, errors };
  const workingDirectory = await mkdtemp(join(tmpdir(), 'cartularia-rfc3161-verify-'));
  try {
    const query = decodeBase64(receipt.requestBase64);
    const response = decodeBase64(receipt.tokenBase64);
    if (sha256(query) !== receipt.requestSha256) errors.push({ code: 'timestamp_request_digest_mismatch' });
    if (sha256(response) !== receipt.tokenSha256) errors.push({ code: 'timestamp_token_digest_mismatch' });
    if (errors.length > 0) return { valid: false, errors };
    const queryPath = join(workingDirectory, 'request.tsq');
    const responsePath = join(workingDirectory, 'response.tsr');
    const tokenPath = join(workingDirectory, 'token.tst');
    const certificatesPath = join(workingDirectory, 'certificates.pem');
    const trustStorePath = join(workingDirectory, 'node-root-certificates.pem');
    await Promise.all([
      writeFile(queryPath, query, { flag: 'wx' }),
      writeFile(responsePath, response, { flag: 'wx' }),
      writeFile(trustStorePath, `${rootCertificates.join('\n')}\n`, { flag: 'wx', mode: 0o600 }),
    ]);
    await execFileAsync('openssl', ['ts', '-reply', '-in', responsePath, '-token_out', '-out', tokenPath], { maxBuffer: 2 * 1024 * 1024 });
    await execFileAsync('openssl', ['pkcs7', '-inform', 'DER', '-in', tokenPath, '-print_certs', '-out', certificatesPath], { maxBuffer: 2 * 1024 * 1024 });
    await execFileAsync('openssl', [
      'ts', '-verify', '-queryfile', queryPath, '-in', responsePath,
      '-CAfile', trustStorePath, '-untrusted', certificatesPath,
    ], { maxBuffer: 2 * 1024 * 1024 });
    const certificateBundle = await readFile(certificatesPath, 'utf8');
    if (!certificateBundle.includes('BEGIN CERTIFICATE')) errors.push({ code: 'timestamp_signer_certificate_missing' });
  } catch {
    errors.push({ code: 'timestamp_rfc3161_verification_failed' });
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
  return { valid: errors.length === 0, errors };
};

export const verifyPortableRfc3161Receipts = async (bundle) => {
  const receipts = Array.isArray(bundle?.receipts)
    ? bundle.receipts.filter((receipt) => receipt?.protocol === 'rfc3161-v1')
    : [];
  const results = await Promise.all(receipts.map(verifyPortableRfc3161Receipt));
  const errors = results.flatMap((result, index) => result.errors.map((error) => ({ ...error, receiptIndex: index })));
  return { valid: errors.length === 0, receiptCount: receipts.length, errors };
};
