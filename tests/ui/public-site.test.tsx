import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HomePage } from '../../src/features/public/HomePage.tsx';

describe('HomePage Public Site UX & Content', () => {
  it('affiche le titre principal et les deux boutons d’action clés', () => {
    render(<HomePage />);

    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toContain('L’histoire de vos pièces de valeur mérite mieux');

    const demoLinks = screen.getAllByRole('link', { name: /Explorer un Cartulaire de démo/i });
    expect(demoLinks[0].getAttribute('href')).toBe('/cartulary#cover');

    const createLinks = screen.getAllByRole('link', { name: /Créer mon dossier/i });
    expect(createLinks[0].getAttribute('href')).toBe('/account/create');
  });

  it('permet de changer d’onglet dans l’aperçu interactif du Hero', () => {
    render(<HomePage />);

    const mediaTab = screen.getByRole('button', { name: /Médias & 360°/i });
    fireEvent.click(mediaTab);

    expect(screen.getByText(/Photographies macro & spin 360°/i)).toBeTruthy();
    expect(screen.getByText(/18 photographies HD/i)).toBeTruthy();
    expect(screen.getByText(/Horodatage EXIF vérifié/i)).toBeTruthy();
  });

  it('présente les deux portes d’entrée fondamentales (Assurance et Transmission)', () => {
    render(<HomePage />);

    expect(screen.getByText(/Porte 01 · Protection & Sinistre/i)).toBeTruthy();
    expect(screen.getByText(/Être couvert et indemnisé sans contestation/i)).toBeTruthy();

    expect(screen.getByText(/Porte 02 · Transmission & Cession/i)).toBeTruthy();
    expect(screen.getByText(/Transmettre ou céder en toute sérénité/i)).toBeTruthy();
  });

  it('détaille les 4 livrables concrets', () => {
    render(<HomePage />);

    expect(screen.getByText(/Le Cartulaire Numérique/i)).toBeTruthy();
    expect(screen.getByText(/Le Rapport PDF Opposable/i)).toBeTruthy();
    expect(screen.getByText(/Le Watch Website Projeté/i)).toBeTruthy();
    expect(screen.getByText(/Le Sceau d’Intégrité/i)).toBeTruthy();
  });

  it('affiche les engagements éthiques (ce que nous faisons / ne faisons pas)', () => {
    render(<HomePage />);

    expect(screen.getByRole('heading', { level: 3, name: /Ce que fait Cartularia/i })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: /Ce que nous ne faisons pas/i })).toBeTruthy();
    expect(screen.getByText(/N’achète ni ne vend aucune montre ou objet/i)).toBeTruthy();
  });

  it('permet de basculer le menu mobile', () => {
    render(<HomePage />);

    const menuButton = screen.getByRole('button', { name: /Ouvrir le menu/i });
    expect(menuButton).toBeTruthy();

    fireEvent.click(menuButton);
    expect(screen.getByRole('button', { name: /Fermer le menu/i })).toBeTruthy();
  });
});
