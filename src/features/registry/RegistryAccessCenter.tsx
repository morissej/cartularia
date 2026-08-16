import { useCallback, useEffect, useMemo, useState } from 'react';
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
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import type { RegistryAccessKind, RegistryAccessProjection } from '../../domain/access.ts';
import type { RegistryDocument } from '../../domain/foundations.ts';
import { loadRegistryAccesses } from '../../services/access.ts';
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

export function RegistryAccessCenter({ registry, canReadAccesses }: {
  registry: RegistryDocument;
  canReadAccesses: boolean;
}) {
  const [accesses, setAccesses] = useState<RegistryAccessProjection[]>([]);
  const [loadState, setLoadState] = useState<AccessLoadState>('loading');
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
      setAccesses(await loadRegistryAccesses(registry.id));
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
        <div className="registry-access__security"><ShieldCheck aria-hidden="true" /><span>Métadonnées minimales</span></div>
      </header>

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

      <div className="registry-access-filters" aria-label="Filtres du centre des accès">
        <div className="registry-filter-title"><SlidersHorizontal aria-hidden="true" /><span>Filtrer</span>{activeFilterCount > 0 && <strong>{activeFilterCount}</strong>}</div>
        <label><span>Statut</span><select value={status} onChange={(event) => setStatus(event.target.value as 'all' | RegistryAccessStatus)}><option value="all">Tous les statuts</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label><span>Nature</span><select value={accessKind} onChange={(event) => setAccessKind(event.target.value as 'all' | RegistryAccessKind)}><option value="all">Toutes les natures</option>{Object.entries(KIND_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label><span>Consultation</span><select value={consultation} onChange={(event) => setConsultation(event.target.value as RegistryAccessConsultationFilter)}><option value="all">Toutes</option><option value="consulted">Déjà consulté</option><option value="never">Jamais consulté</option></select></label>
        {activeFilterCount > 0 && <button type="button" className="registry-filter-reset" onClick={resetFilters}>Effacer</button>}
      </div>

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
                <div className="registry-access-item__body"><h2>{access.displayTitle}</h2><p>{maskRecipientReference(access.recipientLabel)}</p><small>Révision source {access.sourceRevision}</small></div>
                <div className="registry-access-item__expiry"><Clock3 aria-hidden="true" /><span>{effectiveStatus === 'revoked' ? 'Accès révoqué' : 'Échéance'}</span><time dateTime={expiresAt?.toISOString()}>{effectiveStatus === 'revoked' ? formatDate(access.revokedAt) : formatDate(access.expiresAt)}</time></div>
                <div className="registry-access-item__consultation"><Eye aria-hidden="true" /><strong>{Math.max(0, access.consultationCount || 0)}</strong><span>consultation{access.consultationCount > 1 ? 's' : ''}</span><small>{formatConsultation(access)}</small></div>
                <a href={buildCartularyHref(access.cartularyId, returnTo)}>Gérer dans le Cartulaire <ExternalLink aria-hidden="true" /><ChevronRight aria-hidden="true" /></a>
              </article>
            );
          })}
        </div>
      )}

      <aside className="registry-access-boundary"><ShieldCheck aria-hidden="true" /><div><h2>Le Cartulaire reste l’autorité</h2><p>Le Registre affiche uniquement le pilotage minimal. La portée du contenu, l’autorisation effective et la révocation sont décidées et auditées dans le Cartulaire source.</p></div><span>Aucun actif média repris</span></aside>
    </section>
  );
}
