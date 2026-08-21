import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { RegistryFilterPanel } from '../../src/features/registry/RegistryFilterPanel.tsx';

describe('panneau de filtres du Registre', () => {
  it('reste compact par défaut et se déplie ou se replie en un clic', async () => {
    const user = userEvent.setup();
    render(
      <RegistryFilterPanel className="registry-catalog-filters" label="Filtres du catalogue" activeFilterCount={2}>
        <label htmlFor="filter-value">Collection</label>
        <select id="filter-value"><option>Pilots</option></select>
      </RegistryFilterPanel>,
    );

    const toggle = screen.getByRole('button', { name: /Filtres du catalogue/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByLabelText('Collection').closest('.registry-filter-panel__content')?.hasAttribute('hidden')).toBe(true);

    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByLabelText('Collection').closest('.registry-filter-panel__content')?.hasAttribute('hidden')).toBe(false);

    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});
