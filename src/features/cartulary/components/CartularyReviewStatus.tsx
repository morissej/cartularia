import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
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
 * Relecture du lot B : la confirmation ouverte ne survit ni à la perte de l'enveloppe ni à celle du droit (CL-2) ; le
 * focus suit le formulaire — radio cochée à l'ouverture, bouton d'ouverture au retour (Annuler, Échap, succès), motif
 * `SpecificationAddForm` (A2, WCAG 2.4.3) (CL-1).
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
  const sectionRef = useRef<HTMLElement>(null);
  const actionAllowed = Boolean(canManage && state?.actionable);
  // À la fermeture, le bouton d'ouverture reprend sa place dans le même hôte : le focus lui revient après le rendu (rAF),
  // jamais sur <body>.
  const focusTrigger = () => {
    const host = sectionRef.current;
    window.requestAnimationFrame(() => host?.querySelector<HTMLElement>('.cartulary-review-status__actions button')?.focus());
  };
  // La confirmation en ligne se referme sur le succès (message de statut) ; sur échec, elle reste ouverte avec l'alerte.
  // `open` est lu au moment où la notice arrive (dépendance volontairement limitée à `notice`, motif App.tsx).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (notice && open) { setOpen(false); focusTrigger(); } }, [notice]);
  // Sans enveloppe (session fermée) ou sans droit, la confirmation ouverte ne survit pas : elle ne se réaffiche jamais sans clic.
  useEffect(() => { if (!state || !actionAllowed) setOpen(false); }, [state, actionAllowed]);
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

  const openForm = () => { onClearMessages(); setLevel('partial'); setOpen(true); };
  const cancel = () => { onClearMessages(); setOpen(false); focusTrigger(); };
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!busy) void onConfirm(level); };
  const escape = (event: KeyboardEvent<HTMLFormElement>) => { if (event.key !== 'Escape' || busy) return; event.preventDefault(); cancel(); };

  return (
    <section ref={sectionRef} className="cartulary-review-status" aria-labelledby={`${id}-eyebrow`} data-review-state={state.kind}>
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
        <form className="cartulary-review-status__form" onSubmit={submit} onKeyDown={escape}>
          <fieldset disabled={busy}>
            <legend>{tx('Portée de la revue', 'Scope of the review')}</legend>
            <label><input type="radio" name={`${id}-level`} value="partial" autoFocus checked={level === 'partial'} onChange={() => setLevel('partial')} />{tx('Revue partielle', 'Partial review')}</label>
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
