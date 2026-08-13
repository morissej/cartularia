import React from 'react';

interface TableRowProps {
  label: string;
  value: React.ReactNode;
  isMono?: boolean;
  isMeasured?: boolean;
  measurementMeta?: string; // e.g. "07.08.2026"
}

export const TableRow: React.FC<TableRowProps> = ({
  label,
  value,
  isMono = false,
  isMeasured = false,
  measurementMeta
}) => {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      padding: 'var(--s3) 0',
      borderBottom: '1px solid #EAE7E0',
      width: '100%',
      gap: 'var(--s3)'
    }}>
      {/* Libellé (Key) */}
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '10px',
        fontWeight: 700,
        textTransform: 'uppercase',
        color: 'var(--muted)',
        letterSpacing: '0.15em',
        whiteSpace: 'nowrap'
      }}>
        {label}
      </span>

      {/* Valeur (Value) */}
      <div style={{
        textAlign: 'right',
        fontFamily: isMono ? 'var(--font-mono)' : 'var(--font-headings)',
        fontSize: isMono ? '13px' : '15px',
        fontWeight: isMono ? 500 : 400,
        color: isMeasured ? 'var(--mark)' : 'var(--ink)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: '2px'
      }}>
        <span className={isMono ? 'tabular-nums' : ''} style={{ fontWeight: isMono ? 600 : 'inherit' }}>
          {value}
        </span>

        {/* Métadonnées de mesure (ex: mesuré · 07.08.2026) */}
        {isMeasured && (
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '9px',
            color: 'var(--mark)',
            letterSpacing: '0.05em',
            textTransform: 'uppercase'
          }}>
            mesuré {measurementMeta ? `· ${measurementMeta}` : ''}
          </span>
        )}
      </div>
    </div>
  );
};

interface TableCleValeurProps {
  children: React.ReactNode;
  title?: string;
}

export const TableCleValeur: React.FC<TableCleValeurProps> = ({ children, title }) => {
  return (
    <div style={{
      backgroundColor: 'var(--sheet)',
      padding: 'var(--s4)',
      border: '1px solid var(--rule)',
      width: '100%'
    }}>
      {title && (
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
      )}
      <div style={{
        display: 'flex',
        flexDirection: 'column'
      }}>
        {children}
      </div>
    </div>
  );
};
