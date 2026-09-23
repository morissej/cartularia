import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PublicEditorialPage } from '../../src/features/public/PublicEditorialPage.tsx';
import { DELIVERABLE_DETAILS, OBJECT_CATEGORIES, PROFESSIONAL_MEDIA_HELP_REASON } from '../../src/features/public/publicContent.ts';

const renderPath = (path: string) => {
  window.history.replaceState({}, '', path);
  return render(<PublicEditorialPage />);
};

describe('Pages éditoriales publiques', () => {
  afterEach(() => { cleanup(); window.history.replaceState({}, '', '/'); });

  it('présente les sept catégories depuis la source commune et distingue les disponibilités', () => {
    renderPath('/objets');
    expect(screen.getByRole('heading', { level: 1, name: /Les objets documentés dans Cartularia/i })).toBeTruthy();
    for (const category of OBJECT_CATEGORIES) expect(screen.getByRole('heading', { level: 2, name: category.name })).toBeTruthy();
    expect(screen.getAllByText('Cartulaire dédié disponible')).toHaveLength(2);
    expect(screen.getByText(/La fiche standard destinée aux autres objets n’est pas encore ouverte/i)).toBeTruthy();
  });

  it('propose les prises de vue, le guide autonome et le contact professionnel prérempli', () => {
    renderPath('/aide-documentaire');
    expect(screen.getByRole('heading', { level: 1, name: /Besoin d’aide pour créer la base documentaire/i })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Vue générale et trois-quarts' })).toBeTruthy();
    expect(screen.getByText(/ne demandez pas au propriétaire d’ouvrir sa montre/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Lire le guide complet/i }).getAttribute('href')).toBe('/conseils-photo-video');
    expect(screen.getByRole('link', { name: /Préparer la demande/i }).getAttribute('href')).toBe(`/?motif=${encodeURIComponent(PROFESSIONAL_MEDIA_HELP_REASON)}#contact`);
  });

  it('fournit un guide smartphone complet avec protection des originaux et des données privées', () => {
    renderPath('/conseils-photo-video');
    expect(screen.getByRole('heading', { level: 1, name: 'Prendre vos photos et vidéos vous-même' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Conserver les originaux' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Vérifier les informations privées' })).toBeTruthy();
  });

  it.each(DELIVERABLE_DETAILS)('rend la page de détail $title avec capture, fonctions et retours', (item) => {
    renderPath(`/livrables/${item.slug}`);
    expect(screen.getByRole('heading', { level: 1, name: item.title })).toBeTruthy();
    expect(screen.getByRole('img', { name: item.screenshotAlt }).getAttribute('src')).toBe(item.screenshot);
    expect(screen.getByRole('heading', { level: 3, name: item.availability === 'planned' ? 'Fonctions prévues' : 'Fonctions effectives' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 3, name: 'Exemple fictif' })).toBeNull();
    expect(screen.getByRole('link', { name: /Retour aux livrables/i }).getAttribute('href')).toBe('/#livrables');
    expect(screen.getAllByRole('link', { name: 'Retour à l’accueil' }).some((link) => link.getAttribute('href') === '/')).toBe(true);
  });

  it('ouvre directement le Registre et la Collection de démonstration', () => {
    const registry = DELIVERABLE_DETAILS.find((item) => item.slug === 'registre');
    const collection = DELIVERABLE_DETAILS.find((item) => item.slug === 'collection');
    expect(registry?.directHref).toContain('demo=1&open=1');
    expect(registry?.directHref).toContain(encodeURIComponent('/registry/reg_cartularia_demo/items'));
    expect(collection?.directHref).toContain(encodeURIComponent('/registry/reg_cartularia_demo/collections'));
    expect(collection?.directLabel).toBe('Découvrir la Collection');
  });

  it('relie le Mini Site à un aperçu local et le Sceau directement au panneau Preuves', () => {
    const miniSite = DELIVERABLE_DETAILS.find((item) => item.slug === 'mini-site');
    const seal = DELIVERABLE_DETAILS.find((item) => item.slug === 'sceau-integrite');
    expect(miniSite?.directHref).toContain('/watch-website?');
    expect(miniSite?.directHref).toContain('preview=local');
    expect(miniSite?.screenshot).toContain('mini-site-demo.webp');
    expect(seal?.directHref).toContain('view=proofs');
    expect(seal?.screenshot).toContain('sceau-integrite.webp');
    expect(new Set(DELIVERABLE_DETAILS.map((item) => item.screenshot))).toHaveLength(8);
  });
});
