import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { rootCertificates } from 'node:tls';

const execFileAsync = promisify(execFile);
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const MAX_RESPONSE_BYTES = 128 * 1024;

export class TimestampGatewayError extends Error {
  constructor(code, message, statusCode = 502) {
    super(message);
    this.name = 'TimestampGatewayError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const sha256Bytes = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

export const validateTimestampRequest = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TimestampGatewayError('invalid_request', 'Requête d’horodatage invalide.', 400);
  }
  if (!SHA256_PATTERN.test(input.digest || '')) {
    throw new TimestampGatewayError('invalid_digest', 'Une empreinte SHA-256 préfixée est requise.', 400);
  }
  if (!REQUEST_ID_PATTERN.test(input.requestId || '')) {
    throw new TimestampGatewayError('invalid_request_id', 'requestId est absent ou invalide.', 400);
  }
  return { digest: input.digest, requestId: input.requestId };
};

export const parseRfc3161ReplyText = (text) => {
  const field = (label) => text.match(new RegExp(`^${label}:\\s*(.+)$`, 'mi'))?.[1]?.trim();
  const status = field('Status');
  const issuedAtText = field('Time stamp');
  const issuedAtDate = issuedAtText ? new Date(issuedAtText) : null;
  if (status !== 'Granted.' && status !== 'Granted with mods.') {
    throw new TimestampGatewayError('tsa_rejected', `L’autorité d’horodatage a refusé la requête (${status || 'statut absent'}).`);
  }
  if (!issuedAtDate || Number.isNaN(issuedAtDate.valueOf())) {
    throw new TimestampGatewayError('invalid_tsa_time', 'Le jeton ne contient pas une date RFC 3161 exploitable.');
  }
  const policyOid = field('Policy OID');
  const serialNumber = field('Serial number');
  const hashAlgorithm = field('Hash Algorithm')?.toLowerCase();
  const nonce = field('Nonce');
  if (!policyOid || !serialNumber || hashAlgorithm !== 'sha256' || !nonce) {
    throw new TimestampGatewayError('invalid_tsa_reply', 'Le jeton RFC 3161 est incomplet ou n’utilise pas SHA-256.');
  }
  return {
    issuedAt: issuedAtDate.toISOString(),
    policyOid,
    serialNumber,
    hashAlgorithm,
    nonce,
  };
};

const safeEndpoint = (value) => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new TimestampGatewayError('invalid_tsa_url', 'Le protocole de l’autorité d’horodatage est interdit.', 500);
  }
  return `${url.origin}${url.pathname}`;
};

const runOpenSsl = async (args, options = {}) => {
  try {
    return await execFileAsync('openssl', args, { maxBuffer: 2 * 1024 * 1024, ...options });
  } catch (error) {
    const detail = typeof error?.stderr === 'string' ? error.stderr.trim().split('\n').at(-1) : '';
    throw new TimestampGatewayError('openssl_verification_failed', `Vérification OpenSSL impossible${detail ? ` : ${detail}` : ''}.`);
  }
};

const extractFirstCertificate = (pemBundle) => {
  const match = pemBundle.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
  if (!match) throw new TimestampGatewayError('tsa_certificate_missing', 'Le jeton ne contient pas le certificat du signataire.');
  return `${match[0]}\n`;
};

const parseCertificateIdentity = (text) => {
  const subject = text.match(/^subject=\s*(.+)$/mi)?.[1]?.trim();
  const issuer = text.match(/^issuer=\s*(.+)$/mi)?.[1]?.trim();
  const fingerprint = text.match(/^sha256 Fingerprint=\s*(.+)$/mi)?.[1]?.replaceAll(':', '').toLowerCase();
  if (!subject || !issuer || !fingerprint || fingerprint.length !== 64) {
    throw new TimestampGatewayError('tsa_certificate_invalid', 'L’identité du certificat TSA est illisible.');
  }
  return { subject, issuer, fingerprint: `sha256:${fingerprint}` };
};

