import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/services/foundations', () => ({
  createCartulariaAccount: vi.fn(), signInToCartularia: vi.fn(), resumeRegistryAccountActivation: vi.fn(),
}));
import { AccountAccessPage } from '../../src/features/public/AccountAccessPage';
import { createCartulariaAccount, resumeRegistryAccountActivation, signInToCartularia } from '../../src/services/foundations';

describe('accès publics corrigés', () => {
  beforeEach(() => { vi.clearAllMocks(); window.history.replaceState({}, '', '/account/sign-in'); });
  it('n’accuse pas les identifiants personnels quand la connexion démo échoue et offre un accès sans connexion', async () => {
    window.history.replaceState({}, '', '/account/sign-in?demo=1');
    vi.mocked(signInToCartularia).mockRejectedValue({ code: 'auth/network-request-failed' });
    render(<AccountAccessPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le Registre démo' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Aucun identifiant personnel');
    expect(screen.getByRole('link', { name: /sans connexion/i })).toBeTruthy();
  });
  it('ne refuse pas un mot de passe historique de moins de 12 caractères à la connexion', () => {
    render(<AccountAccessPage />);
    fireEvent.change(screen.getByLabelText('Nom utilisateur'), { target: { value: 'Ancien compte' } });
    const password = screen.getByLabelText('Mot de passe du Registre');
    fireEvent.change(password, { target: { value: 'ancien123' } });
    expect(password.hasAttribute('minlength')).toBe(false);
    expect(screen.getByRole('button', { name: 'Ouvrir le Registre' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('link', { name: /Mot de passe oublié/ }).getAttribute('href')).toBe('/account/recovery');
  });
  it('garde les exigences de création et donne accès aux textes avant consentement', () => {
    window.history.replaceState({}, '', '/account/create'); render(<AccountAccessPage />);
    expect(screen.getByLabelText('Mot de passe du Registre').getAttribute('minlength')).toBe('12');
    expect(screen.getByRole('link', { name: 'conditions d’utilisation' }).getAttribute('href')).toBe('/conditions');
    expect(screen.getByRole('link', { name: 'politique de confidentialité' }).getAttribute('href')).toBe('/confidentialite');
    expect(screen.getByRole('list', { name: 'Étapes de démarrage' })).toBeTruthy();
  });
  it.each([
    ['/account/security', '/account/security'],
    ['/registry/test/items?view=gallery', '/registry/test/items?view=gallery'],
    ['//untrusted.example', '/registry'],
    ['/\n/untrusted.example', '/registry'],
    ['/\\untrusted.example', '/registry'],
  ])('conserve seulement une destination locale sûre : %s', (destination, expected) => {
    window.history.replaceState({}, '', `/account/sign-in?returnTo=${encodeURIComponent(destination)}`);
    render(<AccountAccessPage />);
    expect(screen.getByRole('link', { name: 'Créer un compte' }).getAttribute('href')).toBe(`/account/create?returnTo=${encodeURIComponent(expected)}`);
  });
  it('propose une reprise sans nouvelle création Auth après activation interrompue', async () => {
    window.history.replaceState({}, '', '/account/create');
    vi.mocked(createCartulariaAccount).mockRejectedValue({ code: 'account/activation-incomplete' });
    vi.mocked(resumeRegistryAccountActivation).mockRejectedValue(new Error('account/sign-in-required'));
    render(<AccountAccessPage />);
    fireEvent.change(screen.getByLabelText('Nom utilisateur'), { target: { value: 'Atelier test' } });
    fireEvent.change(screen.getByLabelText('Mot de passe du Registre'), { target: { value: 'fictif-test-123456' } });
    fireEvent.change(screen.getByLabelText('Confirmer le mot de passe du Registre'), { target: { value: 'fictif-test-123456' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Créer l’accès Registre' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Terminer la création de mon Registre' }));
    await waitFor(() => expect(resumeRegistryAccountActivation).toHaveBeenCalledWith('Atelier test'));
    expect(createCartulariaAccount).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
