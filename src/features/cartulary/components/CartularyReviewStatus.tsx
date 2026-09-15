import { useEffect, useId, useState, type FormEvent } from 'react';
import type { CartularyReviewLevel, CartularyReviewState } from '../../../../scripts/lib/cartulary-review-policy.mjs';
import type { InterfaceLanguage } from '../../../utils/interfaceState.ts';
import { formatLocalDate } from '../../../utils/formatting.ts';

/**
 * V5 point 4 (P-C5, lot B) : bloc « Revue du propriétaire » de la page Accueil, composant pur (aucune donnée
 * distante, aucune branche par marque ni par démonstration). Il rend l'état dérivé de l'enveloppe autoritaire :
 * - `null` : rien (démonstration, chargement, session fermée — aucune enveloppe) ;
 * - `pending` : « Déclaré, non revu », et, pour le propriétaire éditeur sur un cycle admis, « Marquer comme revu » ;
 * - `reviewed` : « Revu par le propriétaire le … · Partiel | Complet », et « Mettre à jour la revue » (rejouable).
 * La confirmation est en ligne (deux paliers, D2 (b)), jamais une modale ; elle est datée par le serveur.
 * « Revu par le propriétaire » n'est jamais « vérifié » : aucun sceau, aucune preuve de champ n'est touché.
 */
export interface CartularyReviewStatusProps {
  state: CartularyReviewState | null;
  language: InterfaceLanguage;
  canManage: boolean;
  busy: boolean;
  notice: string;
  error: string;
  onConfirm: (level: CartularyReviewLevel) => Promise<void> | void;
  onClearMessages: () => void;
}

export function CartularyReviewStatus({ state, language, canManage, busy, notice, error, onConfirm, onClearMessages }: CartularyReviewStatusProps) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<CartularyReviewLevel>('partial');
  const id = useId();
  // La confirmation en ligne se referme sur le succès (message de statut) ; sur échec, elle reste ouverte avec l'alerte.
  useEffect(() => { if (notice) setOpen(false); }, [notice]);
  if (!state) return null;

  const tx = (french: string, english: string) => language === 'FR' ? french : english;
  const levelLabel = (value: string | null) => value === 'partial' ? tx('Partiel', 'Partial') : value === 'complete' ? tx('Complet', 'Complete') : null;
  const reviewedOn = state.kind === 'reviewed' && state.reviewedAt
    ? formatLocalDate(state.reviewedAt, language === 'FR' ? 'fr-FR' : 'en-GB', tx('date indisponible', 'date unavailable'))
    : null;
  const title = state.kind === 'pending'
    ? tx('Déclaré, non revu', 'Declared, not reviewed')
    : [
        reviewedOn ? tx(`Revu par le propriétaire le ${reviewedOn}`, `Reviewed by the owner on ${reviewedOn}`) : tx('Revu par le propriétaire', 'Reviewed by the owner'),
        levelLabel(state.level),
      ].filter(Boolean).join(' · ');
  const detail = state.kind === 'pending'
    ? tx('Les informations et pièces sont celles déclarées par le propriétaire.', 'The information and documents are those declared by the owner.')
    : tx('La date et le palier de cette revue sont inscrits dans la chaîne de preuves du Cartulaire.', 'The date and level of this review are recorded in the Cartulary’s chain of evidence.');
  const actionAllowed = canManage && state.actionable;

  const openForm = () => { onClearMessages(); setLevel('partial'); setOpen(true); };
  const cancel = () => { onClearMessages(); setOpen(false); };
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!busy) void onConfirm(level); };

  return (
    <section className="cartulary-review-status" aria-labelledby={`${id}-eyebrow`} data-review-state={state.kind}>
      <header className="cartulary-review-status__header">
        <span className="eyebrow" id={`${id}-eyebrow`}>{tx('Revue du propriétaire', 'Owner review')}</span>
        <h2>{title}</h2>
        <p>{detail}</p>
      </header>
      {notice && <p className="cartulary-review-status__notice" role="status">{notice}</p>}
      {error && <p className="cartulary-review-status__error" role="alert">{error}</p>}
      {actionAllowed && !open && (
        <div className="cartulary-review-status__actions">
          <button type="button" className="button button--quiet" disabled={busy} onClick={openForm}>
            {state.kind === 'pending' ? tx('Marquer comme revu', 'Mark as reviewed') : tx('Mettre à jour la revue', 'Update the review')}
          </button>
        </div>
      )}
      {actionAllowed && open && (
        <form className="cartulary-review-status__form" onSubmit={submit}>
          <fieldset disabled={busy}>
            <legend>{tx('Portée de la revue', 'Scope of the review')}</legend>
            <label><input type="radio" name={`${id}-level`} value="partial" checked={level === 'partial'} onChange={() => setLevel('partial')} />{tx('Revue partielle', 'Partial review')}</label>
            <label><input type="radio" name={`${id}-level`} value="complete" checked={level === 'complete'} onChange={() => setLevel('complete')} />{tx('Dossier complet', 'Complete record')}</label>
          </fieldset>
          <p className="cartulary-review-status__note">{tx('Cette confirmation est datée par le serveur et inscrite dans la chaîne de preuves du Cartulaire. Elle atteste votre relecture, pas une vérification par un tiers.', 'This confirmation is dated by the server and recorded in the Cartulary’s chain of evidence. It attests your own re-reading, not a third-party check.')}</p>
          <div className="cartulary-review-status__actions">
            <button type="submit" className="button button--primary" disabled={busy}>{busy ? tx('Confirmation en cours…', 'Confirming…') : tx('Confirmer la revue', 'Confirm the review')}</button>
            <button type="button" className="button button--quiet" disabled={busy} onClick={cancel}>{tx('Annuler', 'Cancel')}</button>
          </div>
        </form>
      )}
    </section>
  );
}
