import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CartularyReviewStatus, type CartularyReviewStatusProps } from '../../src/features/cartulary/components/CartularyReviewStatus.tsx';

/**
 * V5 point 4 (P-C5, lot B, § 5.10) : le bloc « Revue du propriétaire » est un composant pur. Il ne rend rien sans
 * enveloppe, nomme l'état sans jamais dire « vérifié », n'offre l'action qu'au propriétaire éditeur sur un cycle
 * admis, confirme en ligne (deux paliers dans un fieldset, « Revue partielle » par défaut) et reflète busy/erreur/notice.
 * Relecture du lot B : focus suivi (CL-1, WCAG 2.4.3), confirmation refermée sans enveloppe ou sans droit (CL-2),
 * palier remis à « partiel » à chaque ouverture, « Complet » et « date indisponible » nommés (CL-5 : C7, C15, C18).
 */

const PENDING = { kind: 'pending', actionable: true } as const;
const REVIEWED = { kind: 'reviewed', reviewedAt: '2026-09-15T10:00:00.000Z', level: 'partial', actionable: true } as const;

const renderStatus = (overrides: Partial<CartularyReviewStatusProps> = {}) => {
  const props: CartularyReviewStatusProps = {
    state: PENDING, language: 'FR', canManage: false, busy: false, notice: '', error: '',
    onConfirm: vi.fn(), onClearMessages: vi.fn(), ...overrides,
  };
  const view = render(<CartularyReviewStatus {...props} />);
  return { ...view, props, rerender: (next: Partial<CartularyReviewStatusProps>) => view.rerender(<CartularyReviewStatus {...props} {...next} />) };
};

