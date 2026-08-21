import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  Blocks,
  CheckCircle2,
  ChevronDown,
  Clock3,
  ExternalLink,
  FileClock,
  Fingerprint,
  Link2,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Stamp,
} from 'lucide-react';
import type { RegistryIntegrityEntry } from '../../domain/integrity.ts';
import type { RegistryDocument } from '../../domain/foundations.ts';
import { loadRegistryIntegrity, observeRegistryIntegrity } from '../../services/registryIntegrity.ts';
import { buildCartularyHref } from './registryCatalog.ts';
import { auditActionLabel, shortDigest } from './registryIntegrity.ts';

type IntegrityLoadState = 'loading' | 'ready' | 'error';

const formatDateTime = (value: string) => value
  ? new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value))
  : 'Date indisponible';

const actorLabel = (entry: RegistryIntegrityEntry['events'][number]) => {
  const role = String(entry.actor.role || '');
  if (role === 'legal_owner') return 'Propriétaire légal';
  if (role === 'administrator') return 'Administrateur';
  return 'Acteur autorisé';
};

const anchoringLabel = (entry: RegistryIntegrityEntry) => {
  if (entry.publicAnchoringStatus === 'anchored') {
    return entry.publicAnchorBlockHeight === null
      ? 'Confirmé sur Bitcoin'
      : `Confirmé · bloc ${entry.publicAnchorBlockHeight}`;
  }
  if (entry.publicAnchoringStatus === 'pending_confirmation' || entry.publicAnchoringStatus === 'processing') {
    return 'En attente de confirmation Bitcoin';
  }
  if (entry.publicAnchoringStatus === 'failed') return 'Échec temporaire — nouvel essai quotidien';
  return 'Pas encore demandé';
};

