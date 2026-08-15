import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { GenericCartularyPage } from './components/GenericCartularyPage.tsx'
import { CommunityPage } from './components/CommunityPage.tsx'

const route = window.location.pathname.replace(/\/$/, '')
const RootPage = route === '/cartulary-view'
  ? GenericCartularyPage
  : route === '/community'
    ? CommunityPage
    : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootPage />
  </StrictMode>,
)
