import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  BlockMarkers,
  EditableFact,
  EditableParagraphs,
  type BlockMarkerState,
} from '../../src/features/cartulary/components/CartularyPresentation.tsx';

const markerState = (overrides: Partial<BlockMarkerState> = {}): BlockMarkerState => ({
  blockId: 'cover-watch',
  language: 'FR',
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

    expect(screen.getAllByRole('button')).toHaveLength(1);
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

// V5 point 1 : fait éditable à la demande — champ pendant l'édition, bouton d'entrée si le droit le permet, texte pur sinon.
describe('EditableFact', () => {
  it('rend un champ nommé pendant l’édition et propage la saisie', () => {
    const onChange = vi.fn();
    render(<EditableFact aiField="condition.summary.lastCondition" value="Révisé" editing onChange={onChange} label="Dernier état" />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Dernier état' }), { target: { value: 'Révisé en atelier' } });
    expect(onChange).toHaveBeenLastCalledWith('Révisé en atelier');
  });

  it('propose un bouton portant la valeur quand l’activation est possible', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    render(<EditableFact aiField="condition.summary.conclusion" value="Conforme" editing={false} onChange={vi.fn()} onActivate={onActivate} label="Conclusion" />);
    await user.click(screen.getByRole('button', { name: 'Conforme' }));
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('rend un texte pur, ancré pour l’IA, sans aucune affordance en lecture', () => {
    const { container } = render(<EditableFact aiField="condition.summary.openPoint" value="Aucun point ouvert" editing={false} onChange={vi.fn()} label="Point ouvert" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(container.textContent).toContain('Aucun point ouvert');
    expect(container.querySelector('[data-ai-field="condition.summary.openPoint"]')).not.toBeNull();
    expect(container.querySelector('.editable-click-target, .editable-fact')).toBeNull();
  });
});
