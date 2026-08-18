import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Boxes,
  CircleCheck,
  Clock3,
  Layers3,
  LibraryBig,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Plus,
} from 'lucide-react';
import type {
  MembershipDocument,
  OrganizationDocument,
  RegistryDocument,
} from '../../domain/foundations.ts';
import type { RegistryFollowUpItem } from '../../domain/followUp.ts';
import type { RegistryItemProjection } from '../../domain/projections.ts';
import { loadRegistryFollowUpsFromItems } from '../../services/followUp.ts';
import { loadRegistryItems, observeRegistryItems } from '../../services/projections.ts';
import { buildRegistryAggregates } from './registryAggregates.ts';
import { ROLE_LABELS } from './registryAdministration.ts';
import { buildRegistryFollowUpSummary } from './registryFollowUp.ts';
import {
  assetTypeLabel,
  completenessLabel,
  labelFromIdentifier,
  lifecycleLabel,
} from './registryPresentation.ts';

type OverviewLoadState = 'loading' | 'ready' | 'error';

const registrySectionHref = (registryId: string, section: 'items' | 'new' | 'follow-up') =>
  `/registry/${encodeURIComponent(registryId)}/${section}`;

function AggregateRows({ rows, total, label }: {
  rows: Array<{ key: string; count: number }>;
  total: number;
  label: (key: string) => string;
}) {
  return (
    <div className="registry-aggregate-rows">
      {rows.map((row) => (
        <div className="registry-aggregate-row" key={row.key}>
          <div><span>{label(row.key)}</span><strong>{row.count}</strong></div>
          <div className="registry-aggregate-bar" aria-hidden="true">
            <span style={{ width: `${total > 0 ? Math.max(5, (row.count / total) * 100) : 0}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function RegistryOverview({ registry, organization, membership }: {
  registry: RegistryDocument;
  organization: OrganizationDocument;
  membership: MembershipDocument;
}) {
  const [items, setItems] = useState<RegistryItemProjection[]>([]);
  const [followUps, setFollowUps] = useState<RegistryFollowUpItem[]>([]);
  const [loadState, setLoadState] = useState<OverviewLoadState>('loading');
  const roles = membership.roles.map((role) => ROLE_LABELS[role] || role);
  const canReadCartularies = membership.permissions.includes('cartulary.read');
  const canCreateCartularies = membership.permissions.includes('cartulary.edit');

  const reload = useCallback(async () => {
    setLoadState('loading');
    try {
      const nextItems = await loadRegistryItems(registry.id);
      setItems(nextItems);
      if (canReadCartularies) {
        try {
          setFollowUps(await loadRegistryFollowUpsFromItems(nextItems));
        } catch {
          setFollowUps([]);
        }
      } else {
        setFollowUps([]);
      }
      setLoadState('ready');
    } catch {
      setItems([]);
      setLoadState('error');
    }
  }, [canReadCartularies, registry.id]);

  useEffect(() => {
    let active = true;
    setLoadState('loading');
    const unsubscribe = observeRegistryItems(registry.id, (nextItems) => {
      if (!active) return;
      setItems(nextItems);
      if (canReadCartularies) {
        void loadRegistryFollowUpsFromItems(nextItems)
          .then((nextFollowUps) => {
            if (active) setFollowUps(nextFollowUps);
          })
          .catch(() => {
            if (active) setFollowUps([]);
          });
      } else {
        setFollowUps([]);
      }
      setLoadState('ready');
    }, () => {
      if (!active) return;
      setItems([]);
      setFollowUps([]);
      setLoadState('error');
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [canReadCartularies, registry.id]);

  const summary = useMemo(() => buildRegistryAggregates(items), [items]);
  const followUpSummary = useMemo(() => buildRegistryFollowUpSummary(followUps), [followUps]);
  const visibleTotal = loadState === 'ready' ? summary.total : registry.itemCount;

  return (
    <>
      <section className="registry-page-heading registry-dashboard-heading">
        <div>
          <p className="registry-kicker">Tableau de bord</p>
          <h1>{registry.name}</h1>
          <p>{registry.description || 'État transverse des Cartulaires autorisés.'}</p>
        </div>
        <div className="registry-dashboard-heading__actions">
          <span className={`registry-status registry-status--${registry.status}`}>
            {registry.status === 'active' ? 'Actif' : 'Archivé'}
          </span>
          {canCreateCartularies && <a href={registrySectionHref(registry.id, 'new')}><Plus aria-hidden="true" /> Nouveau cartulaire</a>}
          <a href={registrySectionHref(registry.id, 'items')}>Voir le catalogue <ArrowRight aria-hidden="true" /></a>
        </div>
      </section>

      <section className="registry-facts registry-facts--dashboard" aria-label="Indicateurs du Registre">
        <article>
          <span>Cartulaires</span>
          <strong>{visibleTotal}</strong>
          <small>Projections privées autorisées</small>
        </article>
        <article>
          <span>Collections</span>
          <strong>{loadState === 'ready' ? summary.collectionCount : '—'}</strong>
          <small>{organization.name}</small>
        </article>
        <article>
          <span>Types d’actifs</span>
          <strong>{loadState === 'ready' ? summary.assetTypeCount : '—'}</strong>
          <small>Noyau multi-actifs commun</small>
        </article>
        <article className={summary.needsReviewCount > 0 ? 'registry-fact--attention' : undefined}>
          <span>À revoir</span>
          <strong>{loadState === 'ready' ? summary.needsReviewCount : '—'}</strong>
          <small>{loadState === 'ready' && summary.needsReviewCount === 0 ? 'Aucun signal de revue' : 'Statut ou import à vérifier'}</small>
        </article>
      </section>

      {loadState === 'loading' && (
        <section className="registry-dashboard-loading" role="status">
          <LoaderCircle className="registry-spinner" aria-hidden="true" />
          <span>Calcul des agrégats autorisés…</span>
        </section>
      )}

      {loadState === 'error' && (
        <section className="registry-dashboard-error" role="alert">
          <AlertTriangle aria-hidden="true" />
          <div><h2>Synthèse indisponible</h2><p>Le contexte reste accessible, mais ses agrégats n’ont pas pu être chargés.</p></div>
          <button type="button" onClick={() => void reload()}><RefreshCw aria-hidden="true" /> Réessayer</button>
        </section>
      )}

      {loadState === 'ready' && summary.total === 0 && (
        <section className="registry-dashboard-empty">
          <LibraryBig aria-hidden="true" />
          <div><h2>Ce Registre ne contient encore aucun Cartulaire</h2><p>Les indicateurs apparaîtront dès qu’une projection privée sera créée.</p></div>
          <a href={registrySectionHref(registry.id, 'items')}>Ouvrir le catalogue</a>
        </section>
      )}

      {loadState === 'ready' && summary.total > 0 && (
        <div className="registry-dashboard-grid">
          <section className="registry-dashboard-panel registry-dashboard-panel--composition">
            <header><div><span className="registry-step">R3</span><h2>Composition du Registre</h2></div><Boxes aria-hidden="true" /></header>
            <AggregateRows rows={summary.byAssetType} total={summary.total} label={assetTypeLabel} />
          </section>

          <section className="registry-dashboard-panel">
            <header><div><span className="registry-step">Collections</span><h2>Répartition</h2></div><Layers3 aria-hidden="true" /></header>
            <AggregateRows rows={summary.byCollection} total={summary.total} label={labelFromIdentifier} />
          </section>

          <section className="registry-dashboard-panel">
            <header><div><span className="registry-step">État</span><h2>Cycle de vie</h2></div><CircleCheck aria-hidden="true" /></header>
            <div className="registry-status-counts">
              {summary.byLifecycle.map((row) => <div key={row.key}><span>{lifecycleLabel(row.key)}</span><strong>{row.count}</strong></div>)}
            </div>
          </section>

          <section className="registry-dashboard-panel">
            <header><div><span className="registry-step">Paliers</span><h2>Complétude documentaire</h2></div><BookOpen aria-hidden="true" /></header>
            <div className="registry-completeness-levels">
              {summary.byCompleteness.map((row) => (
                <div key={row.key}><strong>{row.count}</strong><span>{completenessLabel(row.key)}</span></div>
              ))}
            </div>
            <p className="registry-dashboard-note">La complétude est présentée par paliers explicites, sans score artificiel.</p>
          </section>

          <section className="registry-dashboard-panel registry-dashboard-panel--attention">
            <header><div><span className="registry-step">Vigilance</span><h2>Points d’attention</h2></div><AlertTriangle aria-hidden="true" /></header>
            {summary.attention.total + followUpSummary.overdue + followUpSummary.dueSoon === 0 ? (
              <div className="registry-attention-clear"><CircleCheck aria-hidden="true" /><span>Aucun point d’attention dérivé des projections.</span></div>
            ) : (
              <div className="registry-attention-list">
                {summary.attention.review > 0 && <div><span>Dossiers ou imports à revoir</span><strong>{summary.attention.review}</strong></div>}
                {summary.attention.suspended > 0 && <div><span>Dossiers suspendus</span><strong>{summary.attention.suspended}</strong></div>}
                {summary.attention.sensitivePossession > 0 && <div><span>Situation de possession sensible</span><strong>{summary.attention.sensitivePossession}</strong></div>}
                {followUpSummary.overdue > 0 && <div><span>Échéances en retard</span><strong>{followUpSummary.overdue}</strong></div>}
                {followUpSummary.dueSoon > 0 && <div><span>Échéances dans les 30 jours</span><strong>{followUpSummary.dueSoon}</strong></div>}
              </div>
            )}
            <a href={registrySectionHref(registry.id, 'follow-up')}>Ouvrir le centre de suivi <ArrowRight aria-hidden="true" /></a>
          </section>

          <section className="registry-dashboard-panel registry-dashboard-panel--recent">
            <header><div><span className="registry-step">Activité</span><h2>Mises à jour récentes</h2></div><Clock3 aria-hidden="true" /></header>
            <div className="registry-recent-items">
              {summary.recentItems.map((item) => (
                <a href={`${registrySectionHref(registry.id, 'items')}?q=${encodeURIComponent(item.displayTitle)}`} key={item.cartularyId}>
                  <span><strong>{item.displayTitle}</strong><small>{assetTypeLabel(item.assetType)} · {labelFromIdentifier(item.collectionId)}</small></span>
                  <span>R{item.sourceRevision}</span>
                </a>
              ))}
            </div>
          </section>
        </div>
      )}

      <section className="registry-dashboard-boundary">
        <LockKeyhole aria-hidden="true" />
        <div><h2>Frontière du tableau de bord</h2><p>Aucune valeur patrimoniale, preuve, archive ou donnée média n’est agrégée sans projection explicite du Cartulaire.</p></div>
        <span><ShieldCheck aria-hidden="true" /> Secret par défaut</span>
      </section>

      <section className="registry-dashboard-account">
        <div><span>Contexte</span><strong>{organization.name}</strong></div>
        <div><span>Vos qualités</span><strong>{roles.join(' · ') || 'Membre'}</strong></div>
      </section>
    </>
  );
}
