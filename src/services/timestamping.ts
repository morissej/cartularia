import type { Rfc3161GatewayReceipt } from '../utils/integrityJournal';

interface TimestampGatewayErrorBody {
  error?: string;
  message?: string;
}

const isGatewayReceipt = (value: unknown): value is Rfc3161GatewayReceipt => {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as Partial<Rfc3161GatewayReceipt>;
  return receipt.protocol === 'rfc3161-v1'
    && receipt.status === 'ExternalReceipt'
    && receipt.verificationStatus !== undefined
    && receipt.signatureVerified === true
    && receipt.chainVerified === true
    && receipt.nonceMatched === true
    && typeof receipt.tokenBase64 === 'string'
    && typeof receipt.requestBase64 === 'string'
    && typeof receipt.issuedAt === 'string';
};

export const requestExternalTimestamp = async (digest: string): Promise<Rfc3161GatewayReceipt> => {
  const endpoint = import.meta.env.VITE_CARTULARIA_TIMESTAMP_URL || '/api/timestamps';
  const requestId = `timestamp-${globalThis.crypto.randomUUID()}`;
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ digest, requestId }),
      signal: controller.signal,
      credentials: 'same-origin',
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = body as TimestampGatewayErrorBody | null;
      throw new Error(error?.message || `Horodatage externe indisponible (HTTP ${response.status}).`);
    }
    if (!isGatewayReceipt(body)) throw new Error('La passerelle a renvoyé un reçu RFC 3161 incomplet.');
    return body;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('L’autorité d’horodatage n’a pas répondu dans le délai prévu.');
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
};
