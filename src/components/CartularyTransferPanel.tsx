import { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, CheckCircle2, Clock3, ShieldCheck, XCircle } from 'lucide-react';
import type { User } from 'firebase/auth';
import type { CartularyTransferDocument, CartularyTransferState } from '../domain/transfer.ts';
import {
  acceptTransfer,
  observeCartularyTransferState,
  proposeTransfer,
  rejectTransfer,
  waitForTransferRequest,
} from '../services/cartularyTransfer.ts';
import { observeCartulariaSession } from '../services/foundations.ts';
import {
  isStepUpCancellation,
  StepUpAuthenticationUnavailableError,
  type StepUpPurpose,
  useStepUpAuthentication,
} from '../security/useStepUpAuthentication.tsx';

const shortHash = (value?: string) => value?.startsWith('sha256:') ? `${value.slice(0, 19)}…${value.slice(-6)}` : value || '—';

const labels: Record<string, string> = {
  'cartulary.transfer.proposed': 'Cession proposée par le propriétaire',
  'cartulary.transfer.accepted': 'Cession acceptée par l’acquéreur',
  'cartulary.transfer.completed': 'Changement de propriétaire effectif',
  'cartulary.transfer.rejected': 'Cession refusée par l’acquéreur',
  'cartulary.transfer.expired': 'Proposition de cession expirée',
};

