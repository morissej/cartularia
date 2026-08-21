import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Ban,
  ChevronRight,
  Clock3,
  ExternalLink,
  Eye,
  KeyRound,
  Link2,
  LoaderCircle,
  Mail,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import type { RegistryAccessKind, RegistryAccessProjection } from '../../domain/access.ts';
import type { RegistryDocument } from '../../domain/foundations.ts';
import { createRegistryAccess, loadRegistryAccesses, revokeRegistryAccess } from '../../services/access.ts';
import type { RegistryItemProjection } from '../../domain/projections.ts';
import { loadRegistryItems } from '../../services/projections.ts';
import {
  accessDate,
  buildRegistryAccessSummary,
  deriveRegistryAccessStatus,
  filterAndSortRegistryAccesses,
  maskRecipientReference,
  type RegistryAccessConsultationFilter,
  type RegistryAccessStatus,
} from './registryAccess.ts';
import { buildCartularyHref } from './registryCatalog.ts';
import { RegistryFilterPanel } from './RegistryFilterPanel.tsx';

type AccessLoadState = 'loading' | 'ready' | 'error';

const STATUS_LABELS: Record<RegistryAccessStatus, string> = {
  active: 'Actif',
  pending: 'En attente',
  expired: 'Expiré',
  revoked: 'Révoqué',
};

const KIND_LABELS: Record<RegistryAccessKind, string> = {
  invitation: 'Invitation nominative',
  mandate: 'Mandat temporaire',
  shared_link: 'Lien contrôlé',
};

const AccessKindIcon = ({ kind }: { kind: RegistryAccessKind }) => {
  if (kind === 'invitation') return <Mail aria-hidden="true" />;
  if (kind === 'mandate') return <ShieldCheck aria-hidden="true" />;
  return <Link2 aria-hidden="true" />;
};

const readInitialParameter = (name: string, fallback: string) => (
  new URLSearchParams(window.location.search).get(name) || fallback
);

const formatDate = (value: RegistryAccessProjection['expiresAt']) => {
  const date = accessDate(value);
  if (!date) return 'Sans échéance projetée';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
};

const formatConsultation = (access: RegistryAccessProjection) => {
  const date = accessDate(access.lastConsultedAt);
  if (!date || access.consultationCount <= 0) return 'Jamais consulté';
  return `Dernière le ${new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)}`;
};

