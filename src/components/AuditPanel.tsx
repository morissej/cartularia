import React, { useCallback, useState, useEffect } from 'react';
import { IntegrityJournal } from '../utils/integrityJournal';
import type {
  AnchorReceipt,
  IntegrityProofState,
  IntegrityVerificationResult,
} from '../utils/integrityJournal';
import { isRfc3161Receipt } from '../utils/integrityJournal';
import type { AuditEvent } from '../types';
import { Check, AlertTriangle, ChevronDown, ChevronUp, Cloud, HardDrive, RefreshCw, Trash2, Clock3 } from 'lucide-react';
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
import QRCode from 'qrcode';
import { CartularyTransferPanel } from './CartularyTransferPanel';

interface AuditPanelProps {
  journal: IntegrityJournal;
  cartularyId: string;
  language: 'FR' | 'EN';
  publicShareCode?: string;
  snapshot: Record<string, unknown>;
  publicShareUrl: string;
  refreshToken: number;
  persistence: HybridPersistenceState;
  onDeleteAllData: () => Promise<void>;
  onJournalUpdate: () => void;
}

export const AuditPanel: React.FC<AuditPanelProps> = ({
  journal,
  cartularyId,
  language,
  publicShareCode = language === 'FR' ? 'Non émis' : 'Not issued',
  snapshot,
  publicShareUrl,
  refreshToken,
  persistence,
  onDeleteAllData,
  onJournalUpdate,
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
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [authorityLoadState, setAuthorityLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [authorityIntegrity, setAuthorityIntegrity] = useState<AuthoritativeCartularyIntegrity | null>(null);


  // Onglet technique masqué par défaut (Règle 4)
  const [showTechnicalSim, setShowTechnicalSim] = useState(false);

  const refreshJournal = useCallback(async () => {
    await journal.ready();
    const status = await journal.verifyIntegrity();
    setEvents(journal.getEvents());
    setReceipts(journal.getReceipts());
    setProofState(journal.getProofState());
    setIntegrityStatus(status);
  }, [journal]);

  useEffect(() => {
    refreshJournal();
  }, [refreshJournal, refreshToken]);

  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(publicShareUrl, {
      width: 192,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#1a1815', light: '#ffffff' },
    }).then((dataUrl) => {
      if (active) setQrDataUrl(dataUrl);
    }).catch(() => {
      if (active) setQrDataUrl('');
    });
    return () => { active = false; };
  }, [publicShareUrl]);

  useEffect(() => {
    if (!persistence.authenticated) {
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
  }, [cartularyId, persistence.authenticated]);

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

  const handleLocalTestTimestamp = async () => {
    await journal.createLocalTestTimestamp(snapshot);
    await refreshJournal();
    onJournalUpdate();
  };

  const handleTamper = async (seq: number) => {
    journal.simulateTampering(seq, "FALSIFICATION : Prix d'achat modifié à 15 000 EUR");
    await refreshJournal();
    onJournalUpdate();
  };

  const handleReset = async () => {
    await journal.migrateBrokenJournal(snapshot);
    await refreshJournal();
    onJournalUpdate();
  };

  const handleExport = async () => {
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

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--s4)',
      padding: 'var(--s4)',
      height: '100%',
      overflowY: 'auto',
      backgroundColor: 'var(--sheet)',
      color: 'var(--ink)'
    }}>
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
          {!showDeleteConfirmation ? (
            <button type="button" className="button button--quiet" onClick={() => setShowDeleteConfirmation(true)}><Trash2 size={14} /> {tx('Supprimer mes données', 'Delete my data')}</button>
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
                  onClick={() => {
                    setIsDeleting(true);
                    void onDeleteAllData().catch(() => setIsDeleting(false));
                  }}
                >{isDeleting ? tx('Suppression…', 'Deleting…') : tx('Confirmer la suppression', 'Confirm deletion')}</button>
              </div>
            </div>
          )}
        </div>
      </section>

      <CartularyTransferPanel cartularyId={cartularyId} language={language} />

      <section aria-labelledby="server-proof-title" style={{ display: 'grid', gap: 'var(--s2)', padding: 'var(--s3)', border: '1px solid var(--ink)', background: 'var(--paper)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s2)' }}>
          <h4 id="server-proof-title" style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            {tx('Preuve serveur du Cartulaire', 'Cartulary server proof')}
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
              : tx('Cette chaîne serveur est l’unique autorité d’intégrité affichée pour les opérations partagées, les cessions et les preuves exportables. Elle détecte les modifications ; elle ne prouve ni l’authenticité physique, ni la vérité des déclarations, ni la propriété juridique.', 'This server chain is the only displayed integrity authority for shared operations, transfers and portable proofs. It detects changes; it proves neither physical authenticity, factual truth nor legal ownership.')}
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
        </div>

        {/* QR Code de Partage en petit dans les détails (Règle 3) */}
        <div style={{
          marginTop: 'var(--s3)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s3)',
          backgroundColor: 'var(--paper)',
          padding: 'var(--s3)',
          border: '1px solid var(--rule)'
        }}>
          <a href={publicShareUrl} target="_blank" rel="noreferrer" aria-label={language === 'FR' ? 'Ouvrir la fiche publique liée au QR code' : 'Open the public record linked to the QR code'}>
            {qrDataUrl
              ? <img src={qrDataUrl} width="64" height="64" alt={language === 'FR' ? 'QR code vers la fiche publique' : 'QR code to the public record'} style={{ display: 'block', border: '1px solid var(--ink)' }} />
              : <span style={{ display: 'grid', width: '64px', height: '64px', placeItems: 'center', border: '1px solid var(--rule)', color: 'var(--muted)', fontSize: '9px' }}>QR</span>}
          </a>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--ink)' }}>
              {language === 'FR' ? "QR CODE DE PARTAGE" : "SHARE QR CODE"}
            </span>
            <span style={{ fontSize: '10px', color: 'var(--muted)' }}>
              {language === 'FR' ? "Scannez pour ouvrir la fiche publique." : "Scan to open the public record."}
            </span>
            <span style={{ maxWidth: '330px', overflowWrap: 'anywhere', fontSize: '8px', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{publicShareUrl}</span>
          </div>
        </div>
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

        {/* Alerte de rupture */}
        {!integrityStatus.isValid && (
          <div style={{
            backgroundColor: 'rgba(166, 58, 42, 0.08)',
            border: '1px solid var(--mark)',
            padding: 'var(--s2) var(--s3)',
            color: 'var(--mark)',
            fontSize: '12px',
            fontFamily: 'var(--font-mono)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
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

      {/* 3. Tiroir de Simulation Technique (Masqué par défaut - Règle 4) */}
      <div style={{
        borderTop: '1px solid var(--rule)',
        paddingTop: 'var(--s3)',
        marginTop: 'auto'
      }}>
        <button
          type="button"
          onClick={() => setShowTechnicalSim(!showTechnicalSim)}
          aria-expanded={showTechnicalSim}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            fontWeight: 700,
            color: 'var(--muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            padding: 'var(--s2) 0',
            cursor: 'pointer'
          }}
        >
          <span>{language === 'FR' ? "⚡ Simulation technique" : "⚡ Technical Simulation"}</span>
          {showTechnicalSim ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>

        {showTechnicalSim && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--s2)',
            backgroundColor: 'var(--paper)',
            padding: 'var(--s3)',
            marginTop: 'var(--s1)',
            border: '1px solid var(--rule)'
          }}>
            <p style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: 'var(--s1)' }}>
              {language === 'FR'
                ? "Simulation locale : testez la détection d’une altération ou créez une fixture. Cette fixture n’est jamais présentée comme un horodatage tiers."
                : "Local simulation: test tamper detection or create a fixture. This fixture is never presented as a third-party timestamp."}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s2)' }}>
              {integrityStatus.isValid && events.length > 1 ? (
                <button
                  onClick={() => handleTamper(events[1].sequence)}
                  style={{
                    flex: 1,
                    backgroundColor: 'transparent',
                    border: '1px solid var(--mark)',
                    color: 'var(--mark)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    padding: '8px 12px',
                    cursor: 'pointer',
                    transition: 'var(--transition)'
                  }}
                >
                  {language === 'FR'
                    ? `Falsifier événement #${events[1].sequence}`
                    : `Tamper event #${events[1].sequence}`}
                </button>
              ) : (
                <button
                  onClick={handleReset}
                  style={{
                    flex: 1,
                    backgroundColor: 'transparent',
                    border: '1px solid var(--ink)',
                    color: 'var(--ink)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    padding: '8px 12px',
                    cursor: 'pointer',
                    transition: 'var(--transition)'
                  }}
                >
                  {language === 'FR' ? "Migrer la chaîne rompue" : "Migrate broken chain"}
                </button>
              )}

              <button
                onClick={() => void handleLocalTestTimestamp()}
                disabled={!integrityStatus.isValid}
                style={{
                  backgroundColor: integrityStatus.isValid ? 'var(--ink)' : 'var(--fill)',
                  color: integrityStatus.isValid ? 'var(--paper)' : 'var(--muted)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  padding: '8px 12px',
                  cursor: integrityStatus.isValid ? 'pointer' : 'not-allowed',
                  transition: 'var(--transition)'
                }}
              >
                {language === 'FR' ? "Créer une fixture locale" : "Create local fixture"}
              </button>
              <button
                onClick={handleExport}
                disabled={!integrityStatus.isValid || proofState.revision === 0}
                style={{
                  width: '100%',
                  backgroundColor: 'transparent',
                  border: '1px solid var(--ink)',
                  color: 'var(--ink)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  padding: '8px 12px',
                  cursor: integrityStatus.isValid && proofState.revision > 0 ? 'pointer' : 'not-allowed',
                }}
              >
                {language === 'FR' ? 'Exporter le carnet local' : 'Export local journal'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
