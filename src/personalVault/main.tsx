import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import './personalVault.css';
import { PersonalVaultApp } from './PersonalVaultApp';

createRoot(document.getElementById('root')!).render(<StrictMode><PersonalVaultApp /></StrictMode>);

