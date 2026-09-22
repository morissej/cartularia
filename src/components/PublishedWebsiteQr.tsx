import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/**
 * Boîte « QR code de partage » du panneau Preuves, alimentée uniquement par l'adresse du mini-site
 * réellement publié (V4 point 2). L'appelant ne la monte que si cette adresse est constatée à
 * l'exécution : aucune adresse vide, aucun faux « publié ». Composant pur : aucun accès Firebase,
 * aucune branche démo ; seul importateur de `qrcode` dans `src/`.
 */
export function PublishedWebsiteQr({ language, url }: { language: 'FR' | 'EN'; url: string }) {
  const tx = (french: string, english: string) => language === 'FR' ? french : english;
  const [qrDataUrl, setQrDataUrl] = useState('');

  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(url, {
      width: 192,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#1a1815', light: '#ffffff' },
    }).then((dataUrl) => {
      if (active) setQrDataUrl(dataUrl);
    }).catch(() => {
      if (active) setQrDataUrl('');
    });
    return () => { active = false; };
  }, [url]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', backgroundColor: 'var(--paper)', padding: 'var(--s3)', border: '1px solid var(--rule)' }}>
      <a href={url} target="_blank" rel="noreferrer" aria-label={tx('Ouvrir le mini-site publié lié au QR code', 'Open the published mini-site linked to the QR code')}>
        {qrDataUrl
          ? <img src={qrDataUrl} width="64" height="64" alt={tx('QR code vers le mini-site publié', 'QR code to the published mini-site')} style={{ display: 'block', border: '1px solid var(--ink)' }} />
          : <span style={{ display: 'grid', width: '64px', height: '64px', placeItems: 'center', border: '1px solid var(--rule)', color: 'var(--muted)', fontSize: '9px' }}>QR</span>}
      </a>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--ink)' }}>{tx('QR CODE DE PARTAGE', 'SHARE QR CODE')}</span>
        <span style={{ fontSize: '10px', color: 'var(--muted)' }}>{tx('Scannez pour ouvrir le mini-site publié.', 'Scan to open the published mini-site.')}</span>
        <span style={{ maxWidth: '330px', overflowWrap: 'anywhere', fontSize: '8px', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{url}</span>
      </div>
    </div>
  );
}