export function RegistryIntegrity({ registry, canReadCartularies }: {
  registry: RegistryDocument;
  canReadCartularies: boolean;
}) {
  const [entries, setEntries] = useState<RegistryIntegrityEntry[]>([]);
  const [loadState, setLoadState] = useState<IntegrityLoadState>('loading');

  const reload = useCallback(async () => {
    if (!canReadCartularies) return;
    setLoadState('loading');
    try {
      setEntries(await loadRegistryIntegrity(registry.id));
      setLoadState('ready');
    } catch {
      setEntries([]);
      setLoadState('error');
    }
  }, [canReadCartularies, registry.id]);

  useEffect(() => {
    if (!canReadCartularies) return undefined;
    setLoadState('loading');
    return observeRegistryIntegrity(registry.id, (nextEntries) => {
      setEntries(nextEntries);
      setLoadState('ready');
    }, () => {
      setEntries([]);
      setLoadState('error');
    });
  }, [canReadCartularies, registry.id]);

  const facts = useMemo(() => ({
    cartularyCount: entries.length,
    verifiedCount: entries.filter((entry) => entry.verification.valid).length,
    eventCount: entries.reduce((total, entry) => total + entry.events.length, 0),
    anchoredCount: entries.filter((entry) => entry.publicAnchoringStatus === 'anchored').length,
    pendingCount: entries.filter((entry) => (
      entry.publicAnchoringStatus === 'pending_confirmation' || entry.publicAnchoringStatus === 'processing'
    )).length,
  }), [entries]);

  const anchorOverview = useMemo(() => {
    if (facts.pendingCount > 0) return {
      className: 'is-pending',
      text: `${facts.pendingCount} preuve(s) soumise(s), en attente de confirmation Bitcoin.`,
    };
    if (entries.some((entry) => entry.publicAnchoringStatus === 'failed')) return {
      className: 'is-failed',
      text: 'Un ancrage a échoué temporairement et sera retenté au prochain cycle quotidien.',
    };
    if (facts.anchoredCount > 0) return {
      className: 'is-anchored',
      text: `${facts.anchoredCount} preuve(s) OpenTimestamps confirmée(s) sur Bitcoin.`,
    };
    return { className: 'is-idle', text: 'Aucun ancrage public confirmé pour les Cartulaires affichés.' };
  }, [entries, facts.anchoredCount, facts.pendingCount]);

  if (!canReadCartularies) {
    return (
      <section className="registry-integrity registry-integrity--denied">
        <LockKeyhole aria-hidden="true" />
        <p className="registry-kicker">Preuve serveur privée</p>
        <h1>Accès au journal non attribué</h1>
        <p>Cette vue restitue le journal de chaque Cartulaire. Votre rôle ne possède pas le droit de lecture nécessaire.</p>
        <a href={`/registry/${encodeURIComponent(registry.id)}/overview`}>Retour à la vue d’ensemble</a>
      </section>
    );
  }

  return (
    <section className="registry-integrity" aria-labelledby="registry-integrity-title">
      <header className="registry-page-heading registry-integrity__heading">
        <div>
          <p className="registry-kicker">Preuve serveur portable</p>
          <h1 id="registry-integrity-title">Chaîne serveur & preuves</h1>
          <p>La chaîne transactionnelle de chaque Cartulaire est recalculée ici. Le Cartulaire serveur reste l’unique autorité ; le Registre n’en présente qu’une lecture vérifiée.</p>
        </div>
        <button type="button" className="registry-integrity__refresh" onClick={() => void reload()} disabled={loadState === 'loading'}><RefreshCw className={loadState === 'loading' ? 'registry-spinner' : undefined} aria-hidden="true" />Actualiser</button>
      </header>

      <section className="registry-integrity-pipeline" aria-label="Preuve serveur Cartularia">
        <article className="is-current"><Link2 aria-hidden="true" /><span>01</span><h2>Chaîne serveur</h2><p>Chaque événement transactionnel référence l’empreinte SHA‑256 précédente.</p></article>
        <article><Blocks aria-hidden="true" /><span>02</span><h2>Lot Merkle</h2><p>Les têtes de Cartulaires peuvent être regroupées sans exposer leur contenu.</p></article>
        <article><Stamp aria-hidden="true" /><span>03</span><h2>Horodatage</h2><p>Un reçu RFC 3161 peut dater la racine du lot.</p></article>
        <article className={anchorOverview.className}><Fingerprint aria-hidden="true" /><span>04</span><h2>Ancrage public</h2><p>{anchorOverview.text}</p></article>
      </section>

      {loadState === 'ready' && (
        <section className="registry-integrity-facts" aria-label="Indicateurs de preuve serveur">
          <article><span>Cartulaires suivis</span><strong>{facts.cartularyCount}</strong><small>Lecture autorisée</small></article>
          <article><span>Chaînes vérifiées</span><strong>{facts.verifiedCount} / {facts.cartularyCount}</strong><small>Recalcul cryptographique</small></article>
          <article><span>Événements</span><strong>{facts.eventCount}</strong><small>Journaux des Cartulaires</small></article>
          <article><span>Ancrages publics</span><strong>{facts.anchoredCount}</strong><small>{facts.pendingCount > 0 ? `${facts.pendingCount} en attente` : 'Confirmés sur Bitcoin'}</small></article>
        </section>
      )}

      {loadState === 'loading' && <div className="registry-integrity-state" role="status"><LoaderCircle className="registry-spinner" aria-hidden="true" /><h2>Vérification des journaux</h2><p>Recalcul des empreintes et contrôle des séquences…</p></div>}
      {loadState === 'error' && <div className="registry-integrity-state registry-integrity-state--error" role="alert"><AlertTriangle aria-hidden="true" /><h2>Journaux indisponibles</h2><p>Les événements autorisés n’ont pas pu être chargés ou vérifiés.</p><button type="button" onClick={() => void reload()}>Réessayer</button></div>}
      {loadState === 'ready' && entries.length === 0 && <div className="registry-integrity-state"><FileClock aria-hidden="true" /><h2>Aucun Cartulaire à vérifier</h2><p>La restitution apparaîtra lorsqu’un Cartulaire actif sera projeté dans le Registre.</p></div>}

      {loadState === 'ready' && entries.length > 0 && (
        <div className="registry-integrity-list">
          {entries.map((entry) => (
            <details className={`registry-integrity-card${entry.verification.valid ? ' is-valid' : ' is-invalid'}`} key={entry.item.cartularyId}>
              <summary>
                <div className="registry-integrity-card__identity"><Fingerprint aria-hidden="true" /><div><span>{entry.item.makerName}</span><h2>{entry.item.displayTitle}</h2><p>{entry.item.referenceCode || entry.item.modelName}{entry.ownershipTransferCount > 0 ? ` · ${entry.ownershipTransferCount} changement${entry.ownershipTransferCount > 1 ? 's' : ''} de propriétaire vérifié${entry.ownershipTransferCount > 1 ? 's' : ''}` : ''}</p></div></div>
                <div className="registry-integrity-card__status">{entry.verification.valid ? <CheckCircle2 aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}<span><strong>{entry.verification.valid ? 'Chaîne serveur vérifiée' : 'Rupture de la chaîne serveur'}</strong><small>{entry.verification.valid ? 'Empreintes, ordre et tête cohérents' : `${entry.verification.errors.length} anomalie(s) détectée(s)`}</small></span></div>
                <ChevronDown className="registry-integrity-card__chevron" aria-hidden="true" />
              </summary>

              <dl className="registry-integrity-card__facts">
                <div><dt>Révision scellée</dt><dd>R{entry.sourceRevision}</dd></div>
                <div><dt>Événements</dt><dd>{entry.integritySequence}</dd></div>
                <div><dt>Tête serveur</dt><dd title={entry.integrityHead}>{shortDigest(entry.integrityHead)}</dd></div>
                <div><dt>Ancrage public</dt><dd title={entry.publicAnchorConfirmedAtIso || undefined}>{anchoringLabel(entry)}</dd></div>
              </dl>

              {entry.inheritedHead && <p className="registry-integrity-card__handover"><ArrowRightLeft aria-hidden="true" />Chaîne héritée depuis la tête <code title={entry.inheritedHead}>{shortDigest(entry.inheritedHead)}</code>, sans réécriture des événements antérieurs.</p>}

              <section className="registry-integrity-timeline" aria-label={`Journal d’activité de ${entry.item.displayTitle}`}>
                <header><Clock3 aria-hidden="true" /><h3>Journal d’activité</h3><span>{entry.events.length} événement{entry.events.length > 1 ? 's' : ''}</span></header>
                <ol>
                  {[...entry.events].reverse().map((event) => (
                    <li key={event.eventId}>
                      <span className="registry-integrity-timeline__marker">{event.sequence}</span>
                      <div><strong>{auditActionLabel(event.action)}</strong><span>{actorLabel(event)} · <time dateTime={event.occurredAtIso}>{formatDateTime(event.occurredAtIso)}</time></span><small title={event.hash}>{shortDigest(event.hash, 10)}</small></div>
                    </li>
                  ))}
                </ol>
              </section>

              <footer><span><ShieldCheck aria-hidden="true" />Source : chaîne serveur autoritaire du Cartulaire</span><a href={buildCartularyHref(entry.item.cartularyId, window.location.pathname, entry.item.assetType)}>Ouvrir le Cartulaire <ExternalLink aria-hidden="true" /></a></footer>
            </details>
          ))}
        </div>
      )}

      <aside className="registry-integrity-boundary"><ShieldCheck aria-hidden="true" /><div><h2>Ce que cette preuve établit</h2><p>Une preuve OpenTimestamps confirmée permet à un tiers de démontrer, avec l’export portable et la chaîne Bitcoin publique, que l’état empreinté existait au plus tard à la date du bloc. Elle rend aussi détectable une modification du journal. Elle ne prouve pas, à elle seule, l’authenticité de l’objet, la vérité d’une déclaration, l’identité d’une personne ou la propriété légale.</p></div><span>Preuve portable</span></aside>
    </section>
  );
}
