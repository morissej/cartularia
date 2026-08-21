import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  BlockMarkers,
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

describe('contrôles des blocs métier', () => {
  it('ne rend plus aucun sélecteur de publication dans les blocs', () => {
    render(<BlockMarkers selection={markerState()} label="Accueil" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('préserve seulement le contrôle d’édition local', async () => {
    const user = userEvent.setup();
    const selection = markerState({ edit: { active: false, onToggle: vi.fn() } });
    render(<BlockMarkers selection={selection} label="Origines" />);

    await user.click(screen.getByRole('button', { name: 'Modifier Origines' }));

    expect(selection.website.onToggle).not.toHaveBeenCalled();
    expect(selection.report.onToggle).not.toHaveBeenCalled();
    expect(selection.community.onToggle).not.toHaveBeenCalled();
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
