import React from 'react';
import type { ProofStatus, ConfidenceLevel } from '../types';

interface ConstatRowProps {
  organ: string;
  description: string;
  isAlert?: boolean;
  proofStatus: ProofStatus;
  confidence: ConfidenceLevel;
  date: string;
  language: 'FR' | 'EN';
}

export const ConstatRow: React.FC<ConstatRowProps> = ({
  organ,
  description,
  isAlert = false,
  proofStatus,
  confidence,
  date,
  language
}) => {
  const textColor = isAlert ? 'var(--mark)' : 'var(--ink)';

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      padding: 'var(--s3) 0',
      borderBottom: '1px solid #EAE7E0',
      width: '100%',
      gap: 'var(--s1)'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 'var(--s3)',
        flexWrap: 'wrap'
      }}>
        {/* Organe (à gauche) */}
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          fontWeight: 700,
          textTransform: 'uppercase',
          color: textColor,
          letterSpacing: '0.1em',
          minWidth: '120px'
        }}>
          {organ}
        </span>

        {/* Constat factuel (à droite) */}
        <span style={{
          flex: 1,
          fontFamily: 'var(--font-headings)',
          fontSize: '14px',
          color: textColor,
          fontWeight: isAlert ? 500 : 400,
          textAlign: 'left'
        }}>
          {description}
        </span>
      </div>

      {/* Métadonnées de preuve (en dessous en petit) */}
      <div style={{
        display: 'flex',
        gap: 'var(--s2)',
        fontFamily: 'var(--font-mono)',
        fontSize: '9px',
        color: 'var(--muted)',
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        alignItems: 'center',
        paddingLeft: '0px'
      }}>
        <span>{language === 'FR' ? 'PREUVE :' : 'PROOF :'} {proofStatus}</span>
        <span>·</span>
        <span>{language === 'FR' ? 'CONFIANCE :' : 'CONFIDENCE :'} {confidence}</span>
        <span>·</span>
        <span className="tabular-nums">{date}</span>
      </div>
    </div>
  );
};

interface BlocConstatProps {
  children: React.ReactNode;
  title: string;
  language: 'FR' | 'EN';
}

export const BlocConstat: React.FC<BlocConstatProps> = ({ children, title }) => {
  return (
    <div style={{
      backgroundColor: 'var(--sheet)',
      padding: 'var(--s4)',
      border: '1px solid var(--rule)',
      width: '100%'
    }}>
      <h3 style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '10px',
        fontWeight: 700,
        textTransform: 'uppercase',
        color: 'var(--ink)',
        letterSpacing: '0.2em',
        borderBottom: '1px solid var(--ink)',
        paddingBottom: 'var(--s2)',
        marginBottom: 'var(--s2)'
      }}>
        {title}
      </h3>
      <div style={{
        display: 'flex',
        flexDirection: 'column'
      }}>
        {children}
      </div>
    </div>
  );
};
