export const HANDOFF_VERSION = 'cartularia-code-handoff@1';
export const HANDOFF_TTL = 10 * 60_000;
export const MAX_HANDOFF_FRAGMENT = 262_144;
export type CodeOption = { code: string; genericLabel: string };
export type CodeSnapshot = { locations: CodeOption[]; people: CodeOption[] };
export type RegistryRecipient = { uid: string; email: string };
export type CodeHandoffReturn = { version: typeof HANDOFF_VERSION; nonce: string; expiresAt: number; recipient: RegistryRecipient; outcome: 'codes' | 'cancelled'; snapshot?: CodeSnapshot };
export const handoffChannelName = (nonce: string) => `cartularia-codes-${nonce}`;
export const validNonce = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
export const validRecipient = (value: unknown): value is RegistryRecipient => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as RegistryRecipient;
  return Object.keys(candidate).sort().join(',') === 'email,uid'
    && typeof candidate.uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(candidate.uid)
    && typeof candidate.email === 'string' && /^[a-f0-9]{64}@registry\.cartularia\.invalid$/.test(candidate.email);
};
export function trustedOrigin(value: string, allowLocal = false) {
  try {
    const url = new URL(value);
    if (url.username || url.password || (url.protocol !== 'https:' && !(allowLocal && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) return null;
    return url.origin;
  } catch { return null; }
}
export function parseCodeSnapshot(value: unknown): CodeSnapshot | null {
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'locations,people') return null;
  const snapshot = value as CodeSnapshot;
  const parse = (entries: unknown, kind: 'locations' | 'people'): CodeOption[] | null => {
    if (!Array.isArray(entries) || entries.length > 1000) return null;
    const prefix = kind === 'locations' ? /^LIE-[A-F0-9]{8}$/ : /^(CLI|PER|GES)-[A-F0-9]{8}$/;
    const codes = new Set<string>();
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Object.keys(entry).sort().join(',') !== 'code,genericLabel'
        || !prefix.test(entry.code) || codes.has(entry.code)
        || (entry.genericLabel !== entry.code && !new RegExp(`^${kind === 'locations' ? 'Lieu' : 'Personne'} [1-9][0-9]{0,3}$`).test(entry.genericLabel))) return null;
      codes.add(entry.code);
    }
    return entries.map(({ code, genericLabel }) => ({ code, genericLabel }));
  };
  const locations = parse(snapshot.locations, 'locations'); const people = parse(snapshot.people, 'people');
  return locations && people ? { locations, people } : null;
}
export function neutralCodeOptions(entries: Array<{ code: string; genericLabel?: unknown }>, kind: 'locations' | 'people'): CodeOption[] {
  const pattern = kind === 'locations' ? /^LIE-[A-F0-9]{8}$/ : /^(CLI|PER|GES)-[A-F0-9]{8}$/;
  const labelPattern = new RegExp(`^${kind === 'locations' ? 'Lieu' : 'Personne'} [1-9][0-9]{0,3}$`);
  if (entries.length > 1000 || entries.some(({ code }) => !pattern.test(code)) || new Set(entries.map(({ code }) => code)).size !== entries.length) throw new Error('Inventaire de codes invalide.');
  return entries.map(({ code, genericLabel }) => ({ code, genericLabel: typeof genericLabel === 'string' && labelPattern.test(genericLabel) ? genericLabel : code })).sort((left, right) => left.code.localeCompare(right.code));
}
export function parseHandoffReturn(value: unknown, now = Date.now()): CodeHandoffReturn | null {
  if (!value || typeof value !== 'object') return null;
  const packet = value as CodeHandoffReturn;
  const keys = packet.outcome === 'codes' ? 'expiresAt,nonce,outcome,recipient,snapshot,version' : 'expiresAt,nonce,outcome,recipient,version';
  if (Object.keys(packet).sort().join(',') !== keys || packet.version !== HANDOFF_VERSION || !validNonce(packet.nonce)
    || !validRecipient(packet.recipient) || typeof packet.expiresAt !== 'number' || !Number.isFinite(packet.expiresAt)
    || packet.expiresAt <= now || packet.expiresAt > now + HANDOFF_TTL
    || !['codes', 'cancelled'].includes(packet.outcome)) return null;
  if (packet.outcome === 'cancelled') return packet;
  const snapshot = parseCodeSnapshot(packet.snapshot);
  return snapshot ? { ...packet, snapshot } : null;
}
