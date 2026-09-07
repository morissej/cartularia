import './personalVault/codeHandoffCapture'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { ApplicationBootstrap } from './bootstrap/ApplicationBootstrap.tsx'

const STALE_BUILD_RELOAD_KEY = 'cartularia:stale-build-reload'

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  const lastReload = Number(window.sessionStorage.getItem(STALE_BUILD_RELOAD_KEY) || '0')
  if (Date.now() - lastReload < 60_000) return
  window.sessionStorage.setItem(STALE_BUILD_RELOAD_KEY, String(Date.now()))
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApplicationBootstrap />
  </StrictMode>,
)
