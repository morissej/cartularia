export const REGISTRY_AUDIT_ACTION_LABELS: Record<string, string> = {
  'cartulary.created': 'Cartulaire créé',
  'cartulary.live_state.synced': 'Modifications du Cartulaire raccordées',
  'cartulary.schema.upgraded': 'Remontée du Cartulaire vers la version de schéma en vigueur',
  'registry.projected': 'Projection du Registre actualisée',
  'projection.approved': 'Projection approuvée',
  'publication.published': 'Publication réalisée',
  'report.projected': 'Rapport projeté',
  'publication.revoked': 'Publication révoquée',
  'community.published': 'Publication Communauté réalisée',
  'publication.suspended': 'Publication suspendue',
  'cartulary.export.requested': 'Export propriétaire préparé',
  'cartulary.transfer.proposed': 'Cession proposée par le propriétaire',
  'cartulary.transfer.accepted': 'Cession acceptée par l’acquéreur',
  'cartulary.transfer.completed': 'Changement de propriétaire effectif',
  'cartulary.transfer.rejected': 'Cession refusée par l’acquéreur',
  'cartulary.transfer.expired': 'Proposition de cession expirée',
  // Chaîne des Cartulaires de démonstration (scripts/seed-demo-account.mjs, scripts/lib/demo-data-repair.mjs) :
  // aucun libellé technique ne doit atteindre le visiteur de la page Preuves du Registre démo.
  'cartulary.demo.created': 'Cartulaire de démonstration créé',
  'cartulary.demo.data_repaired': 'Données de démonstration réparées',
  'cartulary.demo.enriched': 'Données de démonstration enrichies',
};

export const auditActionLabel = (action: string) => REGISTRY_AUDIT_ACTION_LABELS[action]
  || action.split('.').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' · ');

export const shortDigest = (digest: string, visible = 12) => digest.startsWith('sha256:')
  ? `${digest.slice(0, 7 + visible)}…${digest.slice(-6)}`
  : digest || '—';
