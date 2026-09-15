import React, { useCallback, useState, useEffect } from 'react';
import { IntegrityJournal } from '../utils/integrityJournal';
import type {
  AnchorReceipt,
  IntegrityProofState,
  IntegrityVerificationResult,
} from '../utils/integrityJournal';
import { isRfc3161Receipt } from '../utils/integrityJournal';
import type { AuditEvent } from '../types';
import { Check, AlertTriangle, Cloud, HardDrive, RefreshCw, Trash2, Clock3 } from 'lucide-react';
import type { HybridPersistenceState } from '../persistence/useHybridPersistence';
import { requestExternalTimestamp } from '../services/timestamping';
import {
  observeAuthoritativeCartularyIntegrity,
  type AuthoritativeCartularyIntegrity,
} from '../services/cartularyIntegrity';
import {
  deriveAuthoritativeIntegrityLevel,
  deriveLocalWorkJournalLevel,
} from '../domain/integrityPresentation';
import { CartularyTransferPanel } from './CartularyTransferPanel';
import { PublishedWebsiteQr } from './PublishedWebsiteQr';
import {
  isStepUpCancellation,
  StepUpAuthenticationUnavailableError,
  useStepUpAuthentication,
} from '../security/useStepUpAuthentication';

interface AuditPanelProps {
  journal: IntegrityJournal;
  cartularyId: string;
  language: 'FR' | 'EN';
  publicShareCode?: string;
  snapshot: Record<string, unknown>;
  refreshToken: number;
  persistence: HybridPersistenceState;
  onDeleteAllData: () => Promise<void>;
  onJournalUpdate: () => void;
  /**
   * Rendu « lecture » du panneau : aucune action propriétaire, aucune observation de session,
   * aucun accès au carnet local (convention readOnly={!canEdit} du lecteur unique, V5 point 1 :
   * démonstration, propriétaire hors session, membre sans droit de gérer, droits en cours de résolution).
   */
  readOnly?: boolean;
  /** Texte seul (ADR-026) : en lecture, les textes nomment la démonstration ou un simple accès en lecture. */
  demonstration?: boolean;
  /** Lien vers la page Preuves du Registre de démonstration, affiché seulement en lecture seule. */
  demoRegistryProofsHref?: string | null;
  /**
   * Adresse du mini-site réellement publié, constatée à l'exécution (loadPublicPublicationSummaries).
   * En lecture comme en mode propriétaire, le QR de partage ne s'affiche que si cette adresse est
   * fournie : jamais de faux « publié », jamais de QR vers une adresse vide (V4 point 2).
   */
  publishedWebsiteUrl?: string | null;
}

const PANEL_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--s4)',
  padding: 'var(--s4)',
  height: '100%',
  overflowY: 'auto',
  backgroundColor: 'var(--sheet)',
  color: 'var(--ink)',
};

const SECTION_TITLE_STYLE: React.CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-sans)',
  fontSize: '13px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
};

const MUTED_PARAGRAPH_STYLE: React.CSSProperties = { margin: 0, color: 'var(--muted)', fontSize: '12px', lineHeight: 1.5 };

interface ReadOnlyProofsProps {
  language: 'FR' | 'EN';
  demonstration: boolean;
  publicShareCode: string;
  publishedWebsiteUrl: string | null;
  demoRegistryProofsHref: string | null;
  serverProofTitle: string;
  serverProofDoctrine: string;
}

/**
 * Rendu « lecture » des Preuves pour un lecteur qui ne peut ni éditer ni publier (démonstration, propriétaire
 * hors session, membre sans droit de gérer) : la structure reste celle du panneau propriétaire (conservation,
 * cession, preuve serveur, partage), seuls les textes sont contextuels — `demonstration` ne change que les
 * textes. Aucun bouton d'action, aucune observation de session Firebase, aucun message technique.
 */
