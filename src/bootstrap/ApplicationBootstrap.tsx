import { Suspense, useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { BrandLogo } from '../components/BrandLogo.tsx';
import { RootPage } from '../RootPage.tsx';
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

let defaultPrivateBootstrap: Promise<PrivateBootstrapOutcome> | null = null;

const startDefaultPrivateBootstrap = () => {
  defaultPrivateBootstrap ??= runPrivateCartularyBootstrap();
  return defaultPrivateBootstrap;
};

function ApplicationShell({ label }: { label: string }) {
  return (
    <main className="application-shell" role="status" aria-live="polite" aria-label={label}>
      <BrandLogo variant="color" />
      <div className="application-shell__rule" aria-hidden="true" />
      <span className="eyebrow">Cartulaire privé</span>
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
  const [bootState, setBootState] = useState<BootState>(() => (
    needsPrivateHydration ? { status: 'hydrating' } : { status: 'ready' }
  ));
  const [noticeDismissed, setNoticeDismissed] = useState(false);

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
    return <ApplicationShell label="Restauration sécurisée de votre carnet local…" />;
  }

  const degraded = bootState.outcome?.status === 'degraded' ? bootState.outcome : null;
  return (
    <>
      {degraded && !noticeDismissed && (
        <aside className="application-bootstrap-notice" role="status" aria-live="polite">
          <div>
            <strong>Démarrage en mode local</strong>
            <span>{degraded.message}</span>
          </div>
          <button type="button" onClick={() => setNoticeDismissed(true)} aria-label="Masquer l’avertissement de démarrage">Fermer</button>
        </aside>
      )}
      <Suspense fallback={<ApplicationShell label="Ouverture de votre espace Cartularia…" />}>
        <PageComponent />
      </Suspense>
    </>
  );
}