export function CartularyTransferPanel({ cartularyId, language }: { cartularyId: string; language: 'FR' | 'EN' }) {
  const tx = (fr: string, en: string) => language === 'FR' ? fr : en;
  const [user, setUser] = useState<User | null>(null);
  const [state, setState] = useState<CartularyTransferState | null>(null);
  const [buyerUid, setBuyerUid] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { runWithStepUp, stepUpDialog } = useStepUpAuthentication(language);

  useEffect(() => observeCartulariaSession(setUser), []);
  useEffect(() => {
    if (!user) {
      setState(null);
      return undefined;
    }
    return observeCartularyTransferState(cartularyId, setState, (nextError) => setError(nextError.message));
  }, [cartularyId, user]);

  const activeTransfer = useMemo(() => state?.transfers.find((transfer) => (
    transfer.status === 'proposed' || transfer.status === 'accepted'
  )) || null, [state]);
  const isCurrentOwner = Boolean(user && state?.currentOwnerUid === user.uid);
  const isBuyer = Boolean(user && activeTransfer?.buyerUid === user.uid);

  const run = async (purpose: StepUpPurpose, action: () => Promise<string>, success: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const requestId = await runWithStepUp(purpose, action, { required: true });
      setNotice(tx('Décision transmise au serveur…', 'Decision sent to the server…'));
      await waitForTransferRequest(requestId);
      setNotice(success);
      setConfirmed(false);
      setBuyerUid('');
    } catch (nextError) {
      if (!isStepUpCancellation(nextError)) {
        setError(nextError instanceof StepUpAuthenticationUnavailableError
          ? tx('La session a expiré. Reconnectez-vous avant de continuer.', 'The session expired. Sign in again before continuing.')
          : nextError instanceof Error ? nextError.message : tx('Cession impossible.', 'Transfer failed.'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="cartulary-transfer" aria-labelledby="cartulary-transfer-title">
      {stepUpDialog}
      <header><ArrowRightLeft aria-hidden="true" /><div><span>{tx('Autorité serveur', 'Server authority')}</span><h4 id="cartulary-transfer-title">{tx('Cession du Cartulaire', 'Cartulary transfer')}</h4></div>{state && <strong>{state.transferCount} {tx('cession(s) effective(s)', 'completed transfer(s)')}</strong>}</header>

      {!user && <p>{tx('Connectez-vous pour consulter ou décider une cession.', 'Sign in to review or decide a transfer.')}</p>}
      {user && !state && !error && <p>{tx('Chargement de la situation propriétaire…', 'Loading ownership status…')}</p>}

      {state && !activeTransfer && isCurrentOwner && (
        <div className="cartulary-transfer__action">
          <p>{tx('Proposez la cession au compte Cartularia de l’acquéreur. La proposition expirera après sept jours et deviendra invalide si le Cartulaire évolue.', 'Propose the transfer to the buyer’s Cartularia account. It expires after seven days and becomes invalid if the Cartulary changes.')}</p>
          <label>{tx('Identifiant du compte acquéreur', 'Buyer account ID')}<input value={buyerUid} onChange={(event) => setBuyerUid(event.target.value.trim())} placeholder="wave1-buyer" autoComplete="off" /></label>
          <label className="cartulary-transfer__confirmation"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>{tx('Je confirme humainement vouloir céder ce Cartulaire à ce compte.', 'I personally confirm that I want to transfer this Cartulary to this account.')}</span></label>
          <button type="button" className="button button--primary" disabled={busy || !confirmed || buyerUid.length < 6} onClick={() => void run(
            'transfer_propose',
            () => proposeTransfer({ cartularyId, buyerUid, expectedRevision: state.revision }),
            tx('Proposition de cession enregistrée.', 'Transfer proposal recorded.'),
          )}>{busy ? tx('Traitement…', 'Processing…') : tx('Proposer la cession', 'Propose transfer')}</button>
        </div>
      )}

      {activeTransfer && (
        <article className={`cartulary-transfer__status is-${activeTransfer.status}`}>
          <div><Clock3 aria-hidden="true" /><span><strong>{activeTransfer.status === 'accepted' ? tx('Acceptée — scellement en cours', 'Accepted — sealing in progress') : tx('Proposition en attente', 'Proposal pending')}</strong><small>{tx('Expire le', 'Expires')} {new Intl.DateTimeFormat(language === 'FR' ? 'fr-FR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(activeTransfer.expiresAtIso))}</small></span></div>
          <dl><div><dt>{tx('Révision liée', 'Bound revision')}</dt><dd>R{activeTransfer.sourceRevision}</dd></div><div><dt>{tx('Tête proposée', 'Proposed head')}</dt><dd title={activeTransfer.proposalHead}>{shortHash(activeTransfer.proposalHead)}</dd></div><div><dt>{tx('Consentement cédant', 'Seller consent')}</dt><dd>{activeTransfer.sellerDecision.decisionSource === 'human_confirmed' ? tx('Confirmé', 'Confirmed') : tx('Absent', 'Missing')}</dd></div><div><dt>{tx('Consentement acquéreur', 'Buyer consent')}</dt><dd>{activeTransfer.buyerDecision.decisionSource === 'human_confirmed' ? tx('Confirmé', 'Confirmed') : tx('En attente', 'Pending')}</dd></div></dl>
          {isBuyer && activeTransfer.status === 'proposed' && <div className="cartulary-transfer__action"><label className="cartulary-transfer__confirmation"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>{tx('J’ai contrôlé le Cartulaire et je confirme humainement accepter sa chaîne héritée.', 'I reviewed the Cartulary and personally accept its inherited chain.')}</span></label><div className="cartulary-transfer__buttons"><button type="button" className="button button--primary" disabled={busy || !confirmed} onClick={() => void run('transfer_accept', () => acceptTransfer(activeTransfer), tx('Cession acceptée et changement de propriétaire traité.', 'Transfer accepted and ownership change processed.'))}><CheckCircle2 aria-hidden="true" />{tx('Accepter', 'Accept')}</button><button type="button" className="button button--quiet" disabled={busy} onClick={() => void run('transfer_reject', () => rejectTransfer(activeTransfer), tx('Cession refusée.', 'Transfer rejected.'))}><XCircle aria-hidden="true" />{tx('Refuser', 'Reject')}</button></div></div>}
        </article>
      )}

      {state?.transfers.filter((transfer) => transfer.status === 'completed').slice(0, 1).map((transfer: CartularyTransferDocument) => (
        <article className="cartulary-transfer__completed" key={transfer.transferId}><ShieldCheck aria-hidden="true" /><div><strong>{tx('Chaîne héritée et point de passage vérifiables', 'Inherited chain and handover point are verifiable')}</strong><p>{tx('La tête du cédant a été horodatée et soumise à l’ancrage public avant la continuation sous le nouveau propriétaire.', 'The seller’s head was timestamped and submitted for public anchoring before continuation under the new owner.')}</p><dl><div><dt>{tx('Tête héritée', 'Inherited head')}</dt><dd>{shortHash(transfer.acceptedHead)}</dd></div><div><dt>{tx('Lot de scellement', 'Sealing batch')}</dt><dd>{transfer.sealing?.batchId || '—'}</dd></div><div><dt>{tx('Ancrage public', 'Public anchor')}</dt><dd>{transfer.sealing?.publicAnchoringStatus === 'anchored' ? tx('Confirmé', 'Confirmed') : tx('En attente de confirmation Bitcoin', 'Pending Bitcoin confirmation')}</dd></div></dl></div></article>
      ))}

      {state && state.events.length > 0 && <div className="cartulary-transfer__journal"><strong>{tx('Journal de cession serveur', 'Server transfer journal')}</strong><ol>{[...state.events].reverse().map((event) => <li key={event.eventId}><span>{event.sequence}</span><div><strong>{labels[event.action] || event.action}</strong><small>{new Intl.DateTimeFormat(language === 'FR' ? 'fr-FR' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(event.occurredAtIso))} · {shortHash(event.hash)}</small></div></li>)}</ol></div>}

      <aside><strong>{tx('Périmètre transmis', 'Transferred scope')}</strong><p>{tx('L’acquéreur reçoit la chaîne serveur, les preuves, l’identité et la documentation propres à l’objet. Le carnet local du cédant ne fait pas autorité et n’est pas transféré. Son prix d’acquisition, ses coordonnées, ses assurances, ses lieux de stockage, ses rappels et ses rapports R restent dans une archive privée. Les publications W et le Sceau public sont révoqués et devront être réexaminés.', 'The buyer receives the server chain, proofs, object identity and object documentation. The seller’s local journal is not authoritative and is not transferred. Their purchase price, contact details, insurance, storage locations, reminders and R reports remain in a private archive. W publications and the public Seal are revoked and must be reviewed again.')}</p></aside>
      <aside><strong>{tx('Historique déclaratif distinct', 'Separate declared history')}</strong><p>{tx('La rubrique « Propriétaires précédents » reste une déclaration de provenance. Seuls les événements de ce journal serveur et les relations propriétaire associées font foi dans le protocole de cession Cartularia.', 'The “Previous owners” section remains declared provenance. Only this server journal and its ownership relations are authoritative for the Cartularia transfer protocol.')}</p></aside>
      {notice && <p className="cartulary-transfer__notice" role="status">{notice}</p>}
      {error && <p className="cartulary-transfer__error" role="alert">{error}</p>}
    </section>
  );
}