export function RegistryAccessCenter({ registry, canReadAccesses, canManageAccesses = false }: {
  registry: RegistryDocument;
  canReadAccesses: boolean;
  canManageAccesses?: boolean;
}) {
  const [accesses, setAccesses] = useState<RegistryAccessProjection[]>([]);
  const [loadState, setLoadState] = useState<AccessLoadState>('loading');
  const [registryItems, setRegistryItems] = useState<RegistryItemProjection[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [scopeType, setScopeType] = useState<'registry' | 'collection' | 'cartulary'>('cartulary');
  const [scopeId, setScopeId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [creating, setCreating] = useState(false);
  const [creationNotice, setCreationNotice] = useState('');
  const [emulatorInvitationLink, setEmulatorInvitationLink] = useState('');
  const [query, setQuery] = useState(() => readInitialParameter('q', ''));
  const [status, setStatus] = useState<'all' | RegistryAccessStatus>(() => {
    const candidate = readInitialParameter('status', 'all');
    return Object.hasOwn(STATUS_LABELS, candidate) ? candidate as RegistryAccessStatus : 'all';
  });
  const [accessKind, setAccessKind] = useState<'all' | RegistryAccessKind>(() => {
    const candidate = readInitialParameter('type', 'all');
    return Object.hasOwn(KIND_LABELS, candidate) ? candidate as RegistryAccessKind : 'all';
  });
  const [consultation, setConsultation] = useState<RegistryAccessConsultationFilter>(() => {
    const candidate = readInitialParameter('consultation', 'all');
    return ['consulted', 'never'].includes(candidate) ? candidate as RegistryAccessConsultationFilter : 'all';
  });

  const reload = useCallback(async () => {
    if (!canReadAccesses) {
      setAccesses([]);
      setLoadState('ready');
      return;
    }
    setLoadState('loading');
    try {
      const [loadedAccesses, loadedItems] = await Promise.all([loadRegistryAccesses(registry.id), loadRegistryItems(registry.id)]);
      setAccesses(loadedAccesses);
      setRegistryItems(loadedItems.filter((item) => item.projectionStatus === 'active'));
      setLoadState('ready');
    } catch {
      setAccesses([]);
      setLoadState('error');
    }
  }, [canReadAccesses, registry.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const now = useMemo(() => new Date(), []);
  const summary = useMemo(() => buildRegistryAccessSummary(accesses, now), [accesses, now]);
  const filteredAccesses = useMemo(() => filterAndSortRegistryAccesses(accesses, {
    query,
    status,
    accessKind,
    consultation,
  }, now), [accessKind, accesses, consultation, now, query, status]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (status !== 'all') params.set('status', status);
    if (accessKind !== 'all') params.set('type', accessKind);
    if (consultation !== 'all') params.set('consultation', consultation);
    return params.toString();
  }, [accessKind, consultation, query, status]);

  useEffect(() => {
    const nextUrl = `${window.location.pathname}${queryString ? `?${queryString}` : ''}`;
    window.history.replaceState(null, '', nextUrl);
  }, [queryString]);

  const activeFilterCount = [query.trim(), status !== 'all', accessKind !== 'all', consultation !== 'all']
    .filter(Boolean).length;
  const returnTo = `${window.location.pathname}${queryString ? `?${queryString}` : ''}`;
  const collections = useMemo(() => [...new Set(registryItems.map((item) => item.collectionId))].sort(), [registryItems]);
  const scopeOptions = useMemo(() => scopeType === 'registry'
    ? [{ id: registry.id, label: registry.name }]
    : scopeType === 'collection'
      ? collections.map((id) => ({ id, label: id.replace(/^col_/, '').replace(/[_-]+/g, ' ') }))
      : registryItems.map((item) => ({ id: item.cartularyId, label: item.displayTitle })), [collections, registry.id, registry.name, registryItems, scopeType]);

  useEffect(() => {
    if (!scopeOptions.some((option) => option.id === scopeId)) setScopeId(scopeOptions[0]?.id || '');
  }, [scopeId, scopeOptions]);

  const submitAccess = async (event: FormEvent) => {
    event.preventDefault();
    const target = scopeOptions.find((option) => option.id === scopeId);
    if (!recipient.trim() || !target) return;
    setCreating(true);
    setCreationNotice('');
    setEmulatorInvitationLink('');
    try {
      const result = await createRegistryAccess({
        registryId: registry.id,
        organizationId: registry.organizationId,
        input: {
          recipientLabel: recipient.trim(),
          recipientKind: 'person',
          accessKind: 'invitation',
          scopeType,
          scopeId,
          displayTitle: target.label,
          cartularyId: scopeType === 'cartulary' ? scopeId : null,
          collectionId: scopeType === 'collection' ? scopeId : null,
          expiresAt: expiresAt ? `${expiresAt}T23:59:59.000Z` : null,
          permissions: ['read'],
        },
      });
      setRecipient('');
      setExpiresAt('');
      setShowCreate(false);
      setCreationNotice("Invitation émise. Le lien personnel de connexion a été placé dans la file d’envoi et expirera automatiquement.");
      setEmulatorInvitationLink(result.emulatorSignInLink || '');
      await reload();
    } catch {
      setCreationNotice("L’invitation n’a pas pu être émise. Vérifiez le destinataire, la portée et la date d’expiration.");
    } finally {
      setCreating(false);
    }
  };

  const resetFilters = () => {
    setQuery('');
    setStatus('all');
    setAccessKind('all');
    setConsultation('all');
  };

  if (!canReadAccesses) {
    return (
      <section className="registry-access registry-access--denied" aria-labelledby="registry-access-title">
        <KeyRound aria-hidden="true" />
        <p className="registry-kicker">Centre des accès · R6</p>
        <h1 id="registry-access-title">Accès limité</h1>
        <p>Votre qualité permet d’ouvrir le Registre, mais pas la projection des invitations et consultations.</p>
        <a href={`/registry/${encodeURIComponent(registry.id)}`}>Revenir à la vue d’ensemble</a>
      </section>
    );
  }

  return (
    <section className="registry-access" aria-labelledby="registry-access-title">
      <header className="registry-page-heading registry-access__heading">
        <div>
          <p className="registry-kicker">Centre des accès · R6</p>
          <h1 id="registry-access-title">Invitations et consultations</h1>
          <p>Le pilotage des accès partagés, sans recopier les contenus, preuves, archives ou médias des Cartulaires.</p>
        </div>
        {canManageAccesses && <button type="button" className="registry-access__create" onClick={() => setShowCreate((current) => !current)}><Plus aria-hidden="true" />Nouvelle invitation</button>}
      </header>

      {showCreate && (
        <form className="registry-access-create" onSubmit={submitAccess}>
          <p className="registry-access-create__guidance"><strong>Aucun mot de passe à communiquer.</strong> Le destinataire reçoit un lien personnel de connexion sans mot de passe. Le lien expire et ne peut activer que la portée indiquée.</p>
          <label>Adresse du destinataire<input type="email" value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="nom@exemple.com" required /></label>
          <label>Portée<select value={scopeType} onChange={(event) => setScopeType(event.target.value as typeof scopeType)}><option value="cartulary">Un Cartulaire</option><option value="collection">Une Collection</option><option value="registry">Tout le Registre</option></select></label>
          <label>Élément<select value={scopeId} onChange={(event) => setScopeId(event.target.value)} required>{scopeOptions.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label>
          <label>Expiration<input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
          <button type="submit" disabled={creating || !recipient.trim() || !scopeId}>{creating ? 'Émission…' : "Envoyer l’invitation"}</button>
        </form>
      )}
      {creationNotice && <p className="registry-access-creation-notice" role="status">{creationNotice}</p>}
      {emulatorInvitationLink && <p className="registry-access-creation-notice" role="status"><a href={emulatorInvitationLink}>Ouvrir le lien dans l’émulateur local</a></p>}

      <div className="registry-access-facts" aria-label="Synthèse des accès">
        <button type="button" className={status === 'active' ? 'is-active' : undefined} onClick={() => setStatus('active')}><KeyRound aria-hidden="true" /><span>Actifs</span><strong>{summary.active}</strong></button>
        <button type="button" className={status === 'pending' ? 'is-active' : undefined} onClick={() => setStatus('pending')}><Clock3 aria-hidden="true" /><span>En attente</span><strong>{summary.pending}</strong></button>
        <button type="button" className={status === 'expired' ? 'is-active' : undefined} onClick={() => setStatus('expired')}><AlertTriangle aria-hidden="true" /><span>Expirés</span><strong>{summary.expired}</strong></button>
        <button type="button" className={status === 'revoked' ? 'is-active' : undefined} onClick={() => setStatus('revoked')}><Ban aria-hidden="true" /><span>Révoqués</span><strong>{summary.revoked}</strong></button>
      </div>

      <div className="registry-catalog-toolbar registry-access-toolbar">
        <label className="registry-search">
          <span className="sr-only">Rechercher un accès</span>
          <Search aria-hidden="true" />
          <input type="search" placeholder="Rechercher un Cartulaire ou un destinataire masqué…" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button type="button" className="registry-refresh" onClick={() => void reload()} disabled={loadState === 'loading'}>
          <RefreshCw className={loadState === 'loading' ? 'registry-spinner' : undefined} aria-hidden="true" />
          <span>Actualiser</span>
        </button>
      </div>

      <RegistryFilterPanel className="registry-access-filters" label="Filtres des accès" activeFilterCount={activeFilterCount}>
        <label><span>Statut</span><select value={status} onChange={(event) => setStatus(event.target.value as 'all' | RegistryAccessStatus)}><option value="all">Tous les statuts</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label><span>Nature</span><select value={accessKind} onChange={(event) => setAccessKind(event.target.value as 'all' | RegistryAccessKind)}><option value="all">Toutes les natures</option>{Object.entries(KIND_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label><span>Consultation</span><select value={consultation} onChange={(event) => setConsultation(event.target.value as RegistryAccessConsultationFilter)}><option value="all">Toutes</option><option value="consulted">Déjà consulté</option><option value="never">Jamais consulté</option></select></label>
        {activeFilterCount > 0 && <button type="button" className="registry-filter-reset" onClick={resetFilters}>Effacer</button>}
      </RegistryFilterPanel>

      <div className="registry-access-results">
        <p aria-live="polite"><strong>{filteredAccesses.length}</strong> accès{filteredAccesses.length !== summary.total && <span> sur {summary.total}</span>}</p>
        <span><Eye aria-hidden="true" />{summary.consultations} consultation{summary.consultations > 1 ? 's' : ''} sur {summary.consultedAccesses} accès</span>
      </div>

      {loadState === 'loading' && <div className="registry-access-state" role="status"><LoaderCircle className="registry-spinner" aria-hidden="true" /><h2>Chargement des accès</h2><p>Lecture des projections autorisées du Registre…</p></div>}
      {loadState === 'error' && <div className="registry-access-state registry-access-state--error" role="alert"><AlertTriangle aria-hidden="true" /><h2>Centre des accès indisponible</h2><p>Les invitations et consultations autorisées n’ont pas pu être chargées.</p><button type="button" onClick={() => void reload()}>Réessayer</button></div>}
      {loadState === 'ready' && filteredAccesses.length === 0 && <div className="registry-access-state"><KeyRound aria-hidden="true" /><h2>{accesses.length === 0 ? 'Aucun accès projeté' : 'Aucun résultat'}</h2><p>{accesses.length === 0 ? 'Les invitations émises par les Cartulaires apparaîtront ici lorsqu’une projection minimale autorisée sera disponible.' : 'Modifiez les filtres ou affichez tous les accès.'}</p>{accesses.length > 0 && <button type="button" onClick={resetFilters}>Afficher tous les accès</button>}</div>}

      {loadState === 'ready' && filteredAccesses.length > 0 && (
        <div className="registry-access-list">
          {filteredAccesses.map((access) => {
            const effectiveStatus = deriveRegistryAccessStatus(access, now);
            const expiresAt = accessDate(access.expiresAt);
            return (
              <article className={`registry-access-item registry-access-item--${effectiveStatus}`} key={access.id}>
                <div className="registry-access-item__kind"><AccessKindIcon kind={access.accessKind} /><span>{KIND_LABELS[access.accessKind]}</span><small className={`is-${effectiveStatus}`}>{STATUS_LABELS[effectiveStatus]}</small></div>
                <div className="registry-access-item__body"><h2>{access.displayTitle}</h2><p>{maskRecipientReference(access.recipientLabel)}</p><small>{access.scopeType === 'registry' ? 'Registre' : access.scopeType === 'collection' ? 'Collection' : 'Cartulaire'} · Révision {access.sourceRevision}</small></div>
                <div className="registry-access-item__expiry"><Clock3 aria-hidden="true" /><span>{effectiveStatus === 'revoked' ? 'Accès révoqué' : 'Échéance'}</span><time dateTime={expiresAt?.toISOString()}>{effectiveStatus === 'revoked' ? formatDate(access.revokedAt) : formatDate(access.expiresAt)}</time></div>
                <div className="registry-access-item__consultation"><Eye aria-hidden="true" /><strong>{Math.max(0, access.consultationCount || 0)}</strong><span>consultation{access.consultationCount > 1 ? 's' : ''}</span><small>{formatConsultation(access)}</small></div>
                {access.cartularyId ? <a href={buildCartularyHref(access.cartularyId, returnTo)}>Gérer dans le Cartulaire <ExternalLink aria-hidden="true" /><ChevronRight aria-hidden="true" /></a> : <span className="registry-access-item__scope">{access.scopeType === 'collection' ? 'Accès Collection' : 'Accès Registre'}</span>}
                {effectiveStatus !== 'revoked' && <button type="button" className="registry-access-item__revoke" onClick={() => void revokeRegistryAccess(registry.id, access.id).then(reload)}><Ban aria-hidden="true" />Révoquer</button>}
              </article>
            );
          })}
        </div>
      )}

    </section>
  );
}
