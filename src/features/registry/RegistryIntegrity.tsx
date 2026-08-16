import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Blocks,
  CheckCircle2,
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
    anchoredCount: entries.filter((entry) => entry.publicAnchoringStatus !== 'deferred').length,
  }), [entries]);

  if (!canReadCartularies) {
    return (
      <section className="registry-integrity registry-integrity--denied">
        <LockKeyhole aria-hidden="true" />
        <p className="registry-kicker">Intégrité privée</p>
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
          <p className="registry-kicker">Confiance blockchain-ready</p>
          <h1 id="registry-integrity-title">Intégrité & historique</h1>
          <p>La chaîne d’événements de chaque Cartulaire est recalculée ici. Le Registre restitue son état, sans devenir l’autorité du journal.</p>
        </div>
        <button type="button" className="registry-integrity__refresh" onClick={() => void reload()} disabled={loadState === 'loading'}><RefreshCw className={loadState === 'loading' ? 'registry-spinner' : undefined} aria-hidden="true" />Actualiser</button>
      </header>

      <section className="registry-integrity-pipeline" aria-label="Approche d’intégrité Cartularia">
        <article className="is-current"><Link2 aria-hidden="true" /><span>01</span><h2>Journal chaîné</h2><p>Chaque événement référence l’empreinte SHA‑256 précédente.</p></article>
        <article><Blocks aria-hidden="true" /><span>02</span><h2>Lot Merkle</h2><p>Les têtes de Cartulaires peuvent être regroupées sans exposer leur contenu.</p></article>
        <article><Stamp aria-hidden="true" /><span>03</span><h2>Horodatage</h2><p>Un reçu RFC 3161 peut dater la racine du lot.</p></article>
        <article className="is-deferred"><Fingerprint aria-hidden="true" /><span>04</span><h2>Ancrage public</h2><p>Blockchain publique différée : aucune chaîne n’est activée dans le pilote.</p></article>
      </section>

      {loadState === 'ready' && (
        <section className="registry-integrity-facts" aria-label="Indicateurs d’intégrité">
          <article><span>Cartulaires suivis</span><strong>{facts.cartularyCount}</strong><small>Lecture autorisée</small></article>
          <article><span>Chaînes vérifiées</span><strong>{facts.verifiedCount} / {facts.cartularyCount}</strong><small>Recalcul cryptographique</small></article>
          <article><span>Événements</span><strong>{facts.eventCount}</strong><small>Journaux des Cartulaires</small></article>
          <article><span>Ancrages publics</span><strong>{facts.anchoredCount}</strong><small>Activation différée</small></article>
        </section>
      )}

      {loadState === 'loading' && <div className="registry-integrity-state" role="status"><LoaderCircle className="registry-spinner" aria-hidden="true" /><h2>Vérification des journaux</h2><p>Recalcul des empreintes et contrôle des séquences…</p></div>}
      {loadState === 'error' && <div className="registry-integrity-state registry-integrity-state--error" role="alert"><AlertTriangle aria-hidden="true" /><h2>Journaux indisponibles</h2><p>Les événements autorisés n’ont pas pu être chargés ou vérifiés.</p><button type="button" onClick={() => void reload()}>Réessayer</button></div>}
      {loadState === 'ready' && entries.length === 0 && <div className="registry-integrity-state"><FileClock aria-hidden="true" /><h2>Aucun Cartulaire à vérifier</h2><p>La restitution apparaîtra lorsqu’un Cartulaire actif sera projeté dans le Registre.</p></div>}

      {loadState === 'ready' && entries.length > 0 && (
        <div className="registry-integrity-list">
          {entries.map((entry) => (
            <article className={`registry-integrity-card${entry.verification.valid ? ' is-valid' : ' is-invalid'}`} key={entry.item.cartularyId}>
              <header>
                <div className="registry-integrity-card__identity"><Fingerprint aria-hidden="true" /><div><span>{entry.item.makerName}</span><h2>{entry.item.displayTitle}</h2><p>{entry.item.referenceCode || entry.item.modelName}</p></div></div>
                <div className="registry-integrity-card__status">{entry.verification.valid ? <CheckCircle2 aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}<span><strong>{entry.verification.valid ? 'Chaîne vérifiée' : 'Alerte d’intégrité'}</strong><small>{entry.verification.valid ? 'Empreintes, ordre et tête cohérents' : `${entry.verification.errors.length} anomalie(s) détectée(s)`}</small></span></div>
              </header>

              <dl className="registry-integrity-card__facts">
                <div><dt>Révision scellée</dt><dd>R{entry.sourceRevision}</dd></div>
                <div><dt>Événements</dt><dd>{entry.integritySequence}</dd></div>
                <div><dt>Tête d’intégrité</dt><dd title={entry.integrityHead}>{shortDigest(entry.integrityHead)}</dd></div>
                <div><dt>Ancrage blockchain</dt><dd>Différé</dd></div>
              </dl>

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

              <footer><span><ShieldCheck aria-hidden="true" />Source : journal du Cartulaire</span><a href={buildCartularyHref(entry.item.cartularyId, window.location.pathname)}>Ouvrir le Cartulaire <ExternalLink aria-hidden="true" /></a></footer>
            </article>
          ))}
        </div>
      )}

      <aside className="registry-integrity-boundary"><ShieldCheck aria-hidden="true" /><div><h2>Ce que cette preuve établit</h2><p>Elle rend détectable une modification du journal et atteste qu’un état empreinté existait. Elle ne prouve pas, à elle seule, l’authenticité de l’objet, la vérité d’une déclaration, l’identité d’une personne ou la propriété légale.</p></div><span>Blockchain-ready</span></aside>
    </section>
  );
}
