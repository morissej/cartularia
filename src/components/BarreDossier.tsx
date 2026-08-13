import React from 'react';
import type { VisibilityLevel } from '../types';

interface BarreDossierProps {
  publicCode: string;
  brand: string;
  model: string;
  language: 'FR' | 'EN';
  setLanguage: (lang: 'FR' | 'EN') => void;
  audience: VisibilityLevel;
  setAudience: (aud: VisibilityLevel) => void;
}

export const BarreDossier: React.FC<BarreDossierProps> = ({
  publicCode,
  brand,
  model,
  language,
  setLanguage,
  audience,
  setAudience
}) => {

  return (
    <header className="dossier-bar no-print" style={{
      backgroundColor: 'var(--sheet)',
      borderBottom: '1px solid var(--rule)',
      width: '100%',
      padding: 'var(--s3) var(--s5)',
      position: 'sticky',
      top: 0,
      zIndex: 100
    }}>
      <div className="dossier-bar__inner" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        maxWidth: '1200px',
        margin: '0 auto',
        width: '100%'
      }}>
        {/* Logo / Nom du Service */}
        <div className="dossier-bar__logo" style={{
          fontFamily: 'var(--font-headings)',
          fontSize: '22px',
          fontWeight: 700,
          color: 'var(--ink)',
          letterSpacing: '-0.02em'
        }}>
          Cartularia
        </div>

        {/* Info Montre (Centrée) */}
        <div className="header-watch-info" style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s2)',
          fontSize: '13px',
          color: 'var(--ink)'
        }}>
          <span style={{ fontWeight: 600, fontFamily: 'var(--font-sans)' }}>
            {brand} {model}
          </span>
          <span style={{ color: 'var(--muted)' }}>·</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 500, color: 'var(--muted)' }}>
            {publicCode}
          </span>
        </div>

        {/* Contrôles (Droite) */}
        <div className="dossier-bar__controls" style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s4)'
        }}>
          {/* Sélecteur d'Audience (Bascule cyclique simple pour rester épuré) */}
          <div className="dossier-bar__preview" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>
              {language === 'FR' ? 'Aperçu :' : 'Preview :'}
            </span>
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value as VisibilityLevel)}
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--ink)',
                cursor: 'pointer',
                backgroundColor: 'transparent',
                outline: 'none',
                padding: '2px 4px'
              }}
            >
              <option value="Secret">{language === 'FR' ? 'Propriétaire (Privé)' : 'Owner (Private)'}</option>
              <option value="Communauté">{language === 'FR' ? 'Communauté' : 'Community'}</option>
              <option value="Tous">{language === 'FR' ? 'Tous (Public)' : 'Everyone (Public)'}</option>
            </select>
          </div>

          <span style={{ color: 'var(--rule)', height: '12px', width: '1px', backgroundColor: 'var(--rule)' }} />

          {/* Langue FR / EN */}
          <div className="dossier-bar__languages" style={{ display: 'flex', gap: '6px' }}>
            {(['FR', 'EN'] as const).map((lang) => (
              <button
                key={lang}
                onClick={() => setLanguage(lang)}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  color: language === lang ? 'var(--ink)' : 'var(--muted)',
                  transition: 'var(--transition)',
                  padding: '2px'
                }}
              >
                {lang}
              </button>
            ))}
          </div>
        </div>
      </div>
      <style>{`
        @media (max-width: 767px) {
          .header-watch-info {
            display: none !important;
          }
        }
      `}</style>
    </header>
  );
};
