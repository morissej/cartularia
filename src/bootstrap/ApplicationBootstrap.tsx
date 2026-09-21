import { Component, Suspense, lazy, useEffect } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { BrandLogo } from '../components/BrandLogo.tsx';
import { RootPage } from '../RootPage.tsx';
import { applicationRouteLabel } from '../utils/interfaceState.ts';
import {
  requiresPrivateCartularyHydration,
} from './applicationBootstrap.ts';

const PrivateCartularyGate = lazy(() => import('./PrivateCartularyGate.tsx'));

interface ApplicationBootstrapProps {
  location?: Pick<Location, 'pathname' | 'search'>;
  PageComponent?: ComponentType;
}

class ApplicationErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: unknown) {
    console.error('Erreur globale Cartularia:', error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <main className="application-shell" role="alert" aria-live="assertive">
          <BrandLogo variant="color" />
          <div className="application-shell__rule" aria-hidden="true" />
          <span className="eyebrow">Affichage interrompu</span>
          <h1>Cette page n’a pas pu être affichée</h1>
          <p>Une erreur est survenue. Les modifications non enregistrées peuvent être perdues si vous rechargez. Réessayez ou revenez à l’accueil.</p>
          <button
            type="button"
            className="button button--primary"
            style={{ marginTop: '16px' }}
            onClick={() => window.location.reload()}
          >
            Recharger Cartularia
          </button>
          <a href="/">Revenir à l’accueil</a>
        </main>
      );
    }
    return this.props.children;
  }
}

function ApplicationShell({ label, context }: { label: string; context: string }) {
  return (
    <main className="application-shell" role="status" aria-live="polite" aria-label={label}>
      <BrandLogo variant="color" href="/" />
      <div className="application-shell__rule" aria-hidden="true" />
      <span className="eyebrow">{context}</span>
      <h1>Cartularia</h1>
      <p>{label}</p>
      <span className="application-shell__progress" aria-hidden="true" />
    </main>
  );
}

export function ApplicationBootstrap({
  location = window.location,
  PageComponent = RootPage,
}: ApplicationBootstrapProps) {
  const needsPrivateHydration = requiresPrivateCartularyHydration(location);
  const context = applicationRouteLabel(location.pathname);
  useEffect(() => { document.title = `${context} · Cartularia`; }, [context]);
  return (
    <ApplicationErrorBoundary>
      <Suspense fallback={<ApplicationShell context={context} label={`Ouverture : ${context}…`} />}>
        {needsPrivateHydration
          ? <PrivateCartularyGate location={location} PageComponent={PageComponent} />
          : <PageComponent />}
      </Suspense>
    </ApplicationErrorBoundary>
  );
}