const ReadOnlyProofs: React.FC<ReadOnlyProofsProps> = ({
  language,
  demonstration,
  publicShareCode,
  publishedWebsiteUrl,
  demoRegistryProofsHref,
  serverProofTitle,
  serverProofDoctrine,
}) => {
  const tx = (french: string, english: string) => language === 'FR' ? french : english;
  return (
    <div className="audit-panel audit-panel--read-only" style={PANEL_STYLE}>
      <section aria-labelledby="persistence-title" className="cartulary-demo-proofs-note" style={{ display: 'grid', gap: 'var(--s2)', borderBottom: '1px solid var(--rule)', paddingBottom: 'var(--s4)' }}>
        <h4 id="persistence-title" style={SECTION_TITLE_STYLE}>{tx('Conservation des données', 'Data preservation')}</h4>
        <p style={MUTED_PARAGRAPH_STYLE}>
          {demonstration ? tx(
            'Démonstration en lecture seule. Rien n’est enregistré dans ce navigateur ni synchronisé ; le compte de démonstration ne possède pas de copie privée.',
            'Read-only demonstration. Nothing is saved in this browser or synchronized; the demonstration account has no private copy.',
          ) : tx(
            'Votre accès à ce Cartulaire est en lecture seule : aucune action propriétaire n’est disponible depuis cette vue.',
            'Your access to this Cartulary is read-only: no owner action is available from this view.',
          )}
        </p>
      </section>

      <section aria-labelledby="cartulary-transfer-title" className="cartulary-demo-proofs-note" style={{ display: 'grid', gap: 'var(--s2)', borderBottom: '1px solid var(--rule)', paddingBottom: 'var(--s4)' }}>
        <h4 id="cartulary-transfer-title" style={SECTION_TITLE_STYLE}>{tx('Cession du Cartulaire', 'Cartulary transfer')}</h4>
        <p style={MUTED_PARAGRAPH_STYLE}>
          {demonstration ? tx(
            'La cession n’est pas démontrée : elle exige le compte propriétaire et une confirmation humaine.',
            'Transfer is not demonstrated: it requires the owner account and a human confirmation.',
          ) : tx(
            'La cession relève du compte propriétaire.',
            'Transfer is handled by the owner account.',
          )}
        </p>
      </section>

      <section aria-labelledby="server-proof-title" style={{ display: 'grid', gap: 'var(--s2)', padding: 'var(--s3)', border: '1px solid var(--ink)', background: 'var(--paper)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s2)' }}>
          <h4 id="server-proof-title" style={SECTION_TITLE_STYLE}>{serverProofTitle}</h4>
          <strong style={{ fontSize: '11px', textAlign: 'right' }}>{demonstration ? tx('Chaîne fictive de démonstration', 'Fictional demonstration chain') : tx('Chaîne serveur', 'Server chain')}</strong>
        </div>
        <p style={{ ...MUTED_PARAGRAPH_STYLE, fontSize: '11px' }}>{serverProofDoctrine}</p>
        {demoRegistryProofsHref && (
          <a className="button button--quiet" href={demoRegistryProofsHref} style={{ justifySelf: 'start' }}>
            {tx('Voir les preuves du Registre démo', 'View the demo Registry proofs')}
          </a>
        )}
      </section>

      {publishedWebsiteUrl && (
        <section aria-labelledby="public-share-title" className="cartulary-demo-proofs-share" style={{ display: 'grid', gap: 'var(--s2)' }}>
          <h4 id="public-share-title" style={SECTION_TITLE_STYLE}>{tx('Mini-site publié', 'Published mini-site')}</h4>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', alignItems: 'center' }}>
            <span style={{ color: 'var(--muted)' }}>{tx('Code public du Cartulaire', 'Public Cartulary code')}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{publicShareCode}</span>
          </div>
          <PublishedWebsiteQr language={language} url={publishedWebsiteUrl} />
        </section>
      )}
    </div>
  );
};