describe('CartularyReviewStatus', () => {
  it('ne rend rien sans état (démonstration, chargement, session fermée)', () => {
    const { container } = renderStatus({ state: null, canManage: true });
    expect(container.innerHTML).toBe('');
  });

  it('nomme l’état « Déclaré, non revu » pour un lecteur sans droit de gérer, sans aucun bouton', () => {
    const { container } = renderStatus({ state: PENDING, canManage: false });
    const region = screen.getByRole('region', { name: 'Revue du propriétaire' });
    expect(region.textContent).toContain('Déclaré, non revu');
    expect(region.textContent).toContain('Les informations et pièces sont celles déclarées par le propriétaire.');
    expect(container.querySelector('button, input')).toBeNull();
    expect(region.getAttribute('data-review-state')).toBe('pending');
  });

  it('le propriétaire éditeur confirme en ligne : radios dans un fieldset, « Revue partielle » par défaut, onConfirm(\'partial\')', () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onClearMessages = vi.fn();
    renderStatus({ state: PENDING, canManage: true, onConfirm, onClearMessages });
    expect(screen.queryByRole('radio')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Marquer comme revu' }));
    expect(onClearMessages).toHaveBeenCalledTimes(1);
    const group = screen.getByRole('group', { name: 'Portée de la revue' });
    expect(group.tagName).toBe('FIELDSET');
    expect(group.querySelector('legend')?.textContent).toBe('Portée de la revue');
    const partial = screen.getByRole('radio', { name: 'Revue partielle' }) as HTMLInputElement;
    const complete = screen.getByRole('radio', { name: 'Dossier complet' }) as HTMLInputElement;
    expect(partial.checked).toBe(true);
    expect(complete.checked).toBe(false);
    expect(screen.getByText(/datée par le serveur et inscrite dans la chaîne de preuves du Cartulaire/).textContent).toContain('Elle atteste votre relecture, pas une vérification par un tiers.');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la revue' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('partial');
  });

  it('« Dossier complet » coché → onConfirm(\'complete\') ; « Annuler » referme sans appel', () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onClearMessages = vi.fn();
    renderStatus({ state: PENDING, canManage: true, onConfirm, onClearMessages });
    fireEvent.click(screen.getByRole('button', { name: 'Marquer comme revu' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Dossier complet' }));
    expect((screen.getByRole('radio', { name: 'Dossier complet' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la revue' }));
    expect(onConfirm).toHaveBeenCalledWith('complete');
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByRole('button', { name: 'Marquer comme revu' })).toBeTruthy();
    expect(onClearMessages).toHaveBeenCalledTimes(2);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('un Cartulaire revu affiche la date et le palier, et propose « Mettre à jour la revue »', () => {
    renderStatus({ state: REVIEWED, canManage: true });
    const region = screen.getByRole('region', { name: 'Revue du propriétaire' });
    expect(region.textContent).toMatch(/Revu par le propriétaire le \d{2}\/\d{2}\/\d{4} · Partiel/);
    expect(region.textContent).not.toContain('Déclaré, non revu');
    expect(region.getAttribute('data-review-state')).toBe('reviewed');
    fireEvent.click(screen.getByRole('button', { name: 'Mettre à jour la revue' }));
    expect((screen.getByRole('radio', { name: 'Revue partielle' }) as HTMLInputElement).checked).toBe(true);
  });

  it('un cycle de vie non admis (suspendu, cédé, archivé) garde le texte et retire toute action, même au propriétaire', () => {
    const { container } = renderStatus({ state: { kind: 'pending', actionable: false }, canManage: true });
    expect(screen.getByRole('region', { name: 'Revue du propriétaire' }).textContent).toContain('Déclaré, non revu');
    expect(container.querySelector('button, input')).toBeNull();
  });

  it('l’erreur est une alerte, le succès un statut qui referme la confirmation, busy désactive tout', () => {
    const { rerender } = renderStatus({ state: PENDING, canManage: true });
    fireEvent.click(screen.getByRole('button', { name: 'Marquer comme revu' }));
    rerender({ busy: true });
    expect(screen.getByRole('button', { name: 'Confirmation en cours…' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Annuler' }).hasAttribute('disabled')).toBe(true);
    expect((screen.getByRole('group', { name: 'Portée de la revue' }) as HTMLFieldSetElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Annuler' }), { key: 'Escape' });
    expect(screen.getByRole('group', { name: 'Portée de la revue' })).toBeTruthy();
    rerender({ busy: false, error: 'Le Cartulaire a changé. Rechargez les données avant de confirmer la revue.' });
    expect(screen.getByRole('alert').textContent).toBe('Le Cartulaire a changé. Rechargez les données avant de confirmer la revue.');
    expect(screen.getByRole('button', { name: 'Confirmer la revue' })).toBeTruthy();
    rerender({ error: '', notice: 'Revue confirmée dans le Cartulaire et son Registre.' });
    expect(screen.getByRole('status').textContent).toBe('Revue confirmée dans le Cartulaire et son Registre.');
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('busy sans confirmation ouverte désactive aussi le bouton d’ouverture', () => {
    renderStatus({ state: PENDING, canManage: true, busy: true });
    expect(screen.getByRole('button', { name: 'Marquer comme revu' }).hasAttribute('disabled')).toBe(true);
  });

  it('ne dit jamais « vérifié » : la revue du propriétaire n’est pas un sceau', () => {
    for (const state of [PENDING, REVIEWED, { kind: 'reviewed', reviewedAt: null, level: 'complete', actionable: true } as const]) {
      const { container, unmount } = renderStatus({ state, canManage: true });
      if (state.actionable) fireEvent.click(screen.getByRole('button'));
      expect(container.textContent).not.toMatch(/vérifié/i);
      unmount();
    }
  });

  it('le focus suit la confirmation : radio cochée à l’ouverture, bouton d’ouverture après « Annuler », Échap et le succès (WCAG 2.4.3)', async () => {
    const onClearMessages = vi.fn();
    const { rerender } = renderStatus({ state: PENDING, canManage: true, onClearMessages });
    const open = screen.getByRole('button', { name: 'Marquer comme revu' });
    open.focus();
    fireEvent.click(open);
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Revue partielle' }));
    // « Annuler » : le formulaire est démonté, le bouton d'ouverture reprend le focus (rAF), jamais <body>.
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('radio')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Marquer comme revu' })));
    // Échap referme de la même façon (messages effacés, aucun appel de confirmation).
    fireEvent.click(screen.getByRole('button', { name: 'Marquer comme revu' }));
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Dossier complet' }), { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Portée de la revue' })).toBeNull();
    expect(onClearMessages).toHaveBeenCalledTimes(4);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Marquer comme revu' })));
    // Succès : la notice referme la confirmation et le focus revient sur « Mettre à jour la revue ».
    fireEvent.click(screen.getByRole('button', { name: 'Marquer comme revu' }));
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Revue partielle' }));
    rerender({ state: REVIEWED, notice: 'Revue confirmée dans le Cartulaire et son Registre.' });
    expect(screen.queryByRole('radio')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Mettre à jour la revue' })));
    expect(document.activeElement).not.toBe(document.body);
  });

  it('une notice reçue sans confirmation ouverte ne déplace pas le focus (retour sur la page Accueil après un succès)', async () => {
    renderStatus({ state: REVIEWED, canManage: true, notice: 'Revue confirmée dans le Cartulaire et son Registre.' });
    expect(screen.getByRole('status')).toBeTruthy();
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
    expect(document.activeElement).toBe(document.body);
  });

  it('la confirmation ouverte ne survit ni à la perte de l’enveloppe (session fermée puis rouverte) ni à celle du droit de gérer', () => {
    const { rerender, container } = renderStatus({ state: PENDING, canManage: true });
    fireEvent.click(screen.getByRole('button', { name: 'Marquer comme revu' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Dossier complet' }));
    rerender({ state: null });
    expect(container.innerHTML).toBe('');
    rerender({ state: PENDING });
    expect(screen.queryByRole('group', { name: 'Portée de la revue' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Marquer comme revu' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Marquer comme revu' }));
    expect((screen.getByRole('radio', { name: 'Revue partielle' }) as HTMLInputElement).checked).toBe(true);
    rerender({ canManage: false });
    expect(container.querySelector('button, input')).toBeNull();
    rerender({ canManage: true });
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByRole('button', { name: 'Marquer comme revu' })).toBeTruthy();
    // Un cycle devenu inactif referme aussi ; sur échec (enveloppe inchangée), elle reste ouverte.
    fireEvent.click(screen.getByRole('button', { name: 'Marquer comme revu' }));
    rerender({ error: 'Le Cartulaire a changé. Rechargez les données avant de confirmer la revue.' });
    expect(screen.getByRole('group', { name: 'Portée de la revue' })).toBeTruthy();
    rerender({ state: { kind: 'pending', actionable: false } });
    rerender({ state: PENDING });
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('après « Annuler », la réouverture repart sur « Revue partielle » : le palier choisi n’est pas conservé', () => {
    renderStatus({ state: PENDING, canManage: true });
    fireEvent.click(screen.getByRole('button', { name: 'Marquer comme revu' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Dossier complet' }));
    expect((screen.getByRole('radio', { name: 'Dossier complet' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    fireEvent.click(screen.getByRole('button', { name: 'Marquer comme revu' }));
    expect((screen.getByRole('radio', { name: 'Revue partielle' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: 'Dossier complet' }) as HTMLInputElement).checked).toBe(false);
  });

  it('nomme le palier « Complet » et, sur une date illisible, « date indisponible » — jamais « à vérifier »', () => {
    const { rerender } = renderStatus({ state: { ...REVIEWED, level: 'complete' }, canManage: true });
    const region = () => screen.getByRole('region', { name: /Revue du propriétaire|Owner review/ }).textContent ?? '';
    expect(region()).toMatch(/Revu par le propriétaire le \d{2}\/\d{2}\/\d{4} · Complet/);
    rerender({ state: { ...REVIEWED, reviewedAt: 'not-a-date' } });
    expect(region()).toContain('Revu par le propriétaire le date indisponible · Partiel');
    expect(region()).not.toMatch(/à vérifier/i);
    rerender({ state: { ...REVIEWED, reviewedAt: 'not-a-date', level: 'complete' }, language: 'EN' });
    expect(region()).toContain('Reviewed by the owner on date unavailable · Complete');
    expect(region()).not.toMatch(/to be checked|verified/i);
  });

  it('garde la parité anglaise de chaque texte', () => {
    const { container, rerender } = renderStatus({ state: PENDING, canManage: true, language: 'EN' });
    expect(screen.getByRole('region', { name: 'Owner review' }).textContent).toContain('Declared, not reviewed');
    fireEvent.click(screen.getByRole('button', { name: 'Mark as reviewed' }));
    expect(screen.getByRole('group', { name: 'Scope of the review' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Partial review' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Complete record' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm the review' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(container.textContent).not.toMatch(/[àéèç]/);
    rerender({ state: REVIEWED, language: 'EN', busy: true });
    expect(screen.getByRole('region', { name: 'Owner review' }).textContent).toMatch(/Reviewed by the owner on \d{2}\/\d{2}\/\d{4} · Partial/);
    expect(screen.getByRole('button', { name: 'Confirming…' })).toBeTruthy();
  });
});
