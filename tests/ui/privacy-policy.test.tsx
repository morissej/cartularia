import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PrivacyPolicyPage } from '../../src/features/public/PrivacyPolicyPage.tsx';

function tableBodyRows(name: string | RegExp) {
  const table = screen.getByRole('table', { name });
  return within(table).getAllByRole('row').slice(1);
}

describe('Politique RGPD Cartularia', () => {
  it('affiche l’identité, la version, la date et le statut juridique du document source', () => {
    render(<PrivacyPolicyPage />);

    expect(document.title).toBe('Politique de protection des données personnelles — Cartularia');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Politique de protection des données personnelles');
    expect(screen.getByText('Projet Cartularia · Version 1.0 · 21 août 2026')).toBeTruthy();
    expect(screen.getByText('Statut : projet de politique soumis à revue juridique avant adoption')).toBeTruthy();
    const warning = screen.getByRole('complementary', { name: 'Avertissement.' });
    expect(within(warning).getByText(/document de travail interne/i)).toBeTruthy();
    expect(within(warning).getByText(/relue par un avocat ou un délégué à la protection des données avant adoption/i)).toBeTruthy();
  });

  it('présente au sommaire les quatre parties et les deux annexes', () => {
    render(<PrivacyPolicyPage />);

    const contents = screen.getByRole('navigation', { name: 'Sommaire' });
    for (const label of [
      'Partie I — Cadre juridique applicable',
      'Partie II — La politique',
      'Partie III — Audit de conformité du code actuel',
      'Partie IV — Plan d’action avant mise en service',
      'Annexe A — Notice courte à la création du compte',
      'Annexe B — Références',
    ]) {
      expect(within(contents).getByRole('link', { name: label })).toBeTruthy();
    }
  });

  it('rend les quatorze traitements T1 à T14', () => {
    render(<PrivacyPolicyPage />);

    const rows = tableBodyRows('Registre des traitements T1 à T14');
    expect(rows).toHaveLength(14);
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual(
      Array.from({ length: 14 }, (_, index) => expect.stringMatching(new RegExp(`^T${index + 1}\\b`))),
    );
  });

  it('rend neuf prestataires, seize écarts et dix étapes', () => {
    render(<PrivacyPolicyPage />);

    expect(tableBodyRows('Inventaire des sous-traitants et transferts')).toHaveLength(9);
    expect(tableBodyRows('Seize écarts relevés dans la source v1.0')).toHaveLength(16);
    expect(tableBodyRows('Plan d’action en dix étapes')).toHaveLength(10);
  });

  it('conserve les placeholders de la notice courte tant que les informations manquent', () => {
    const { container } = render(<PrivacyPolicyPage />);

    const notice = container.querySelector('.privacy-policy-short-notice');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain('[forme sociale, siège, RCS]');
    expect(notice?.textContent).toContain('privacy@[domaine]');
    expect(notice?.textContent).toContain('[lien] — version [n°] du [date]');
  });

  it('sépare clairement l’état local actuel du texte source v1.0', () => {
    render(<PrivacyPolicyPage />);

    const currentState = screen.getByRole('complementary', { name: 'État actuel et écarts vérifiés dans le code local' });
    expect(within(currentState).getByText('Complément distinct de la source v1.0')).toBeTruthy();
    expect(within(currentState).getByText(/Ils ne modifient pas le texte source/i)).toBeTruthy();
    expect(within(currentState).getByRole('heading', { name: 'Région d’hébergement' })).toBeTruthy();
    expect(within(currentState).getByRole('heading', { name: 'App Check et traceurs' })).toBeTruthy();
    expect(within(currentState).getByRole('heading', { name: 'Polices et ressources tierces' })).toBeTruthy();
    expect(within(currentState).getAllByRole('listitem')).toHaveLength(13);
  });
});
