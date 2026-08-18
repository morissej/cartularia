import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  BlockMarkers,
  ContentMarker,
  EditableParagraphs,
  type BlockMarkerState,
} from '../../src/features/cartulary/components/CartularyPresentation.tsx';

const markerState = (overrides: Partial<BlockMarkerState> = {}): BlockMarkerState => ({
  blockId: 'cover-watch',
  language: 'FR',
  website: { active: false, pendingValidation: false, onToggle: vi.fn() },
  report: { active: false, pendingValidation: false, onToggle: vi.fn() },
  community: { active: false, pendingValidation: false, onToggle: vi.fn() },
  ...overrides,
});

describe('marqueurs de publication W/R/C', () => {
  it('transmet le libellé exact lors de l’activation', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<ContentMarker marker="W" active={false} label="Accueil" onToggle={onToggle} instance="cover-watch" language="FR" />);

    const button = screen.getByRole('button', { name: 'Ajouter Accueil au Watch website' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    await user.click(button);
    expect(onToggle).toHaveBeenCalledWith('Accueil');
  });

  it('préserve trois décisions indépendantes et le contrôle d’édition', async () => {
    const user = userEvent.setup();
    const selection = markerState({ edit: { active: false, onToggle: vi.fn() } });
    render(<BlockMarkers selection={selection} label="Origines" />);

    await user.click(screen.getByRole('button', { name: 'Ajouter Origines au Watch website' }));
    await user.click(screen.getByRole('button', { name: 'Ajouter Origines au rapport PDF' }));
    await user.click(screen.getByRole('button', { name: 'Ajouter Origines au Cercle' }));
    await user.click(screen.getByRole('button', { name: 'Modifier Origines' }));

    expect(selection.website.onToggle).toHaveBeenCalledOnce();
    expect(selection.report.onToggle).toHaveBeenCalledOnce();
    expect(selection.community.onToggle).toHaveBeenCalledOnce();
    expect(selection.edit?.onToggle).toHaveBeenCalledOnce();
  });
});

describe('contenu éditable', () => {
  it('s’active au clavier et propage ensuite les modifications', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    const onChange = vi.fn();
    const { rerender } = render(<EditableParagraphs values={['Texte initial']} editing={false} onActivate={onActivate} onChange={onChange} />);

    screen.getByRole('button').focus();
    await user.keyboard('{Enter}');
    expect(onActivate).toHaveBeenCalledOnce();

    rerender(<EditableParagraphs values={['Texte initial']} editing onActivate={onActivate} onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Modifier le paragraphe 1' }), { target: { value: 'Texte révisé' } });
    expect(onChange).toHaveBeenLastCalledWith(0, 'Texte révisé');
  });
});
