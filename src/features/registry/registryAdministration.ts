import type {
  FoundationPermission,
  MembershipDocument,
  MembershipRole,
  MembershipStatus,
} from '../../domain/foundations.ts';

export const ROLE_LABELS: Record<string, string> = {
  account_holder: 'Titulaire du compte',
  legal_owner: 'Propriétaire légal',
  manager: 'Gestionnaire',
  payer: 'Payeur',
  prescriber: 'Prescripteur',
  beneficiary: 'Bénéficiaire',
  community_member: 'Membre du Cercle',
  guest: 'Invité',
  expert: 'Expert',
  support_delegate: 'Assistance déléguée',
};

export const ROLE_DESCRIPTIONS: Record<string, string> = {
  account_holder: 'Administre le compte sans être nécessairement propriétaire des actifs.',
  legal_owner: 'Porte la qualité de propriétaire légal selon le dossier et ses preuves.',
  manager: 'Organise les contenus dans les limites des droits attribués.',
  payer: 'Finance le service sans recevoir automatiquement un droit patrimonial.',
  prescriber: 'Déclenche un service avec un accès limité à son mandat.',
  beneficiary: 'Peut recevoir un dossier ou un droit prévu, sans autorité implicite.',
  community_member: 'Accède au Cercle selon une admission séparée.',
  guest: 'Dispose d’un périmètre temporaire et minimal.',
  expert: 'Intervient sur un besoin professionnel borné.',
  support_delegate: 'Assistance temporaire, motivée, révocable et auditée.',
};

export const PERMISSION_LABELS: Record<string, string> = {
  'organization.read': 'Voir l’organisation',
  'membership.read': 'Voir les membres',
  'registry.read': 'Ouvrir le Registre',
  'access.read': 'Voir les accès partagés',
  'cartulary.read': 'Lire les Cartulaires autorisés',
  'cartulary.edit': 'Modifier les Cartulaires autorisés',
  'cartulary.export': 'Exporter ses Cartulaires',
  'integrity.batch': 'Créer un lot d’intégrité',
  'publication.manage': 'Gérer les publications',
  'billing.read': 'Voir la facturation',
};

export const MEMBERSHIP_STATUS_LABELS: Record<MembershipStatus, string> = {
  invited: 'Invité',
  active: 'Actif',
  suspended: 'Suspendu',
  revoked: 'Révoqué',
};

export interface RegistryAdministrationSummary {
  total: number;
  active: number;
  invited: number;
  suspended: number;
  revoked: number;
  roleCount: number;
  payerCount: number;
  supportDelegateCount: number;
  activeWithoutScopeCount: number;
  payerWithPatrimonialAccessCount: number;
}

const PATRIMONIAL_PERMISSIONS = new Set<FoundationPermission>([
  'registry.read',
  'access.read',
  'cartulary.read',
  'cartulary.edit',
  'cartulary.export',
  'publication.manage',
]);

export const buildRegistryAdministrationSummary = (
  sourceMemberships: MembershipDocument[],
): RegistryAdministrationSummary => {
  const memberships = [...sourceMemberships];
  const countStatus = (status: MembershipStatus) => memberships.filter((membership) => membership.status === status).length;
  const active = memberships.filter((membership) => membership.status === 'active');
  return {
    total: memberships.length,
    active: countStatus('active'),
    invited: countStatus('invited'),
    suspended: countStatus('suspended'),
    revoked: countStatus('revoked'),
    roleCount: new Set(active.flatMap((membership) => membership.roles)).size,
    payerCount: active.filter((membership) => membership.roles.includes('payer')).length,
    supportDelegateCount: active.filter((membership) => membership.roles.includes('support_delegate')).length,
    activeWithoutScopeCount: active.filter((membership) => membership.scopes.registryIds.length === 0).length,
    payerWithPatrimonialAccessCount: active.filter((membership) => (
      membership.roles.includes('payer')
      && membership.permissions.some((permission) => PATRIMONIAL_PERMISSIONS.has(permission))
    )).length,
  };
};

const normalize = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('fr');

export const filterMemberships = (
  memberships: MembershipDocument[],
  filters: { query: string; status: 'all' | MembershipStatus; role: 'all' | MembershipRole },
): MembershipDocument[] => {
  const tokens = normalize(filters.query).split(/\s+/).filter(Boolean);
  return memberships.filter((membership) => {
    if (filters.status !== 'all' && membership.status !== filters.status) return false;
    if (filters.role !== 'all' && !membership.roles.includes(filters.role)) return false;
    const haystack = normalize([
      membership.uid,
      membership.status,
      ...membership.roles.flatMap((role) => [role, ROLE_LABELS[role] || role]),
      ...membership.permissions.flatMap((permission) => [permission, PERMISSION_LABELS[permission] || permission]),
    ].join(' '));
    return tokens.every((token) => haystack.includes(token));
  });
};

export const displayMemberReference = (uid: string, currentUid: string): string => {
  if (uid === currentUid) return 'Votre compte';
  if (uid.length <= 6) return 'Membre privé';
  return `Membre ${uid.slice(0, 3)}…${uid.slice(-3)}`;
};
