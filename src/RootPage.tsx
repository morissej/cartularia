import { lazy } from 'react';
import { BrandLogo } from './components/BrandLogo';
import { applicationRouteFromPathname } from './utils/interfaceState';

const CartularyApp = lazy(() => import('./App.tsx'));
const GenericCartularyPage = lazy(() => import('./components/GenericCartularyPage.tsx').then((module) => ({ default: module.GenericCartularyPage })));
const CollectionWebsitePage = lazy(() => import('./components/CollectionWebsitePage.tsx').then((module) => ({ default: module.CollectionWebsitePage })));
const CommunityPage = lazy(() => import('./components/CommunityPage.tsx').then((module) => ({ default: module.CommunityPage })));
const RegistryApp = lazy(() => import('./features/registry/RegistryApp.tsx').then((module) => ({ default: module.RegistryApp })));
const RegistryInvitationPage = lazy(() => import('./features/registry/RegistryInvitationPage.tsx'));
const HomePage = lazy(() => import('./features/public/HomePage.tsx').then((module) => ({ default: module.HomePage })));
const AccountAccessPage = lazy(() => import('./features/public/AccountAccessPage.tsx').then((module) => ({ default: module.AccountAccessPage })));

export function RootPage() {
  const route = applicationRouteFromPathname(window.location.pathname);
  if (new URLSearchParams(window.location.search).get('data-deleted') === '1') {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeContent: 'center', padding: '32px', background: 'var(--paper)' }}>
        <section style={{ width: 'min(560px, 100%)', display: 'grid', gap: '20px', padding: '32px', border: '1px solid var(--rule)', background: 'var(--sheet)' }}>
          <BrandLogo variant="color" />
          <span className="eyebrow">Suppression exécutée</span>
          <h1>Vos données privées ont été supprimées</h1>
          <p>Le coffre local a été effacé. Si une session était active, la copie privée cloud a aussi été supprimée et remplacée par une trace technique empêchant sa recréation accidentelle.</p>
          <p>Les éventuelles publications déjà émises sont des actes distincts et ne sont pas supprimées automatiquement.</p>
          <a className="button button--primary" href="/cartulary#cover">Revenir au Cartulaire</a>
        </section>
      </main>
    );
  }
  const Page = route === 'home'
    ? HomePage
    : route === 'account-create' || route === 'account-sign-in'
      ? AccountAccessPage
    : route === 'cartulary-view'
    ? GenericCartularyPage
    : route === 'collection-website'
      ? CollectionWebsitePage
    : route === 'community'
      ? CommunityPage
      : route === 'invitation'
        ? RegistryInvitationPage
      : route === 'registry'
        ? RegistryApp
        : route === 'cartulary' || route === 'watch-website'
          ? CartularyApp
          : null;

  if (!Page) {
    return (
      <main className="route-not-found">
        <BrandLogo variant="color" />
        <span className="eyebrow">Erreur 404</span>
        <h1>Cette page n’existe pas</h1>
        <p>L’adresse demandée ne correspond à aucune surface Cartularia. Aucune donnée du dossier n’a été affichée.</p>
        <a className="button button--primary" href="/">Revenir à l’accueil</a>
      </main>
    );
  }

  return <Page />;
}
