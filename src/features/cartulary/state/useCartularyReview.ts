import { useCallback, useMemo, useState } from 'react';
import type { CartularyEnvelope } from '../../../domain/cartulary.ts';
import { deriveCartularyReviewState, type CartularyReviewLevel, type CartularyReviewState } from '../../../../scripts/lib/cartulary-review-policy.mjs';

/**
 * État de la revue du propriétaire (V5 point 4, lot B), calqué sur `useGenericSectionEdits` : le hook ne connaît
 * ni la page ni le composant. L'état affiché dérive de l'enveloppe autoritaire par la politique partagée
 * (`deriveCartularyReviewState`) ; `confirm` délègue à l'action du hook autoritaire et n'agit que pour le
 * propriétaire éditeur (`canManage`), sur un cycle de vie admis (`actionable`), une fois à la fois.
 * Sans enveloppe (démonstration, chargement, session fermée), `state` vaut `null` et rien ne se rend.
 */
export function useCartularyReview({ envelope, canManage, confirm }: {
  envelope: CartularyEnvelope | null | undefined;
  canManage: boolean;
  confirm?: (level: CartularyReviewLevel) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const state = useMemo<CartularyReviewState | null>(() => envelope ? deriveCartularyReviewState(envelope) : null, [envelope]);
  const actionable = Boolean(state?.actionable);

  const clearMessages = useCallback(() => { setError(''); setNotice(''); }, []);

  const confirmReview = useCallback(async (level: CartularyReviewLevel) => {
    if (!confirm || !canManage || !actionable || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await confirm(level);
      setNotice('Revue confirmée dans le Cartulaire et son Registre.');
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : 'La revue n’a pas pu être confirmée. L’état affiché est conservé.');
    } finally {
      setBusy(false);
    }
  }, [actionable, busy, canManage, confirm]);

  return { state, busy, notice, error, confirm: confirmReview, clearMessages };
}

export type CartularyReview = ReturnType<typeof useCartularyReview>;
