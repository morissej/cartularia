import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// La boîte QR du panneau Preuves ne connaît que l'adresse du mini-site réellement publié (V4 point 2) :
// lien, image et adresse visent cette seule adresse, en français comme en anglais.
const qr = vi.hoisted(() => ({ toDataURL: vi.fn(async () => 'data:image/png;base64,x') }));
vi.mock('qrcode', () => ({ default: { toDataURL: qr.toDataURL } }));

import { PublishedWebsiteQr } from '../../src/components/PublishedWebsiteQr';

const url = 'https://cartularia.test/watch-website?publicCode=OBJ-1';

describe('PublishedWebsiteQr', () => {
  it('lie le QR, l’image et l’adresse au seul mini-site publié', async () => {
    render(<PublishedWebsiteQr language="FR" url={url} />);
    expect(screen.getByRole('link', { name: 'Ouvrir le mini-site publié lié au QR code' }).getAttribute('href')).toBe(url);
    await waitFor(() => expect(screen.getByRole('img', { name: 'QR code vers le mini-site publié' }).getAttribute('src')).toBe('data:image/png;base64,x'));
    expect(screen.getByText('QR CODE DE PARTAGE')).toBeTruthy();
    expect(screen.getByText('Scannez pour ouvrir le mini-site publié.')).toBeTruthy();
    expect(screen.getByText(url)).toBeTruthy();
    expect(screen.queryByText(/fiche publique/)).toBeNull();
    expect(qr.toDataURL).toHaveBeenCalledTimes(1);
    expect(qr.toDataURL.mock.calls[0][0]).toBe(url);
  });

  it('traduit le lien et l’image en anglais', async () => {
    render(<PublishedWebsiteQr language="EN" url={url} />);
    expect(screen.getByRole('link', { name: 'Open the published mini-site linked to the QR code' }).getAttribute('href')).toBe(url);
    await waitFor(() => expect(screen.getByRole('img', { name: 'QR code to the published mini-site' })).toBeTruthy());
    expect(screen.getByText('SHARE QR CODE')).toBeTruthy();
  });

  it('garde un espace réservé lisible si la génération du QR échoue', async () => {
    qr.toDataURL.mockRejectedValueOnce(new Error('canvas indisponible'));
    render(<PublishedWebsiteQr language="FR" url={url} />);
    await waitFor(() => expect(qr.toDataURL).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('QR')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ouvrir le mini-site publié lié au QR code' }).getAttribute('href')).toBe(url);
  });
});
