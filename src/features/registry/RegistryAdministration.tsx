import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  Building2,
  CircleCheck,
  CircleDollarSign,
  FileLock2,
  KeyRound,
  LibraryBig,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCog,
  UsersRound,
} from 'lucide-react';
import type {
  MembershipDocument,
  MembershipRole,
  MembershipStatus,
  OrganizationDocument,
  RegistryDocument,
} from '../../domain/foundations.ts';
import { loadOrganizationMemberships } from '../../services/foundations.ts';
import {
  buildRegistryAdministrationSummary,
  displayMemberReference,
  filterMemberships,
  MEMBERSHIP_STATUS_LABELS,
  PERMISSION_LABELS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
} from './registryAdministration.ts';
import { labelFromIdentifier } from './registryPresentation.ts';

type AdministrationLoadState = 'loading' | 'ready' | 'error';

const readInitialParameter = (name: string, fallback: string) =>
  new URLSearchParams(window.location.search).get(name) || fallback;

const permissionLabel = (permission: string) => PERMISSION_LABELS[permission] || labelFromIdentifier(permission);

export function RegistryAdministration({
  registry,
  organization,
  membership,
  organizationRegistries,
  currentUid,
}: {
  registry: RegistryDocument;
  organization: OrganizationDocument;
  membership: MembershipDocument;
  organizationRegistries: RegistryDocument[];
  currentUid: string;
}) {
  const canReadMembers = membership.permissions.includes('membership.read');
  const canReadBilling = membership.permissions.includes('billing.read');
  const [memberships, setMemberships] = useState<MembershipDocument[]>([membership]);
  const [loadState, setLoadState] = useState<AdministrationLoadState>('loading');
  const [query, setQuery] = useState(() => readInitialParameter('q', ''));
  const [status, setStatus] = useState<'all' | MembershipStatus>(() => {
    const candidate = readInitialParameter('status', 'all');
    return Object.hasOwn(MEMBERSHIP_STATUS_LABELS, candidate) ? candidate as MembershipStatus : 'all';
  });
  const [role, setRole] = useState<'all' | MembershipRole>(() => {
    const candidate = readInitialParameter('role', 'all');
    return Object.hasOwn(ROLE_LABELS, candidate) ? candidate as MembershipRole : 'all';
  });

  const reload = useCallback(async () => {
    if (!canReadMembers) {
      setMemberships([membership]);
      setLoadState('ready');
      return;
    }
    setLoadState('loading');
    try {
      setMemberships(await loadOrganizationMemberships(organization.id));
      setLoadState('ready');
    } catch {
      setMemberships([membership]);
      setLoadState('error');
    }
  }, [canReadMembers, membership, organization.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (status !== 'all') params.set('status', status);
    if (role !== 'all') params.set('role', role);
    return params.toString();
  }, [query, role, status]);

  useEffect(() => {
    const nextUrl = `${window.location.pathname}${queryString ? `?${queryString}` : ''}`;
    window.history.replaceState(null, '', nextUrl);
  }, [queryString]);

  const summary = useMemo(() => buildRegistryAdministrationSummary(memberships), [memberships]);
  const filteredMemberships = useMemo(() => filterMemberships(memberships, { query, status, role }), [memberships, query, role, status]);
  const roles = useMemo(() => [...new Set(memberships.flatMap((candidate) => candidate.roles))]
    .sort((left, right) => (ROLE_LABELS[left] || left).localeCompare(ROLE_LABELS[right] || right, 'fr')), [memberships]);
  const activeFilterCount = [query.trim(), status !== 'all', role !== 'all'].filter(Boolean).length;
  const governanceSignalCount = summary.activeWithoutScopeCount
    + summary.payerWithPatrimonialAccessCount
    + summary.supportDelegateCount;

  const resetFilters = () => {
    setQuery('');
    setStatus('all');
    setRole('all');
  };

  return (
    <section className="registry-administration" aria-labelledby="registry-administration-title">
      <header className="registry-page-heading registry-administration__heading">
        <div>
          <p className="registry-kicker">Administration · R5</p>
          <h1 id="registry-administration-title">Organisation et droits</h1>
          <p>Comprendre qui intervient, dans quel Registre et avec quelles permissions — sans ouvrir le contenu des Cartulaires.</p>
        </div>
        <button type="button" className="registry-refresh registry-administration__refresh" onClick={() => void reload()} disabled={loadState === 'loading'}>
          <RefreshCw className={loadState === 'loading' ? 'registry-spinner' : undefined} aria-hidden="true" />
          <span>Actualiser</span>
        </button>
      </header>

      <section className="registry-administration-facts" aria-label="Synthèse administrative">
        <article><Building2 aria-hidden="true" /><span>Organisation</span><strong>{organization.status === 'active' ? 'Active' : 'Suspendue'}</strong><small>{organization.name}</small></article>
        <article><UsersRound aria-hidden="true" /><span>Membres actifs</span><strong>{loadState === 'loading' ? '—' : summary.active}</strong><small>{canReadMembers ? `${summary.total} attribution${summary.total > 1 ? 's' : ''} visible${summary.total > 1 ? 's' : ''}` : 'Votre attribution uniquement'}</small></article>
        <article><LibraryBig aria-hidden="true" /><span>Registres dans votre portée</span><strong>{organizationRegistries.length}</strong><small>{registry.name}</small></article>
        <article className={governanceSignalCount > 0 ? 'is-attention' : undefined}><ShieldCheck aria-hidden="true" /><span>Points de gouvernance</span><strong>{loadState === 'loading' ? '—' : governanceSignalCount}</strong><small>{governanceSignalCount === 0 ? 'Séparation cohérente' : 'À contrôler ou documenter'}</small></article>
      </section>

      <div className="registry-administration-grid">
        <section className="registry-administration-panel registry-administration-panel--context">
          <header><div><span className="registry-step">Contexte</span><h2>Organisation et Registre</h2></div><Building2 aria-hidden="true" /></header>
          <dl className="registry-administration-details">
            <div><dt>Organisation</dt><dd>{organization.name}</dd></div>
            <div><dt>Registre courant</dt><dd>{registry.name}</dd></div>
            <div><dt>Statut</dt><dd>{registry.status === 'active' ? 'Actif' : 'Archivé'}</dd></div>
            <div><dt>Confidentialité</dt><dd>Secret par défaut</dd></div>
            <div><dt>Cartulaires projetés</dt><dd>{registry.itemCount}</dd></div>
            <div><dt>Modèle</dt><dd>{registry.modelVersion || '1.0.0'}</dd></div>
          </dl>
          {organizationRegistries.length > 1 && <div className="registry-administration-scopes"><span>Votre périmètre dans cette organisation</span>{organizationRegistries.map((candidate) => <a href={`/registry/${encodeURIComponent(candidate.id)}/admin`} aria-current={candidate.id === registry.id ? 'page' : undefined} key={candidate.id}><span>{candidate.name}</span><small>{candidate.status === 'active' ? 'Actif' : 'Archivé'}</small></a>)}</div>}
        </section>

        <section className="registry-administration-panel registry-administration-panel--rights">
          <header><div><span className="registry-step">Vos droits</span><h2>Permissions effectives</h2></div><KeyRound aria-hidden="true" /></header>
          <div className="registry-administration-role-summary">
            {membership.roles.map((currentRole) => <div key={currentRole}><BadgeCheck aria-hidden="true" /><span><strong>{ROLE_LABELS[currentRole] || labelFromIdentifier(currentRole)}</strong><small>{ROLE_DESCRIPTIONS[currentRole] || 'Qualité attribuée dans ce contexte.'}</small></span></div>)}
          </div>
          <div className="registry-administration-permissions">
            {membership.permissions.map((permission) => <span key={permission}><CircleCheck aria-hidden="true" />{permissionLabel(permission)}</span>)}
          </div>
        </section>

        <section className="registry-administration-panel registry-administration-panel--members">
          <header><div><span className="registry-step">Acteurs</span><h2>Membres et qualités</h2></div><UserCog aria-hidden="true" /></header>
          {!canReadMembers && <div className="registry-administration-notice"><LockKeyhole aria-hidden="true" /><p>Votre compte ne peut voir que sa propre attribution. La liste de l’organisation exige le droit « Voir les membres ».</p></div>}
          {canReadMembers && <div className="registry-administration-member-tools">
            <label><Search aria-hidden="true" /><span className="sr-only">Rechercher un membre ou une qualité</span><input type="search" placeholder="Rechercher une qualité ou une permission…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <select aria-label="Filtrer par statut" value={status} onChange={(event) => setStatus(event.target.value as 'all' | MembershipStatus)}><option value="all">Tous les statuts</option>{Object.entries(MEMBERSHIP_STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
            <select aria-label="Filtrer par qualité" value={role} onChange={(event) => setRole(event.target.value as 'all' | MembershipRole)}><option value="all">Toutes les qualités</option>{roles.map((value) => <option value={value} key={value}>{ROLE_LABELS[value] || labelFromIdentifier(value)}</option>)}</select>
            {activeFilterCount > 0 && <button type="button" onClick={resetFilters}>Effacer ({activeFilterCount})</button>}
          </div>}

          {loadState === 'loading' && <div className="registry-administration-state" role="status"><LoaderCircle className="registry-spinner" aria-hidden="true" /><span>Chargement des attributions autorisées…</span></div>}
          {loadState === 'error' && <div className="registry-administration-state registry-administration-state--error" role="alert"><AlertTriangle aria-hidden="true" /><span>La liste complète est indisponible. Votre propre attribution reste affichée.</span></div>}
          {loadState !== 'loading' && <div className="registry-administration-member-list">
            {filteredMemberships.map((candidate) => <article key={candidate.uid}>
              <div className="registry-administration-member-id"><span>{displayMemberReference(candidate.uid, currentUid)}</span><small className={`is-${candidate.status}`}>{MEMBERSHIP_STATUS_LABELS[candidate.status]}</small></div>
              <div className="registry-administration-member-roles">{candidate.roles.map((currentRole) => <span key={currentRole}>{ROLE_LABELS[currentRole] || labelFromIdentifier(currentRole)}</span>)}</div>
              <div className="registry-administration-member-scope"><strong>{candidate.scopes.registryIds.length}</strong><span>Registre{candidate.scopes.registryIds.length > 1 ? 's' : ''}</span></div>
              <div className="registry-administration-member-permissions"><strong>{candidate.permissions.length}</strong><span>Permission{candidate.permissions.length > 1 ? 's' : ''}</span></div>
            </article>)}
            {filteredMemberships.length === 0 && <div className="registry-administration-member-empty"><UsersRound aria-hidden="true" /><span>Aucune attribution ne correspond aux filtres.</span><button type="button" onClick={resetFilters}>Afficher tous les membres</button></div>}
          </div>}
        </section>

        <section className="registry-administration-panel registry-administration-panel--governance">
          <header><div><span className="registry-step">Séparation</span><h2>Contrôles de gouvernance</h2></div><ShieldCheck aria-hidden="true" /></header>
          <div className="registry-administration-controls">
            <div className={summary.payerWithPatrimonialAccessCount > 0 ? 'is-warning' : 'is-clear'}><span><CircleDollarSign aria-hidden="true" /><strong>Payeur distinct des droits patrimoniaux</strong></span><p>{summary.payerWithPatrimonialAccessCount > 0 ? `${summary.payerWithPatrimonialAccessCount} attribution de payeur porte aussi un accès patrimonial à revoir.` : 'Aucun droit patrimonial n’est déduit du seul rôle de payeur.'}</p></div>
            <div className={summary.activeWithoutScopeCount > 0 ? 'is-warning' : 'is-clear'}><span><LibraryBig aria-hidden="true" /><strong>Portée explicite</strong></span><p>{summary.activeWithoutScopeCount > 0 ? `${summary.activeWithoutScopeCount} attribution active ne porte aucun Registre.` : 'Chaque attribution active visible porte un périmètre de Registre explicite.'}</p></div>
            <div className={summary.supportDelegateCount > 0 ? 'is-warning' : 'is-clear'}><span><UserCog aria-hidden="true" /><strong>Assistance déléguée</strong></span><p>{summary.supportDelegateCount > 0 ? `${summary.supportDelegateCount} mandat d’assistance doit rester temporaire, motivé et audité.` : 'Aucun mandat d’assistance déléguée actif dans la liste visible.'}</p></div>
          </div>
        </section>

        <section className="registry-administration-panel registry-administration-panel--continuity">
          <header><div><span className="registry-step">Continuité</span><h2>Sort du coffre</h2></div><FileLock2 aria-hidden="true" /></header>
          <div className="registry-administration-continuity">
            <div><CircleCheck aria-hidden="true" /><span><strong>La preuve n’est jamais supprimée pour un motif commercial</strong><small>Un défaut de paiement peut dégrader l’accès, pas effacer l’historique.</small></span></div>
            <div><CircleCheck aria-hidden="true" /><span><strong>L’export du propriétaire reste disponible</strong><small>Il ne peut être conditionné au règlement d’un impayé.</small></span></div>
            <div><CircleCheck aria-hidden="true" /><span><strong>Les accès partagés restent révocables</strong><small>Y compris lorsque le compte passe en lecture seule.</small></span></div>
          </div>
          <div className="registry-administration-commercial"><CircleDollarSign aria-hidden="true" /><div><strong>Abonnement et facturation</strong><p>{canReadBilling ? 'Aucune projection commerciale versionnée n’est encore disponible pour ce compte. Aucun plan, quota ou montant n’est donc inventé.' : 'Votre attribution ne porte pas le droit de lecture de la facturation.'}</p></div></div>
        </section>
      </div>

    </section>
  );
}
