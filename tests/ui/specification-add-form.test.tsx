import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SpecificationAddForm } from '../../src/features/cartulary/components/CartularyPresentation.tsx';
import type { InterfaceLanguage } from '../../src/utils/interfaceState.ts';

// V5 point 3 (P-C4) : la ligne n'est créée qu'à la validation d'un libellé non vide et unique dans le groupe.

const renderForm = (overrides: { language?: InterfaceLanguage; existingLabels?: readonly string[] } = {}) => {
  const onAdd = vi.fn();
  const onClose = vi.fn();
  render(
    <SpecificationAddForm
      language={overrides.language ?? 'FR'}
      groupTitle="Autres"
      existingLabels={overrides.existingLabels ?? ['Seconde', 'Couronne', 'Fond']}
      onAdd={onAdd}
      onClose={onClose}
    />,
  );
  return { onAdd, onClose };
};

describe('formulaire d’ajout d’une spécification', () => {
  it('rend un formulaire nommé, « Ajouter » désactivé et le focus dans « Libellé »', () => {
    renderForm();

    expect(screen.getByRole('form', { name: 'Ajouter une donnée dans Autres' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Ajouter' }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Libellé' }));
    expect(screen.getByRole('textbox', { name: 'Valeur' })).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('refuse un libellé blanc : Entrée ne crée rien et « Ajouter » reste désactivé', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderForm();

    await user.type(screen.getByRole('textbox', { name: 'Libellé' }), '   ');
    await user.keyboard('{Enter}');

    expect(onAdd).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Ajouter' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('ne crée la ligne qu’à la validation, avec libellé et valeur rognés, puis vide le formulaire sans le fermer', async () => {
    const user = userEvent.setup();
    const { onAdd, onClose } = renderForm();
    const labelInput = screen.getByRole('textbox', { name: 'Libellé' }) as HTMLInputElement;
    const valueInput = screen.getByRole('textbox', { name: 'Valeur' }) as HTMLInputElement;

    await user.type(labelInput, ' Réserve de marche ');
    expect(onAdd).not.toHaveBeenCalled();
    await user.type(valueInput, '48 h ');
    expect(onAdd).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith('Réserve de marche', '48 h');
    expect(labelInput.value).toBe('');
    expect(valueInput.value).toBe('');
    expect(screen.getByRole('form', { name: 'Ajouter une donnée dans Autres' })).toBeTruthy();
    expect(document.activeElement).toBe(labelInput);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('signale un doublon à la casse et aux espaces près, relié au champ, et bloque l’ajout', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderForm({ existingLabels: ['Couronne'] });
    const labelInput = screen.getByRole('textbox', { name: 'Libellé' });

    await user.type(labelInput, ' couronne ');

    const message = screen.getByRole('status');
    expect(message.textContent).toBe('Ce libellé existe déjà dans ce groupe.');
    expect(labelInput.getAttribute('aria-invalid')).toBe('true');
    expect(labelInput.getAttribute('aria-describedby')).toBe(message.id);
    expect(message.id).not.toBe('');
    expect((screen.getByRole('button', { name: 'Ajouter' }) as HTMLButtonElement).disabled).toBe(true);
    await user.keyboard('{Enter}');
    expect(onAdd).not.toHaveBeenCalled();

    await user.clear(labelInput);
    await user.type(labelInput, 'Couronne vissée');
    expect(screen.queryByRole('status')).toBeNull();
    expect(labelInput.getAttribute('aria-invalid')).toBeNull();
    expect(labelInput.getAttribute('aria-describedby')).toBeNull();
    expect((screen.getByRole('button', { name: 'Ajouter' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('se ferme par Échap ou par « Terminer »', async () => {
    const user = userEvent.setup();
    const { onAdd, onClose } = renderForm();

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Terminer' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('offre la parité EN : nom du formulaire, champs, boutons et message de doublon', async () => {
    const user = userEvent.setup();
    const { onAdd, onClose } = renderForm({ language: 'EN', existingLabels: ['Crown'] });

    expect(screen.getByRole('form', { name: 'Add data to Autres' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Value' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    await user.type(screen.getByRole('textbox', { name: 'Label' }), 'crown');
    expect(screen.getByRole('status').textContent).toBe('This label already exists in this group.');
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);

    await user.clear(screen.getByRole('textbox', { name: 'Label' }));
    await user.type(screen.getByRole('textbox', { name: 'Label' }), 'Power reserve');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(onAdd).toHaveBeenCalledWith('Power reserve', '');
    expect(onClose).not.toHaveBeenCalled();
  });
});
