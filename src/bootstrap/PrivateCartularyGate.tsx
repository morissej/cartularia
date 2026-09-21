import { useEffect, useState, type ComponentType } from 'react';
import { BrandLogo } from '../components/BrandLogo.tsx';
import { cartularyIdFromLocation } from '../domain/cartularyIds.ts';
import { lockCartulariaLocalState, hasUnscopedLocalData } from '../persistence/localVault.ts';
import { observePrivateCartularyAccess, type PrivateAccessState } from '../security/privateCartularyAccess.ts';
import { PRIVATE_SESSION_LOCK_EVENT, requestPrivateSessionLock } from '../security/privateSessionEvents.ts';
import { runPrivateCartularyBootstrap, type PrivateBootstrapOutcome } from './applicationBootstrap.ts';

export interface PrivateCartularyGateProps {
  location: Pick<Location, 'pathname' | 'search'>;
  PageComponent: ComponentType;
  bootstrap?: (isCurrent: () => boolean) => Promise<PrivateBootstrapOutcome>;
  observeAccess?: (cartularyId: string, observer: (state: PrivateAccessState) => void) => () => void;
}
type GateState = { status: 'checking' | 'hydrating' } | { status: 'locked'; message: string } | {
  status: 'ready'; outcome: Extract<PrivateBootstrapOutcome, { status: 'ready' }>; legacy: boolean;
};
const defaultBootstrap = (isCurrent: () => boolean) => runPrivateCartularyBootstrap(undefined, isCurrent);

export default function PrivateCartularyGate({ location, PageComponent, bootstrap = defaultBootstrap, observeAccess = observePrivateCartularyAccess }: PrivateCartularyGateProps) {
  const [state, setState] = useState<GateState>({ status: 'checking' });
  const cartularyId = cartularyIdFromLocation(location);
  useEffect(() => {
    let active = true;
    let epoch = 0;
    let openingUid: string | null = null;
    let terminal = false;
    const close = (message: string) => {
      if (!active || terminal) return;
      terminal = true;
      epoch += 1;
      lockCartulariaLocalState();
      setState({ status: 'locked', message });
      requestPrivateSessionLock();
    };
    const onLock = () => close('La session privée est verrouillée. Vos brouillons restent conservés sur cet appareil.');
    window.addEventListener(PRIVATE_SESSION_LOCK_EVENT, onLock);
    lockCartulariaLocalState();
    setState({ status: 'checking' });
    const unsubscribe = observeAccess(cartularyId, (access) => {
      if (!active || terminal) return;
      if (access.status !== 'authorized') {
        if (openingUid) { close('La session ou les droits d’accès ont changé. Rouvrez ce Cartulaire pour les vérifier.'); return; }
        if (access.status === 'checking') setState({ status: 'checking' });
        else setState({ status: 'locked', message: access.status === 'signed-out'
          ? 'Connectez-vous pour ouvrir ce Cartulaire privé.'
          : 'Les droits d’accès ne peuvent pas être confirmés. Aucune donnée privée n’est affichée.' });
        return;
      }
      if (openingUid === access.uid) return;
      if (openingUid) { close('Le compte a changé. Rouvrez le Cartulaire avec le compte autorisé.'); return; }
      openingUid = access.uid;
      const currentEpoch = ++epoch;
      const current = () => active && !terminal && currentEpoch === epoch;
      setState({ status: 'hydrating' });
      void bootstrap(current).then(async (outcome) => {
        if (!current()) return;
        if (outcome.status !== 'ready' || outcome.uid !== access.uid || outcome.cartularyId !== cartularyId) {
          close(outcome.status === 'blocked' ? outcome.message : 'La session a changé. Rouvrez le Cartulaire.');
          return;
        }
        const legacy = await hasUnscopedLocalData(cartularyId).catch(() => false);
        if (current()) setState({ status: 'ready', outcome, legacy });
      }).catch(() => { if (current()) close('L’ouverture privée a échoué. Vos brouillons restent conservés sur cet appareil.'); });
    });
    return () => {
      active = false;
      epoch += 1;
      unsubscribe();
      lockCartulariaLocalState();
      window.removeEventListener(PRIVATE_SESSION_LOCK_EVENT, onLock);
    };
  }, [cartularyId, bootstrap, observeAccess]);

  if (state.status === 'ready') return <>
    {state.outcome.message && <aside className="application-bootstrap-notice" role="status">{state.outcome.message}</aside>}
    {state.legacy && <aside className="application-bootstrap-notice" role="status">Des brouillons d’une version précédente sont conservés sur cet appareil. Leur propriétaire doit être vérifié avant récupération ; ils ne sont pas chargés automatiquement.</aside>}
    <PageComponent />
  </>;
  const locked = state.status === 'locked';
  const returnTo = `${location.pathname}${location.search}`;
  return <main className="application-shell" role={locked ? undefined : 'status'} aria-live="polite">
    <BrandLogo variant="color" href="/" />
    <span className="eyebrow">Cartulaire privé</span>
    <h1>{locked ? 'Accès privé verrouillé' : 'Vérification de votre accès…'}</h1>
    <p>{locked ? state.message : 'Vérification de la session et des droits avant ouverture du dossier.'}</p>
    {locked && <>
      <a className="button button--primary" href={`/account/sign-in?returnTo=${encodeURIComponent(returnTo)}`}>Se connecter</a>
      <a href={returnTo}>Vérifier à nouveau mon accès</a>
      <a href="/registry">Revenir au Registre</a>
    </>}
  </main>;
}
