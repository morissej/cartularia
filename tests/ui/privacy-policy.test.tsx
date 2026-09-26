import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PrivacyPolicyPage } from '../../src/features/public/PrivacyPolicyPage.tsx';

describe('Politique de confidentialité destinée aux clients', () => {
  it('présente des rubriques accessibles et un contact utilisable sans afficher l’audit interne', () => {
    render(<PrivacyPolicyPage />);
    expect(document.title).toBe('Politique de protection des données personnelles — Cartularia');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Politique de protection des données personnelles');
    const links = within(screen.getByRole('navigation', { name: 'Sommaire' })).getAllByRole('link');
    expect(links).toHaveLength(9);
    for (const link of links) expect(document.querySelector(link.getAttribute('href')!)).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'contact@cartularia.com' }).every((link) => link.getAttribute('href')?.startsWith('mailto:contact@cartularia.com'))).toBe(true);
    expect(document.body.textContent).not.toMatch(/Audit de conformité du code|Plan d’action avant mise en service|privacy@\[domaine\]|DEV-\d+/);
  });

  it('rend visibles les limites connues sans inventer une identité ou une conformité acquise', () => {
    render(<PrivacyPolicyPage />);
    expect(screen.getByText(/L’identité juridique complète et l’adresse postale/)).toBeTruthy();
    expect(screen.getByText(/ne propose donc pas aujourd’hui un hébergement exclusivement européen/)).toBeTruthy();
    expect(screen.getByText(/Cette durée reste en cours de validation/)).toBeTruthy();
    expect(screen.getByText(/ne propose pas encore de réglage de consentement dédié/)).toBeTruthy();
    expect(screen.getByText(/ne permet pas d’effacer une copie déjà téléchargée/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'adresser une réclamation à la CNIL' }).getAttribute('href')).toBe('https://www.cnil.fr/fr/adresser-une-plainte');
  });
});
