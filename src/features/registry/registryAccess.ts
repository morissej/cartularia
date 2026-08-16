import type {
  RegistryAccessKind,
  RegistryAccessProjection,
  RegistryAccessSourceStatus,
} from '../../domain/access.ts';
import type { FirestoreTimestampValue } from '../../domain/foundations.ts';

export type RegistryAccessStatus = RegistryAccessSourceStatus;
export type RegistryAccessConsultationFilter = 'all' | 'consulted' | 'never';

export interface RegistryAccessFilters {
  query: string;
  status: 'all' | RegistryAccessStatus;
  accessKind: 'all' | RegistryAccessKind;
  consultation: RegistryAccessConsultationFilter;
}

export interface RegistryAccessSummary {
  total: number;
  active: number;
  pending: number;
  expired: number;
  revoked: number;
  consultations: number;
  consultedAccesses: number;
}

export const DEFAULT_REGISTRY_ACCESS_FILTERS: RegistryAccessFilters = {
  query: '',
  status: 'all',
  accessKind: 'all',
  consultation: 'all',
};

const normalize = (value: string | number | null | undefined) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('fr');

export const accessDate = (
  value: string | FirestoreTimestampValue | null | undefined,
): Date | null => {
  if (!value) return null;
  const date = typeof value === 'string'
    ? new Date(value)
    : new Date(value.seconds * 1_000 + value.nanoseconds / 1_000_000);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const deriveRegistryAccessStatus = (
  access: RegistryAccessProjection,
  now = new Date(),
): RegistryAccessStatus => {
  if (access.sourceStatus === 'revoked') return 'revoked';
  if (access.sourceStatus === 'expired') return 'expired';
  const expiresAt = accessDate(access.expiresAt);
  if (expiresAt && expiresAt.getTime() <= now.getTime()) return 'expired';
  return access.sourceStatus;
};

export const maskRecipientReference = (value: string): string => {
  const trimmed = value.trim();
  const emailParts = trimmed.split('@');
  if (emailParts.length === 2 && emailParts[0] && emailParts[1]) {
    return `${emailParts[0].slice(0, 1)}***@${emailParts[1]}`;
  }
  if (/^[A-Za-z0-9_-]{9,}$/.test(trimmed)) {
    return `${trimmed.slice(0, 3)}…${trimmed.slice(-3)}`;
  }
  return trimmed || 'Destinataire privé';
};

export const buildRegistryAccessSummary = (
  accesses: RegistryAccessProjection[],
  now = new Date(),
): RegistryAccessSummary => {
  const visibleAccesses = accesses.filter((access) => access.projectionStatus === 'active');
  const statuses = visibleAccesses.map((access) => deriveRegistryAccessStatus(access, now));
  return {
    total: visibleAccesses.length,
    active: statuses.filter((status) => status === 'active').length,
    pending: statuses.filter((status) => status === 'pending').length,
    expired: statuses.filter((status) => status === 'expired').length,
    revoked: statuses.filter((status) => status === 'revoked').length,
    consultations: visibleAccesses.reduce((total, access) => total + Math.max(0, access.consultationCount || 0), 0),
    consultedAccesses: visibleAccesses.filter((access) => access.consultationCount > 0).length,
  };
};

export const filterAndSortRegistryAccesses = (
  accesses: RegistryAccessProjection[],
  filters: RegistryAccessFilters,
  now = new Date(),
): RegistryAccessProjection[] => {
  const tokens = normalize(filters.query).split(/\s+/).filter(Boolean);
  const filtered = accesses.filter((access) => {
    if (access.projectionStatus !== 'active') return false;
    const status = deriveRegistryAccessStatus(access, now);
    if (filters.status !== 'all' && filters.status !== status) return false;
    if (filters.accessKind !== 'all' && filters.accessKind !== access.accessKind) return false;
    if (filters.consultation === 'consulted' && access.consultationCount <= 0) return false;
    if (filters.consultation === 'never' && access.consultationCount > 0) return false;
    const haystack = normalize([
      access.displayTitle,
      maskRecipientReference(access.recipientLabel),
      access.recipientKind,
      access.accessKind,
      status,
    ].join(' '));
    return tokens.every((token) => haystack.includes(token));
  });

  const statusOrder: Record<RegistryAccessStatus, number> = {
    active: 0,
    pending: 1,
    expired: 2,
    revoked: 3,
  };
  const dateValue = (access: RegistryAccessProjection) => (
    accessDate(access.expiresAt)?.getTime()
    ?? accessDate(access.issuedAt)?.getTime()
    ?? 0
  );
  return [...filtered].sort((left, right) => {
    const leftStatus = deriveRegistryAccessStatus(left, now);
    const rightStatus = deriveRegistryAccessStatus(right, now);
    return statusOrder[leftStatus] - statusOrder[rightStatus]
      || dateValue(left) - dateValue(right)
      || left.displayTitle.localeCompare(right.displayTitle, 'fr', { sensitivity: 'base' });
  });
};
