import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { ApplicationBootstrap } from './bootstrap/ApplicationBootstrap.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApplicationBootstrap />
  </StrictMode>,
)
