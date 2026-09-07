import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ServiceInformationPage } from '../../src/features/public/ServiceInformationPage';

describe('Informations publiques du pilote', () => {
  it.each([
    ['/conditions', 'Conditions d’utilisation du pilote'],
    ['/confidentialite', 'Confidentialité et données'],
    ['/accessibilite', 'Accessibilité'],
    ['/service', 'Disponibilité et limites'],
  ])('rend %s avec titre, navigation et retour', (path, title) => {
    window.history.replaceState({}, '', path);
    render(<ServiceInformationPage />);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Informations sur le service' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Retour à l’accueil' }).getAttribute('href')).toBe('/');
    expect(document.title).toBe(`${title} · Cartularia`);
  });
});