export const AuditPanel: React.FC<AuditPanelProps> = ({
  journal,
  cartularyId,
  language,
  publicShareCode = language === 'FR' ? 'Non émis' : 'Not issued',
  snapshot,
  refreshToken,
  persistence,
  onDeleteAllData,
  onJournalUpdate,
  readOnly = false,
  demonstration = false,
  demoRegistryProofsHref = null,
  publishedWebsiteUrl = null,
}) => {
  const tx = (french: string, english: string) => language === 'FR' ? french : english;
  const deleteKeyword = language === 'FR' ? 'SUPPRIMER' : 'DELETE';
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [receipts, setReceipts] = useState<AnchorReceipt[]>([]);
  const [integrityStatus, setIntegrityStatus] = useState<IntegrityVerificationResult>({
    isValid: true,
    errors: [],
    legacyStatuses: [],
  });
  const [proofState, setProofState] = useState<IntegrityProofState>(() => journal.getProofState());
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isTimestamping, setIsTimestamping] = useState(false);
  const [timestampError, setTimestampError] = useState<string | null>(null);
  const [timestampNotice, setTimestampNotice] = useState<string | null>(null);
  // V5 P-D1 : deux erreurs distinctes, chacune affichée sous l'action qui l'a produite
  // (export dans « Carnet local de travail », suppression dans « Suppression des données »).
  const [exportError, setExportError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [authorityLoadState, setAuthorityLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [authorityIntegrity, setAuthorityIntegrity] = useState<AuthoritativeCartularyIntegrity | null>(null);
  const { runWithStepUp, stepUpDialog } = useStepUpAuthentication(language);

  const refreshJournal = useCallback(async () => {
    await journal.ready();
    const status = await journal.verifyIntegrity();
    setEvents(journal.getEvents());
    setReceipts(journal.getReceipts());
    setProofState(journal.getProofState());
    setIntegrityStatus(status);
  }, [journal]);

  useEffect(() => {
    // Lecture seule : le carnet local n'est ni lu ni ouvert (rien n'est enregistré dans ce navigateur).
    if (readOnly) return;
    refreshJournal();
  }, [readOnly, refreshJournal, refreshToken]);

  useEffect(() => {
    if (readOnly || !persistence.authenticated) {
      setAuthorityLoadState('idle');
      setAuthorityIntegrity(null);
      return undefined;
    }
    setAuthorityLoadState('loading');
    setAuthorityIntegrity(null);
    return observeAuthoritativeCartularyIntegrity(cartularyId, (state) => {
      setAuthorityIntegrity(state);
      setAuthorityLoadState('ready');
    }, () => {
      setAuthorityIntegrity(null);
      setAuthorityLoadState('error');
    });
  }, [cartularyId, persistence.authenticated, readOnly]);

  const handleExternalTimestamp = async () => {
    setIsTimestamping(true);
    setTimestampError(null);
    setTimestampNotice(null);
    try {
      await journal.reconcileSnapshot(snapshot);
      const merkleRoot = await journal.getMerkleRoot();
      const existing = journal.getReceipts().find((receipt) => (
        isRfc3161Receipt(receipt) && receipt.merkleRoot === merkleRoot
      ));
      if (existing) {
        setTimestampNotice(language === 'FR' ? 'Ce lot possède déjà un horodatage externe.' : 'This batch already has an external timestamp.');
      } else {
        const receipt = await requestExternalTimestamp(merkleRoot, cartularyId);
        await journal.attachExternalTimestamp(receipt);
        setTimestampNotice(language === 'FR' ? 'Horodatage externe vérifié et conservé.' : 'External timestamp verified and saved.');
      }
      await refreshJournal();
      onJournalUpdate();
    } catch (error) {
      setTimestampError(error instanceof Error ? error.message : tx('Horodatage externe impossible.', 'External timestamping failed.'));
    } finally {
      setIsTimestamping(false);
    }
  };

  // V5 P-D1 : la migration n'est proposée que sous une rupture constatée (alerte de l'historique) ;
  // les outils d'essai du carnet (altération simulée, horodatage de test) n'ont plus aucun appelant d'interface.
  const handleReset = async () => {
    await journal.migrateBrokenJournal(snapshot);
    await refreshJournal();
    onJournalUpdate();
  };

  const handleExport = async () => {
    setExportError(null);
    try {
      await runWithStepUp('secret_export', async () => {
        const bundle = await journal.exportPortableBundle(snapshot);
        const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `carnet-local-${bundle.cartularyId}-r${bundle.revision}.json`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
        await refreshJournal();
        onJournalUpdate();
      }, { required: persistence.authenticated });
    } catch (nextError) {
      if (!isStepUpCancellation(nextError)) {
        setExportError(nextError instanceof StepUpAuthenticationUnavailableError
          ? tx('La session a expiré. Reconnectez-vous avant de continuer.', 'The session expired. Sign in again before continuing.')
          : nextError instanceof Error
          ? nextError.message
          : tx('Export impossible.', 'Export failed.'));
      }
    }
  };

  const handleDeleteAllData = async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await runWithStepUp('cloud_delete', onDeleteAllData, { required: persistence.authenticated });
    } catch (nextError) {
      if (!isStepUpCancellation(nextError)) {
        setDeleteError(nextError instanceof StepUpAuthenticationUnavailableError
          ? tx('La session a expiré. Reconnectez-vous avant de continuer.', 'The session expired. Sign in again before continuing.')
          : nextError instanceof Error
          ? nextError.message
          : tx('Suppression impossible.', 'Deletion failed.'));
      }
      setIsDeleting(false);
    }
  };

  const latestExternalReceipt = [...receipts].reverse().find(isRfc3161Receipt);
  const authorityLevel = deriveAuthoritativeIntegrityLevel({
    authenticated: persistence.authenticated,
    loadState: authorityLoadState,
    verificationValid: authorityIntegrity?.verification.valid,
    timestampStatus: authorityIntegrity?.timestampStatus,
    publicAnchoringStatus: authorityIntegrity?.publicAnchoringStatus,
  });
  const localJournalLevel = deriveLocalWorkJournalLevel({
    verificationValid: integrityStatus.isValid,
    hasExternalTimestamp: Boolean(latestExternalReceipt),
  });
  const authorityStatusLabel = {
    sign_in_required: tx('Connexion requise', 'Sign-in required'),
    loading: tx('Vérification serveur…', 'Checking server proof…'),
    unavailable: tx('Preuve serveur indisponible', 'Server proof unavailable'),
    broken: tx('Rupture de la chaîne serveur', 'Server chain break detected'),
    chain_only: tx('Chaîne serveur cohérente · non scellée extérieurement', 'Consistent server chain · no external seal'),
    timestamped: tx('Chaîne serveur horodatée par un tiers', 'Third-party timestamped server chain'),
    anchor_pending: tx('Ancrage Bitcoin soumis · confirmation en attente', 'Bitcoin anchor submitted · confirmation pending'),
    anchor_failed: tx('Ancrage public en échec temporaire', 'Temporary public anchoring failure'),
    anchored: tx('Ancrage OpenTimestamps confirmé sur Bitcoin', 'OpenTimestamps anchor confirmed on Bitcoin'),
  }[authorityLevel];
  const serverProofTitle = tx('Preuve serveur du Cartulaire', 'Cartulary server proof');
  const serverProofDoctrine = tx('Cette chaîne serveur est l’unique autorité d’intégrité affichée pour les opérations partagées, les cessions et les preuves exportables. Elle détecte les modifications ; elle ne prouve ni l’authenticité physique, ni la vérité des déclarations, ni la propriété juridique.', 'This server chain is the only displayed integrity authority for shared operations, transfers and portable proofs. It detects changes; it proves neither physical authenticity, factual truth nor legal ownership.');

  // Tous les hooks sont appelés avant cette bascule (règles des hooks) ; la branche lecture ne monte
  // ni CartularyTransferPanel (qui observerait la session) ni aucune action propriétaire.
  if (readOnly) {
    return (
      <ReadOnlyProofs
        language={language}
        demonstration={demonstration}
        publicShareCode={publicShareCode}
        publishedWebsiteUrl={publishedWebsiteUrl}
        demoRegistryProofsHref={demoRegistryProofsHref}
        serverProofTitle={serverProofTitle}
        serverProofDoctrine={serverProofDoctrine}
      />
    );
  }

  return (
    <div style={PANEL_STYLE}>
      {stepUpDialog}
      <section aria-labelledby="persistence-title" style={{ borderBottom: '1px solid var(--rule)', paddingBottom: 'var(--s4)' }}>
        <h4 id="persistence-title" style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 'var(--s3)' }}>
          {language === 'FR' ? 'Conservation des données' : 'Data preservation'}
        </h4>
        <div style={{ display: 'grid', gap: 'var(--s2)', fontSize: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--s2)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><HardDrive size={14} /> {language === 'FR' ? 'Coffre local' : 'Local vault'}</span>
            <strong>{persistence.localStatus === 'saving' ? tx('Enregistrement…', 'Saving…') : persistence.localStatus === 'error' ? tx('Erreur', 'Error') : persistence.localStatus === 'deleted' ? tx('Supprimé', 'Deleted') : tx('À jour', 'Up to date')}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--s2)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Cloud size={14} /> {language === 'FR' ? 'Copie privée cloud' : 'Private cloud copy'}</span>
            <strong>{persistence.cloudStatus === 'signed-out'
              ? (language === 'FR' ? 'Connexion requise' : 'Sign-in required')
              : persistence.cloudStatus === 'syncing' ? tx('Synchronisation…', 'Syncing…')
                : persistence.cloudStatus === 'synced' ? tx('À jour', 'Up to date')
                  : persistence.cloudStatus === 'conflict' ? tx('Conflit à arbitrer', 'Conflict to resolve')
                    : persistence.cloudStatus === 'remote-deleted' ? tx('Supprimée à distance', 'Deleted remotely')
                      : tx('Erreur', 'Error')}</strong>
          </div>
          {persistence.accountLabel && <small style={{ color: 'var(--muted)', overflowWrap: 'anywhere' }}>{tx('Compte', 'Account')} : {persistence.accountLabel}</small>}
          {persistence.lastSyncedAt && <small style={{ color: 'var(--muted)' }}>{tx('Dernière synchronisation', 'Last sync')} : {new Intl.DateTimeFormat(language === 'FR' ? 'fr-FR' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(persistence.lastSyncedAt))}</small>}
          {persistence.conflicts.length > 0 && (
            <div role="alert" style={{ padding: 'var(--s2)', border: '1px solid var(--mark)', color: 'var(--mark)' }}>
              <strong>{language === 'FR' ? `${persistence.conflicts.length} conflit${persistence.conflicts.length > 1 ? 's' : ''} détecté${persistence.conflicts.length > 1 ? 's' : ''}.` : `${persistence.conflicts.length} conflict${persistence.conflicts.length === 1 ? '' : 's'} detected.`}</strong>
              <p style={{ margin: '6px 0' }}>{tx('Aucune version n’a été écrasée. Choisissez explicitement la version à conserver.', 'No version was overwritten. Explicitly choose which version to keep.')}</p>
              {persistence.conflicts.map((conflict) => (
                <div key={`${conflict.kind}:${conflict.id}`} style={{ display: 'grid', gap: '6px', paddingTop: '6px', borderTop: '1px solid currentColor' }}>
                  <code style={{ overflowWrap: 'anywhere' }}>{conflict.kind} · {conflict.id}</code>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    <button type="button" className="button button--quiet" disabled={persistence.cloudStatus === 'syncing'} onClick={() => void persistence.resolveConflict(conflict, 'keep-local')}>{tx('Conserver ma version', 'Keep my version')}</button>
                    <button type="button" className="button button--quiet" disabled={persistence.cloudStatus === 'syncing'} onClick={() => void persistence.resolveConflict(conflict, 'take-cloud')}>{tx('Prendre la version cloud', 'Use cloud version')}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {persistence.error && <div role="alert" style={{ color: 'var(--mark)', overflowWrap: 'anywhere' }}>{persistence.error}</div>}
          <p style={{ color: 'var(--muted)', lineHeight: 1.5, margin: 0 }}>
            {persistence.authenticated
              ? tx('Les originaux restent privés et liés à votre compte. La synchronisation ne publie aucun bloc.', 'Originals remain private and linked to your account. Synchronization publishes no blocks.')
              : tx('Les données et originaux sont conservés dans ce navigateur. Connectez-vous au Registre pour activer la copie privée cloud.', 'Data and originals are stored in this browser. Sign in to the Registry to activate a private cloud copy.')}
          </p>
          {persistence.authenticated && (
            <button type="button" className="button button--quiet" onClick={() => void persistence.syncNow()} disabled={persistence.cloudStatus === 'syncing'}>
              <RefreshCw size={14} /> {tx('Synchroniser maintenant', 'Sync now')}
            </button>
          )}
        </div>
      </section>

      <CartularyTransferPanel cartularyId={cartularyId} language={language} />

      <section aria-labelledby="server-proof-title" style={{ display: 'grid', gap: 'var(--s2)', padding: 'var(--s3)', border: '1px solid var(--ink)', background: 'var(--paper)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s2)' }}>
          <h4 id="server-proof-title" style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            {serverProofTitle}
          </h4>
          <strong style={{ fontSize: '11px', color: authorityLevel === 'broken' || authorityLevel === 'unavailable' ? 'var(--mark)' : 'var(--ink)', textAlign: 'right' }}>{authorityStatusLabel}</strong>
        </div>
        {authorityIntegrity && authorityLoadState === 'ready' && <dl style={{ display: 'grid', gap: '6px', margin: 0, fontSize: '11px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--s2)' }}><dt>{tx('Révision autoritaire', 'Authoritative revision')}</dt><dd>R{authorityIntegrity.sourceRevision}</dd></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--s2)' }}><dt>{tx('Événements serveur', 'Server events')}</dt><dd>{authorityIntegrity.integritySequence}</dd></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--s2)' }}><dt>{tx('Tête de chaîne', 'Chain head')}</dt><dd title={authorityIntegrity.integrityHead} style={{ fontFamily: 'var(--font-mono)' }}>{authorityIntegrity.integrityHead.slice(0, 20)}…</dd></div>
          {authorityIntegrity.batchId && <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--s2)' }}><dt>{tx('Lot de preuve', 'Proof batch')}</dt><dd style={{ fontFamily: 'var(--font-mono)' }}>{authorityIntegrity.batchId}</dd></div>}
          {authorityIntegrity.timestampStatus && <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--s2)' }}><dt>{tx('Horodatage du lot', 'Batch timestamp')}</dt><dd>{authorityIntegrity.timestampStatus === 'qualified_eidas' ? tx('Qualifié eIDAS · QTSA démontrée', 'Qualified eIDAS · QTSA demonstrated') : authorityIntegrity.timestampStatus === 'trusted_rfc3161' ? tx('RFC 3161 vérifié · non qualifié', 'Verified RFC 3161 · not qualified') : authorityIntegrity.timestampStatus === 'test_fixture' ? tx('Fixture de test · simulation', 'Test fixture · simulation') : authorityIntegrity.timestampStatus}</dd></div>}
          {authorityIntegrity.publicAnchorBlockHeight !== null && <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--s2)' }}><dt>{tx('Bloc Bitcoin', 'Bitcoin block')}</dt><dd>{authorityIntegrity.publicAnchorBlockHeight}</dd></div>}
        </dl>}
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: '11px', lineHeight: 1.5 }}>
          {authorityLevel === 'sign_in_required'
            ? tx('Connectez-vous pour lire la chaîne transactionnelle du serveur. Le carnet local présenté plus bas reste un cache de travail et ne la remplace pas.', 'Sign in to read the transactional server chain. The local work journal below remains a cache and does not replace it.')
            : authorityLevel === 'unavailable'
              ? tx('Aucun repli local n’est présenté comme preuve serveur. Réessayez lorsque le service autoritaire est disponible.', 'No local fallback is presented as server proof. Retry when the authoritative service is available.')
              : serverProofDoctrine}
        </p>
      </section>

      {/* Carnet local conservé comme cache de travail hors ligne. */}
      <div style={{
        borderBottom: '1px solid var(--rule)',
        paddingBottom: 'var(--s4)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 'var(--s2)' }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: integrityStatus.isValid ? 'var(--ink)' : 'var(--mark)',
          }} />
          <h4 style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '13px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.1em'
          }}>
            {language === 'FR' ? 'Carnet local de travail' : 'Local work journal'}
          </h4>
        </div>

        <p style={{ margin: '0 0 var(--s2)', color: 'var(--muted)', fontSize: '11px', lineHeight: 1.5 }}>
          {tx('Cache hors ligne conservé sans réécriture, avec ses anciens journaux archivés. Il aide à retrouver les modifications effectuées dans ce navigateur, mais ne commande ni cession, ni publication, ni Sceau public et ne remplace jamais la preuve serveur.', 'Offline cache preserved without rewriting, including archived legacy journals. It helps track changes made in this browser, but controls no transfer, publication or public Seal and never replaces the server proof.')}
        </p>

        {/* État compact du carnet local conservé. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)', marginTop: 'var(--s2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
            <span style={{ color: 'var(--muted)' }}>{language === 'FR' ? 'État du carnet' : 'Journal status'}</span>
            <span style={{ fontWeight: 600, color: integrityStatus.isValid ? 'var(--ink)' : 'var(--mark)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              {integrityStatus.isValid ? <Check size={12} /> : <AlertTriangle size={12} />}
              {localJournalLevel === 'timestamped_local'
                ? tx('Cache cohérent · instantané local horodaté', 'Consistent cache · local snapshot timestamped')
                : localJournalLevel === 'local_only'
                  ? tx('Cache cohérent · garantie locale seulement', 'Consistent cache · local assurance only')
                  : tx('Rupture locale détectée', 'Local break detected')}
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
            <span style={{ color: 'var(--muted)' }}>{language === 'FR' ? "Portée du contrôle" : "Verification scope"}</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>
              {language === 'FR' ? `Révision locale ${proofState.revision}` : `Local revision ${proofState.revision}`}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: 'var(--s1)' }}>
            <span style={{ color: 'var(--muted)', fontSize: '11px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
              {language === 'FR' ? "Empreinte SHA-256 (Abrégée)" : "SHA-256 Hash (Short)"}
            </span>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              backgroundColor: 'var(--paper)',
              padding: '6px var(--s2)',
              border: '1px solid var(--rule)',
              wordBreak: 'break-all'
            }}>
              {proofState.contentDigest.substring(0, 23)}...
            </span>
          </div>

          {proofState.legacyStatuses.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--s2)', fontSize: '11px' }}>
              <span style={{ color: 'var(--muted)' }}>{language === 'FR' ? 'Journal historique' : 'Legacy journal'}</span>
              <span style={{ fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
                {proofState.legacyStatuses.map((status) => ({
                  legacy_valid: tx('archive vérifiable', 'verifiable archive'),
                  legacy_broken: tx('archive rompue conservée', 'preserved broken archive'),
                  legacy_unverifiable: tx('archive invérifiable conservée', 'preserved unverifiable archive'),
                }[status])).join(', ')}
              </span>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', alignItems: 'center', marginTop: 'var(--s1)' }}>
            <span style={{ color: 'var(--muted)' }}>{language === 'FR' ? 'Code public du Cartulaire' : 'Public Cartulary code'}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{publicShareCode}</span>
          </div>

          <div style={{ display: 'grid', gap: '8px', marginTop: 'var(--s2)', padding: 'var(--s3)', border: '1px solid var(--rule)', background: 'var(--paper)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock3 size={16} />
              <strong style={{ fontSize: '12px' }}>{language === 'FR' ? 'Horodatage du carnet local' : 'Local journal timestamp'}</strong>
            </div>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '11px', lineHeight: 1.45 }}>
              {language === 'FR'
                ? 'Seule la racine Merkle du carnet local est transmise. Le jeton date cet instantané local ; il ne le transforme pas en chaîne serveur et ne prouve pas la vérité des informations.'
                : 'Only the local journal Merkle root is sent. The token dates that local snapshot; it does not turn it into the server chain or prove that the information is true.'}
            </p>
            <button
              type="button"
              className="button button--primary"
              onClick={() => void handleExternalTimestamp()}
              disabled={!persistence.authenticated || !integrityStatus.isValid || proofState.revision === 0 || isTimestamping}
            >
              <Clock3 size={14} /> {isTimestamping
                ? (language === 'FR' ? 'Horodatage en cours…' : 'Timestamping…')
                : !persistence.authenticated
                  ? (language === 'FR' ? 'Connexion propriétaire requise' : 'Owner sign-in required')
                  : (language === 'FR' ? 'Horodater le carnet local' : 'Timestamp local journal')}
            </button>
            {timestampNotice && <div role="status" style={{ color: 'var(--muted)', fontSize: '11px' }}>{timestampNotice}</div>}
            {timestampError && <div role="alert" style={{ color: 'var(--mark)', fontSize: '11px' }}>{timestampError}</div>}
          </div>

          {/* V5 P-D1 : export du carnet local, action de production rangée avec le carnet (plus de tiroir technique). */}
          <div style={{ display: 'grid', gap: '8px', marginTop: 'var(--s2)' }}>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '11px', lineHeight: 1.45 }}>
              {tx(
                'Copie JSON portable des événements et reçus de ce navigateur, vérifiable hors ligne. Elle ne contient aucun original ni aucune preuve serveur.',
                'Portable JSON copy of this browser’s events and receipts, verifiable offline. It contains no original and no server proof.',
              )}
            </p>
            <button
              type="button"
              className="button button--quiet"
              disabled={!integrityStatus.isValid || proofState.revision === 0}
              onClick={() => void handleExport()}
            >
              {tx('Exporter le carnet local', 'Export local journal')}
            </button>
            {exportError && <p role="alert" style={{ margin: 0, color: 'var(--mark)', fontSize: '11px' }}>{exportError}</p>}
          </div>
        </div>

        {/* QR de partage : uniquement vers le mini-site réellement publié (V4 point 2). */}
        {publishedWebsiteUrl
          ? <div style={{ marginTop: 'var(--s3)' }}><PublishedWebsiteQr language={language} url={publishedWebsiteUrl} /></div>
          : <p role="note" style={{ margin: 'var(--s3) 0 0', color: 'var(--muted)', fontSize: '11px', lineHeight: 1.45 }}>{tx('Aucun mini-site publié : le QR code de partage apparaît une fois la publication confirmée depuis la page Publication.', 'No published mini-site: the share QR code appears once publication is confirmed from the Publication page.')}</p>}
      </div>

      {/* 2. Journal d'Audit Châné */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
        <h4 style={{
          fontFamily: 'var(--font-sans)',
          fontSize: '13px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.1em'
        }}>
          {language === 'FR' ? 'Historique local conservé' : 'Preserved local history'}
        </h4>

        {/* Alerte de rupture : seule issue d'un carnet rompu, la migration n'est proposée qu'ici (V5 P-D1). */}
        {!integrityStatus.isValid && (
          <div style={{
            backgroundColor: 'rgba(166, 58, 42, 0.08)',
            border: '1px solid var(--mark)',
            padding: 'var(--s2) var(--s3)',
            color: 'var(--mark)',
            fontSize: '12px',
            fontFamily: 'var(--font-mono)',
            display: 'grid',
            gap: '8px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={14} />
              <span>
                {language === 'FR'
                  ? (integrityStatus.brokenSequence === undefined
                      ? 'Incohérence détectée dans le carnet local.'
                      : `Rupture de chaîne à la séquence #${integrityStatus.brokenSequence} !`)
                  : (integrityStatus.brokenSequence === undefined
                      ? 'An inconsistency was detected in the local journal.'
                      : `Chain broken at sequence #${integrityStatus.brokenSequence}!`)}
              </span>
            </div>
            <p style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: '11px', lineHeight: 1.45 }}>
              {tx(
                'Le carnet local ne peut plus être horodaté ni exporté. La migration archive l’état rompu (conservé, jamais réécrit) et repart d’un carnet vide ; la preuve serveur n’est pas concernée.',
                'The local journal can no longer be timestamped or exported. Migration archives the broken state (preserved, never rewritten) and starts a fresh journal; the server proof is not affected.',
              )}
            </p>
            <button type="button" className="button button--quiet" style={{ justifySelf: 'start' }} onClick={() => void handleReset()}>
              {tx('Migrer la chaîne rompue', 'Migrate broken chain')}
            </button>
          </div>
        )}

        {/* Événements */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          maxHeight: '300px',
          overflowY: 'auto',
          paddingRight: '4px'
        }}>
          {events.map((evt) => {
            const isBroken = !integrityStatus.isValid && integrityStatus.brokenSequence === evt.sequence;
            return (
              <div key={evt.id} style={{
                padding: 'var(--s2)',
                backgroundColor: isBroken ? 'rgba(166, 58, 42, 0.04)' : 'var(--paper)',
                borderLeft: `2px solid ${isBroken ? 'var(--mark)' : 'var(--rule)'}`,
                fontSize: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', color: 'var(--muted)', fontSize: '9px' }}>
                  <span>#{evt.sequence} · {evt.action}</span>
                  <span className="tabular-nums">{new Date(evt.timestamp).toLocaleTimeString()}</span>
                </div>
                <div style={{ fontWeight: 500, color: 'var(--ink)' }}>
                  {evt.details}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '8px', color: 'var(--muted)', marginTop: '2px' }}>
                  HASH: <span className="tabular-nums" style={{ color: isBroken ? 'var(--mark)' : 'var(--muted)' }}>{evt.hash.substring(0, 12)}...</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Reçus d'horodatage externes et fixtures locales explicitement séparés */}
        {receipts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: 'var(--s1)' }}>
            <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {language === 'FR' ? "Reçus d’horodatage" : "Timestamp receipts"}
            </span>
            {receipts.map((rec) => {
              const isExternal = isRfc3161Receipt(rec);
              return (
                <div key={rec.receiptId} style={{
                  backgroundColor: 'var(--fill)',
                  padding: 'var(--s2)',
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  borderLeft: `3px solid ${isExternal ? 'var(--ink)' : 'var(--muted)'}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontWeight: 600 }}>
                    <span style={{ fontSize: '10px' }}>{rec.provider}</span>
                    <span style={{ color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: '2px', fontSize: '9px', textAlign: 'right' }}>
                      <Check size={8} /> {isExternal
                        ? (language === 'FR' ? 'RFC 3161 VÉRIFIÉ' : 'VERIFIED RFC 3161')
                        : (language === 'FR' ? 'TEST LOCAL' : 'LOCAL TEST')}
                    </span>
                  </div>
                  <time dateTime={rec.timestamp} style={{ fontSize: '9px' }}>
                    {new Intl.DateTimeFormat(language === 'FR' ? 'fr-FR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'long', timeZone: 'UTC' }).format(new Date(rec.timestamp))}
                  </time>
                  <div style={{ fontSize: '8px', color: 'var(--muted)', wordBreak: 'break-all' }}>ROOT: {rec.merkleRoot}</div>
                  {isExternal && <>
                    <div style={{ fontSize: '8px', color: 'var(--muted)', wordBreak: 'break-all' }}>TOKEN: {rec.tokenSha256}</div>
                    <div style={{ fontSize: '8px', color: 'var(--muted)' }}>
                      {rec.qualified
                        ? (language === 'FR' ? 'Qualification eIDAS : QTSA validée' : 'eIDAS qualification: validated QTSA')
                        : (language === 'FR' ? 'Qualification eIDAS : non évaluée' : 'eIDAS qualification: not assessed')}
                    </div>
                  </>}
                  <div style={{ fontSize: '8px', color: 'var(--muted)' }}>
                    {rec.publicAnchoringStatus === 'deferred'
                      ? tx('Ancrage public de ce carnet : non demandé', 'Public anchoring for this journal: not requested')
                      : tx(`Ancrage public de ce carnet : ${rec.publicAnchoringStatus}`, `Public anchoring for this journal: ${rec.publicAnchoringStatus}`)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. Suppression des données : dernière section, isolée des actions courantes (V5 P-D1). */}
      <div style={{
        borderTop: '1px solid var(--rule)',
        paddingTop: 'var(--s3)',
        marginTop: 'auto'
      }}>
        <section aria-labelledby="deletion-title" style={{ display: 'grid', gap: 'var(--s2)', padding: 'var(--s3)', border: '1px solid var(--mark)' }}>
          <h4 id="deletion-title" style={SECTION_TITLE_STYLE}>{tx('Suppression des données', 'Data deletion')}</h4>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '11px', lineHeight: 1.45 }}>
            {tx(
              'Action irréversible : efface le coffre local de ce navigateur (originaux, carnet local) et, si vous êtes connecté, la copie privée cloud. Les publications déjà émises, les Sceaux et la chaîne serveur ne sont pas supprimés.',
              'Irreversible action: erases this browser’s local vault (originals, local journal) and, if you are signed in, the private cloud copy. Publications already issued, Seals and the server chain are not deleted.',
            )}
          </p>
          {!showDeleteConfirmation ? (
            <button type="button" className="button button--quiet" style={{ justifySelf: 'start' }} onClick={() => setShowDeleteConfirmation(true)}><Trash2 size={14} /> {tx('Supprimer mes données', 'Delete my data')}</button>
          ) : (
            <div role="alertdialog" aria-labelledby="delete-all-title" aria-describedby="delete-all-description" style={{ display: 'grid', gap: 'var(--s2)', padding: 'var(--s2)', border: '1px solid var(--mark)' }}>
              <strong id="delete-all-title">{tx('Suppression définitive', 'Permanent deletion')}</strong>
              <span id="delete-all-description">{language === 'FR'
                ? `Tapez ${deleteKeyword} pour effacer ce coffre local et, si vous êtes connecté, sa copie privée cloud. Les publications déjà émises ne sont pas supprimées par cette action.`
                : `Type ${deleteKeyword} to erase this local vault and, if signed in, its private cloud copy. Publications already issued are not deleted by this action.`}</span>
              <label>{tx('Confirmation', 'Confirmation')}<input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off" autoFocus /></label>
              <div style={{ display: 'flex', gap: 'var(--s2)' }}>
                <button type="button" className="button button--quiet" onClick={() => { setShowDeleteConfirmation(false); setDeleteConfirmation(''); }}>{tx('Annuler', 'Cancel')}</button>
                <button
                  type="button"
                  className="button button--primary"
                  disabled={deleteConfirmation !== deleteKeyword || isDeleting}
                  onClick={() => void handleDeleteAllData()}
                >{isDeleting ? tx('Suppression…', 'Deleting…') : tx('Confirmer la suppression', 'Confirm deletion')}</button>
              </div>
            </div>
          )}
          {deleteError && <p role="alert" style={{ margin: 0, color: 'var(--mark)' }}>{deleteError}</p>}
        </section>
      </div>
    </div>
  );
};
