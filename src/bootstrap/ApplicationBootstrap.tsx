import { Component, Suspense, useEffect, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { BrandLogo } from '../components/BrandLogo.tsx';
import { RootPage } from '../RootPage.tsx';
import { applicationRouteLabel } from '../utils/interfaceState.ts';
import {
  requiresPrivateCartularyHydration,
  runPrivateCartularyBootstrap,
  type PrivateBootstrapOutcome,
} from './applicationBootstrap.ts';

type BootState =
  | { status: 'hydrating' }
  | { status: 'ready'; outcome?: PrivateBootstrapOutcome };

interface ApplicationBootstrapProps {
  location?: Pick<Location, 'pathname' | 'search'>;
  bootstrap?: () => Promise<PrivateBootstrapOutcome>;
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

let defaultPrivateBootstrap: Promise<PrivateBootstrapOutcome> | null = null;

const startDefaultPrivateBootstrap = () => {
  defaultPrivateBootstrap ??= runPrivateCartularyBootstrap();
  return defaultPrivateBootstrap;
};

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
  bootstrap = runPrivateCartularyBootstrap,
  PageComponent = RootPage,
}: ApplicationBootstrapProps) {
  const needsPrivateHydration = requiresPrivateCartularyHydration(location);
  const context = applicationRouteLabel(location.pathname);
  const [bootState, setBootState] = useState<BootState>(() => (
    needsPrivateHydration ? { status: 'hydrating' } : { status: 'ready' }
  ));
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  useEffect(() => { document.title = `${context} · Cartularia`; }, [context]);

  useEffect(() => {
    if (!needsPrivateHydration) return undefined;
    let active = true;
    const operation = bootstrap === runPrivateCartularyBootstrap
      ? startDefaultPrivateBootstrap()
      : bootstrap();
    void operation.then((outcome) => {
      if (active) setBootState({ status: 'ready', outcome });
    }, () => {
      if (active) setBootState({
        status: 'ready',
        outcome: {
          status: 'degraded',
          reason: 'local_unavailable',
          message: 'Le démarrage privé a rencontré une erreur. Les données présentes dans ce navigateur restent inchangées.',
        },
      });
    });
    return () => { active = false; };
  }, [bootstrap, needsPrivateHydration]);

  if (bootState.status === 'hydrating') {
    return <ApplicationShell context={context} label="Restauration sécurisée de votre carnet local…" />;
  }

  const degraded = bootState.outcome?.status === 'degraded' ? bootState.outcome : null;
  const signedOut = bootState.outcome?.status === 'ready' && bootState.outcome.reason === 'signed_out';
  const signInHref = `/account/sign-in?returnTo=${encodeURIComponent(`${location.pathname}${location.search}`)}`;
  return (
    <ApplicationErrorBoundary>
      {degraded && !noticeDismissed && (
        <aside className="application-bootstrap-notice" role="status" aria-live="polite">
          <div>
            <strong>Démarrage en mode local</strong>
            <span>{degraded.message}</span>
          </div>
          <button type="button" onClick={() => setNoticeDismissed(true)} aria-label="Masquer l’avertissement de démarrage">Fermer</button>
        </aside>
      )}
      {signedOut && (
        <aside className="application-bootstrap-notice application-bootstrap-notice--session" role="status" aria-live="polite">
          <div>
            <strong>Originaux distants verrouillés</strong>
            <span>Le Cartulaire local reste consultable. Connectez-vous au Registre pour charger les JPEG, vidéos et documents privés.</span>
          </div>
          <a href={signInHref}>Se connecter</a>
        </aside>
      )}
      <Suspense fallback={<ApplicationShell context={context} label={`Ouverture : ${context}…`} />}>
        <PageComponent />
      </Suspense>
    </ApplicationErrorBoundary>
  );
}
