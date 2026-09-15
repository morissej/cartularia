import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCartularyReview } from '../../src/features/cartulary/state/useCartularyReview.ts';
import type { CartularyEnvelope } from '../../src/domain/cartulary.ts';

/**
 * V5 point 4 (P-C5, lot B, § 5.12) : le hook de revue dérive son état de l'enveloppe par la politique partagée,
 * refuse l'action sans droit de gérer, sur un cycle non admis ou pendant une confirmation, pose la notice sur
 * succès et conserve l'état sur échec (message de l'erreur).
 */

const envelope = (overrides: Partial<CartularyEnvelope> = {}) => ({
  id: 'cart_review', lifecycleStatus: 'review', completenessLevel: 'imported_unreviewed', lastVerifiedAt: null, revision: 1, ...overrides,
} as unknown as CartularyEnvelope);

describe('useCartularyReview', () => {
  it('sans enveloppe, aucun état : rien ne se rend et confirm est inerte', async () => {
    const confirm = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useCartularyReview({ envelope: null, canManage: true, confirm }));
    expect(result.current.state).toBeNull();
    await act(() => result.current.confirm('partial'));
    expect(confirm).not.toHaveBeenCalled();
  });

  it('dérive pending puis reviewed de l’enveloppe autoritaire, par la politique partagée', () => {
    const { result, rerender } = renderHook(({ current }) => useCartularyReview({ envelope: current, canManage: false }), { initialProps: { current: envelope() } });
    expect(result.current.state).toEqual({ kind: 'pending', actionable: true });
    rerender({ current: envelope({ lifecycleStatus: 'active', completenessLevel: 'partial', lastVerifiedAt: '2026-09-15T10:00:00.000Z' }) });
    expect(result.current.state).toEqual({ kind: 'reviewed', reviewedAt: '2026-09-15T10:00:00.000Z', level: 'partial', actionable: true });
    rerender({ current: envelope({ lifecycleStatus: 'suspended' }) });
    expect(result.current.state).toEqual({ kind: 'pending', actionable: false });
  });

  it('refuse la confirmation sans droit de gérer : aucun appel, aucun message', async () => {
    const confirm = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useCartularyReview({ envelope: envelope(), canManage: false, confirm }));
    await act(() => result.current.confirm('partial'));
    expect(confirm).not.toHaveBeenCalled();
    expect(result.current.notice).toBe('');
    expect(result.current.error).toBe('');
  });

  it('refuse la confirmation sur un cycle de vie non admis, même avec le droit de gérer', async () => {
    const confirm = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useCartularyReview({ envelope: envelope({ lifecycleStatus: 'archived' }), canManage: true, confirm }));
    await act(() => result.current.confirm('complete'));
    expect(confirm).not.toHaveBeenCalled();
  });

  it('succès : busy pendant l’appel, puis notice ; clearMessages l’efface', async () => {
    let release: () => void = () => {};
    const confirm = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const { result } = renderHook(() => useCartularyReview({ envelope: envelope(), canManage: true, confirm }));
    let pending: Promise<void> = Promise.resolve();
    act(() => { pending = result.current.confirm('complete'); });
    expect(result.current.busy).toBe(true);
    await act(() => result.current.confirm('partial'));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith('complete');
    await act(async () => { release(); await pending; });
    expect(result.current.busy).toBe(false);
    expect(result.current.notice).toBe('Revue confirmée dans le Cartulaire et son Registre.');
    expect(result.current.error).toBe('');
    act(() => result.current.clearMessages());
    expect(result.current.notice).toBe('');
  });

  it('échec : le message de l’erreur est exposé, l’état dérivé est conservé, l’action reste possible', async () => {
    const confirm = vi.fn().mockRejectedValue(new Error('Le Cartulaire a changé. Rechargez les données avant de confirmer la revue.'));
    const { result } = renderHook(() => useCartularyReview({ envelope: envelope(), canManage: true, confirm }));
    await act(() => result.current.confirm('partial'));
    expect(result.current.error).toBe('Le Cartulaire a changé. Rechargez les données avant de confirmer la revue.');
    expect(result.current.notice).toBe('');
    expect(result.current.busy).toBe(false);
    expect(result.current.state).toEqual({ kind: 'pending', actionable: true });
    await act(() => result.current.confirm('partial'));
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('un rejet sans message reçoit un texte de repli non technique', async () => {
    const confirm = vi.fn().mockRejectedValue('permission-denied');
    const { result } = renderHook(() => useCartularyReview({ envelope: envelope(), canManage: true, confirm }));
    await act(() => result.current.confirm('partial'));
    expect(result.current.error).toBe('La revue n’a pas pu être confirmée. L’état affiché est conservé.');
  });
});
