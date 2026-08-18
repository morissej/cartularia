import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import type { User } from 'firebase/auth'
import './index.css'
import { RootPage } from './RootPage.tsx'

const renderApplication = () => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<main role="status" aria-live="polite" style={{ minHeight: '100vh', display: 'grid', placeContent: 'center' }}>Chargement de Cartularia…</main>}>
      <RootPage />
    </Suspense>
  </StrictMode>,
);

const currentAuthState = async () => {
  const [{ onAuthStateChanged }, { auth }] = await Promise.all([
    import('firebase/auth'),
    import('./firebase.ts'),
  ]);
  return new Promise<User | null>((resolve) => {
    let unsubscribe: () => void = () => undefined;
    unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    }, () => {
      unsubscribe();
      resolve(null);
    });
  });
};

const bootstrapApplication = async () => {
  const { cartulariaLocalVault, restoreCartulariaLocalState } = await import('./persistence/localVault.ts');
  await restoreCartulariaLocalState();
  const isPrivateCartularyRoute = window.location.pathname.replace(/\/$/, '') === '';
  if (!isPrivateCartularyRoute) return;
  const { ACTIVE_CARTULARY_ID, IWC_CARTULARY_ID } = await import('./domain/cartularyIds.ts');
  if (ACTIVE_CARTULARY_ID === IWC_CARTULARY_ID || !cartulariaLocalVault) return;
  const user = await currentAuthState();
  if (!user) return;
  const { primePrivateDraftState } = await import('./persistence/cloudDraft.ts');
  await primePrivateDraftState({
    uid: user.uid,
    cartularyId: ACTIVE_CARTULARY_ID,
    vault: cartulariaLocalVault,
  });
};

void bootstrapApplication()
  .catch((error: unknown) => console.error('Préchargement du Cartulaire privé impossible', error))
  .finally(renderApplication);