export const issueRfc3161Timestamp = async ({
  digest,
  requestId,
  tsaUrl = process.env.CARTULARIA_TSA_URL || 'http://timestamp.digicert.com',
  provider = process.env.CARTULARIA_TSA_PROVIDER || 'DigiCert RFC 3161 TSA',
  timeoutMs = Number(process.env.CARTULARIA_TSA_TIMEOUT_MS || 20_000),
  fetchImpl = globalThis.fetch,
}) => {
  const request = validateTimestampRequest({ digest, requestId });
  if (typeof fetchImpl !== 'function') throw new TimestampGatewayError('transport_unavailable', 'Transport HTTP indisponible.', 500);
  const endpoint = safeEndpoint(tsaUrl);
  const workingDirectory = await mkdtemp(join(tmpdir(), 'cartularia-rfc3161-'));
  const queryPath = join(workingDirectory, 'request.tsq');
  const responsePath = join(workingDirectory, 'response.tsr');
  const tokenPath = join(workingDirectory, 'token.tst');
  const certificatesPath = join(workingDirectory, 'certificates.pem');
  const signerPath = join(workingDirectory, 'signer.pem');
  const trustStorePath = join(workingDirectory, 'node-root-certificates.pem');
  try {
    await runOpenSsl([
      'ts', '-query', '-digest', request.digest.slice(7), '-sha256', '-cert', '-out', queryPath,
    ]);
    const queryBytes = await readFile(queryPath);
    let response;
    try {
      response = await fetchImpl(tsaUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/timestamp-reply',
          'Content-Type': 'application/timestamp-query',
        },
        body: queryBytes,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      throw new TimestampGatewayError(
        timedOut ? 'tsa_timeout' : 'tsa_unreachable',
        timedOut ? 'L’autorité d’horodatage n’a pas répondu à temps.' : 'L’autorité d’horodatage est injoignable.',
      );
    }
    if (!response.ok) {
      throw new TimestampGatewayError('tsa_http_error', `L’autorité d’horodatage a répondu HTTP ${response.status}.`);
    }
    const responseBytes = Buffer.from(await response.arrayBuffer());
    if (responseBytes.length === 0 || responseBytes.length > MAX_RESPONSE_BYTES) {
      throw new TimestampGatewayError('tsa_response_size', 'La taille de la réponse RFC 3161 est invalide.');
    }
    await writeFile(responsePath, responseBytes, { flag: 'wx' });
    const { stdout: replyText } = await runOpenSsl(['ts', '-reply', '-in', responsePath, '-text']);
    const parsed = parseRfc3161ReplyText(replyText);
    await runOpenSsl(['ts', '-reply', '-in', responsePath, '-token_out', '-out', tokenPath]);
    await runOpenSsl(['pkcs7', '-inform', 'DER', '-in', tokenPath, '-print_certs', '-out', certificatesPath]);
    const certificateBundle = await readFile(certificatesPath, 'utf8');
    await writeFile(signerPath, extractFirstCertificate(certificateBundle), { flag: 'wx' });
    await writeFile(trustStorePath, `${rootCertificates.join('\n')}\n`, { flag: 'wx', mode: 0o600 });
    await runOpenSsl([
      'ts', '-verify', '-queryfile', queryPath, '-in', responsePath,
      '-CAfile', trustStorePath, '-untrusted', certificatesPath,
    ]);
    const { stdout: certificateText } = await runOpenSsl([
      'x509', '-in', signerPath, '-noout', '-subject', '-issuer', '-fingerprint', '-sha256',
    ]);
    const certificate = parseCertificateIdentity(certificateText);
    const verifiedAt = new Date().toISOString();
    const tokenSha256 = sha256Bytes(responseBytes);
    return {
      receiptId: `tsr_${tokenSha256.slice(7, 31)}`,
      protocol: 'rfc3161-v1',
      status: 'ExternalReceipt',
      provider,
      tsaEndpoint: endpoint,
      digest: request.digest,
      requestId: request.requestId,
      requestBase64: queryBytes.toString('base64'),
      requestSha256: sha256Bytes(queryBytes),
      tokenBase64: responseBytes.toString('base64'),
      tokenSha256,
      issuedAt: parsed.issuedAt,
      policyOid: parsed.policyOid,
      serialNumber: parsed.serialNumber,
      hashAlgorithm: parsed.hashAlgorithm,
      nonce: parsed.nonce,
      signerSubject: certificate.subject,
      signerIssuer: certificate.issuer,
      signerCertificateSha256: certificate.fingerprint,
      verificationStatus: 'trusted_rfc3161',
      signatureVerified: true,
      chainVerified: true,
      nonceMatched: true,
      qualified: false,
      qualificationStatus: 'not_assessed',
      publicAnchoringStatus: 'deferred',
      validationEvidence: {
        verifiedAt,
        verifier: 'openssl ts -verify',
        trustStore: 'node-root-certificates',
      },
    };
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
};

const readJsonBody = async (request, maxBytes = 4096) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new TimestampGatewayError('request_too_large', 'Requête trop volumineuse.', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new TimestampGatewayError('invalid_json', 'Corps JSON invalide.', 400);
  }
};

export const createRfc3161Middleware = (options = {}) => async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (request.method !== 'POST') {
    response.statusCode = 405;
    response.setHeader('Allow', 'POST');
    response.end(JSON.stringify({ error: 'method_not_allowed', message: 'Utilisez POST.' }));
    return;
  }
  try {
    const input = validateTimestampRequest(await readJsonBody(request));
    const receipt = await issueRfc3161Timestamp({ ...input, ...options });
    response.statusCode = 201;
    response.end(JSON.stringify(receipt));
  } catch (error) {
    const gatewayError = error instanceof TimestampGatewayError
      ? error
      : new TimestampGatewayError('timestamp_failed', 'L’horodatage externe a échoué.');
    response.statusCode = gatewayError.statusCode;
    response.end(JSON.stringify({ error: gatewayError.code, message: gatewayError.message }));
  }
};
