import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MediaDownloadLink } from '../../src/components/MediaDownloadLink.tsx';
import { mediaDownloadFileName } from '../../src/utils/mediaDownload.ts';

describe('téléchargement des médias', () => {
  it('conserve le nom du fichier original après neutralisation des séparateurs de chemin', () => {
    expect(mediaDownloadFileName({
      name: 'Photo principale',
      originalFileName: '../original/IWC face.jpg',
      url: 'blob:media',
      mimeType: 'image/jpeg',
    })).toBe('original-IWC face.jpg');
  });

  it('ajoute une extension issue du type MIME pour une projection publique en blob', () => {
    expect(mediaDownloadFileName({
      name: 'media-publie-01',
      url: 'blob:publication',
      mimeType: 'image/webp',
    })).toBe('media-publie-01.webp');
  });

  it('rend un lien de téléchargement explicite et localisé', () => {
    render(<MediaDownloadLink media={{
      name: 'Vue de face',
      url: '/assets/vue-face.jpg',
      mimeType: 'image/jpeg',
    }} language="FR" />);

    const link = screen.getByRole('link', { name: 'Télécharger le média : Vue de face' });
    expect(link.getAttribute('href')).toBe('/assets/vue-face.jpg');
    expect(link.getAttribute('download')).toBe('Vue de face.jpg');
    expect(link.textContent).toContain('Télécharger le média');
  });

  it('ne propose aucun téléchargement sans URL autorisée', () => {
    const { container } = render(<MediaDownloadLink media={{ name: 'Projection indisponible', url: null }} />);
    expect(container.childElementCount).toBe(0);
  });

  it('donne à la copie de présentation l’extension de ses octets sans renommer un original', () => {
    expect(mediaDownloadFileName({ name: 'cadran.jpg', mimeType: 'image/webp', publicStoragePath: 'public/OBJ-01/photo/web' })).toBe('cadran.webp');
    expect(mediaDownloadFileName({ name: 'Film.MOV', mimeType: 'video/mp4', publicStoragePath: 'public/OBJ-01/film/web' })).toBe('Film.mp4');
    expect(mediaDownloadFileName({ name: 'Vue', originalFileName: 'original.JPEG', mimeType: 'image/jpeg', binaryId: 'private' })).toBe('original.JPEG');
    expect(mediaDownloadFileName({ name: 'Photo.2026', mimeType: 'image/webp' })).toBe('Photo.2026.webp');
    expect(mediaDownloadFileName({ name: 'cadran.jpg', mimeType: 'IMAGE/WEBP; charset=binary' })).toBe('cadran.webp');
  });

  it('identifie visuellement les liens compacts par le nom de la vue', () => {
    render(<MediaDownloadLink media={{ name: 'Rolex · profil gauche', url: '/assets/vue.webp', mimeType: 'image/webp' }} compact showName />);
    expect(screen.getByRole('link').textContent).toContain('Télécharger · Rolex · profil gauche');
  });
});
