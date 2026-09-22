import { createRequire } from 'node:module';
import { CANONICALIZATION_VERSION, canonicalize, sha256Bytes, sha256Digest } from './canonical-json.mjs';

export class DeterministicTimestampAdapter {
  constructor({ provider = 'cartularia-test-tsa' } = {}) {
    this.provider = provider;
  }

  async issue({ digest, requestId, issuedAt = new Date().toISOString() }) {
    const tokenPayload = {
      protocol: 'rfc3161-adapter-v1',
      provider: this.provider,
      qualified: false,
      digest,
      requestId,
      issuedAt,
      canonicalizationVersion: CANONICALIZATION_VERSION,
      fixture: true,
    };
    const token = Buffer.from(canonicalize(tokenPayload), 'utf8');
    return {
      receiptId: `tsr_${sha256Digest(tokenPayload).slice(7, 31)}`,
      ...tokenPayload,
      tokenBase64: token.toString('base64'),
      tokenSha256: sha256Bytes(token),
      verificationStatus: 'test_fixture',
    };
  }
}

export const toPublicAnchorPayload = (batch) => ({
  algorithm: batch.algorithm,
  canonicalizationVersion: batch.canonicalizationVersion,
  merkleRoot: batch.merkleRoot,
  leafCount: batch.leafCount,
});

export const publicAnchorPayloadDigest = (payload) => sha256Digest(payload);

export const OPENTIMESTAMPS_CALENDARS = Object.freeze([
  'https://a.pool.opentimestamps.org',
  'https://b.pool.opentimestamps.org',
  'https://a.pool.eternitywall.com',
  'https://ots.btc.catallaxy.com',
]);
export const OPENTIMESTAMPS_ESPLORA_URL = 'https://blockstream.info/api';
export const OPENTIMESTAMPS_MAXIMUM_PROOF_BYTES = 64 * 1024;
const allowedOpenTimestampsCalendars = new Set(OPENTIMESTAMPS_CALENDARS);

const failOpenTimestamps = (code, message) => {
  const error = new TypeError(message);
  error.code = code;
  throw error;
};

const normalizeOpenTimestampsCalendars = (calendars) => {
  const selected = calendars ?? OPENTIMESTAMPS_CALENDARS;
  if (!Array.isArray(selected) || selected.length === 0) {
    return failOpenTimestamps('invalid_opentimestamps_calendars', 'Au moins un calendrier OpenTimestamps approuvé est requis.');
  }
  const normalized = [...new Set(selected)];
  if (normalized.some((calendar) => !allowedOpenTimestampsCalendars.has(calendar))) {
    return failOpenTimestamps('invalid_opentimestamps_calendars', 'Le calendrier OpenTimestamps demandé n’est pas approuvé.');
  }
  return Object.freeze(normalized);
};

const decodeOpenTimestampsProof = (proofBase64) => {
  if (typeof proofBase64 !== 'string' || proofBase64.length === 0 || proofBase64.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(proofBase64)) {
    return failOpenTimestamps('invalid_public_anchor_proof', 'Preuve OpenTimestamps illisible.');
  }
  const proof = Buffer.from(proofBase64, 'base64');
  if (proof.length === 0 || proof.length > OPENTIMESTAMPS_MAXIMUM_PROOF_BYTES) {
    return failOpenTimestamps('invalid_public_anchor_proof', 'Preuve OpenTimestamps absente ou trop volumineuse.');
  }
  return proof;
};

const loadOpenTimestamps = () => {
  const require = createRequire(import.meta.url);
  return require('opentimestamps');
};

const normalizeBitcoinVerification = (verification) => {
  const bitcoin = verification?.bitcoin;
  if (!bitcoin || !Number.isInteger(bitcoin.height) || !Number.isFinite(bitcoin.timestamp)) return null;
  return {
    blockHeight: bitcoin.height,
    confirmedAtIso: new Date(bitcoin.timestamp * 1000).toISOString(),
  };
};

export class OpenTimestampsPublicAnchorAdapter {
  constructor({ client, calendars, minimumCalendarResponses = 2, timeout = 10_000 } = {}) {
    this.client = client;
    this.calendars = normalizeOpenTimestampsCalendars(calendars);
    if (!Number.isInteger(minimumCalendarResponses) || minimumCalendarResponses < 1 || minimumCalendarResponses > this.calendars.length) {
      failOpenTimestamps('invalid_opentimestamps_quorum', 'Le quorum OpenTimestamps doit tenir dans la liste des calendriers approuvés.');
    }
    this.minimumCalendarResponses = minimumCalendarResponses;
    this.timeout = timeout;
  }

  async anchor({ payloadDigest, proofBase64 = null }) {
    if (!/^sha256:[a-f0-9]{64}$/.test(payloadDigest || '')) {
      const error = new TypeError('Empreinte publique SHA-256 invalide.');
      error.code = 'invalid_public_anchor_digest';
      throw error;
    }
    if (this.client) return this.client.anchor({ payloadDigest, proofBase64 });

    const OpenTimestamps = loadOpenTimestamps();
    const digestBytes = Buffer.from(payloadDigest.slice('sha256:'.length), 'hex');
    const original = OpenTimestamps.DetachedTimestampFile.fromHash(
      new OpenTimestamps.Ops.OpSHA256(),
      digestBytes,
    );
    let stamped;
    if (proofBase64) {
      stamped = OpenTimestamps.DetachedTimestampFile.deserialize(decodeOpenTimestampsProof(proofBase64));
      await OpenTimestamps.upgrade(stamped, {
        calendars: this.calendars,
        timeout: this.timeout,
      });
    } else {
      stamped = OpenTimestamps.DetachedTimestampFile.fromHash(
        new OpenTimestamps.Ops.OpSHA256(),
        digestBytes,
      );
      await OpenTimestamps.stamp(stamped, {
        calendars: this.calendars,
        m: this.minimumCalendarResponses,
      });
    }

    const proofBytes = Buffer.from(stamped.serializeToBytes());
    let confirmation = null;
    try {
      confirmation = normalizeBitcoinVerification(await OpenTimestamps.verify(stamped, original, {
        calendars: this.calendars,
        esplora: { url: OPENTIMESTAMPS_ESPLORA_URL, timeout: this.timeout },
        ignoreBitcoinNode: true,
        timeout: this.timeout,
      }));
    } catch {
      confirmation = null;
    }
    return {
      provider: 'opentimestamps',
      network: 'bitcoin-mainnet',
      protocol: 'opentimestamps-v1',
      status: confirmation ? 'anchored' : 'pending_confirmation',
      payloadDigest,
      proofBase64: proofBytes.toString('base64'),
      proofSha256: sha256Bytes(proofBytes),
      ...(confirmation || {}),
    };
  }
}
