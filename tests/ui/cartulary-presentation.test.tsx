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

  // V5 relecture (A9 MA12) : parité EN du nom du crayon, dans ses deux états.
  it('nomme le crayon en anglais sous EN, dans ses deux états', () => {
    const { rerender } = render(<BlockMarkers selection={markerState({ language: 'EN', edit: { active: false, onToggle: vi.fn() } })} label="Origins" />);
    expect(screen.getByRole('button', { name: 'Edit Origins' }).getAttribute('title')).toBe('Edit text');
    rerender(<BlockMarkers selection={markerState({ language: 'EN', edit: { active: true, onToggle: vi.fn() } })} label="Origins" />);
    expect(screen.getByRole('button', { name: 'Finish editing Origins' }).getAttribute('aria-pressed')).toBe('true');
    rerender(<BlockMarkers selection={markerState({ edit: { active: true, onToggle: vi.fn() } })} label="Origines" />);
    expect(screen.getByRole('button', { name: 'Terminer la modification de Origines' })).toBeTruthy();
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

  // V5 relecture (A9 MA4) : sans onActivate (lecteur sans droit de gérer), aucun rôle bouton, aucune affordance inerte.
  it('sans onActivate, rend des paragraphes purs : ni rôle bouton, ni tabIndex, ni titre', () => {
    const { container } = render(<EditableParagraphs values={['Texte initial', 'Second paragraphe']} editing={false} onChange={vi.fn()} aiField="condition.summary.paragraphs[]" />);
    expect(screen.queryByRole('button')).toBeNull();
    const host = container.firstElementChild as HTMLElement;
    expect(host.getAttribute('role')).toBeNull();
    expect(host.getAttribute('tabindex')).toBeNull();
    expect(host.getAttribute('title')).toBeNull();
    expect(host.classList.contains('editable-click-target')).toBe(false);
    expect(container.querySelectorAll('p')).toHaveLength(2);
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

  // V5 relecture (A3) : le bouton d'activation annonce son action et garde un nom si la valeur a été effacée.
  it('annonce « Cliquer pour modifier » et prend le libellé pour nom quand la valeur est vide', () => {
    const { rerender } = render(<EditableFact aiField="condition.summary.lastCondition" value="Conforme" editing={false} onChange={vi.fn()} onActivate={vi.fn()} label="Dernier état" />);
    expect(screen.getByRole('button', { name: 'Conforme' }).getAttribute('title')).toBe('Cliquer pour modifier');
    expect(screen.getByRole('button', { name: 'Conforme' }).getAttribute('aria-label')).toBeNull();

    rerender(<EditableFact aiField="condition.summary.lastCondition" value="" editing={false} onChange={vi.fn()} onActivate={vi.fn()} label="Dernier état" />);
    expect(screen.getByRole('button', { name: 'Dernier état' })).toBeTruthy();

    rerender(<EditableFact aiField="condition.summary.lastCondition" value="" editing={false} onChange={vi.fn()} onActivate={vi.fn()} label="Latest condition" language="EN" />);
    expect(screen.getByRole('button', { name: 'Latest condition' }).getAttribute('title')).toBe('Click to edit');
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
