import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { RootPage } from './RootPage.tsx'
import { restoreCartulariaLocalState } from './persistence/localVault.ts'

const renderApplication = () => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<main role="status" aria-live="polite" style={{ minHeight: '100vh', display: 'grid', placeContent: 'center' }}>Chargement de Cartularia…</main>}>
      <RootPage />
    </Suspense>
  </StrictMode>,
);

void restoreCartulariaLocalState().finally(renderApplication);
