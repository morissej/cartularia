import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EmptyMediaSlot } from '../../src/features/cartulary/components/EmptyMediaSlot.tsx';
import { MEDIA_SLOT_TAGS } from '../../src/features/cartulary/media/importMediaFiles.ts';

/**
 * Emplacements vides de la page Médias (V5 P-D3) : un contenu absent est un état neutre avec un bouton d'ajout
 * en édition, jamais un « Accès restreint ». Le bouton ouvre le sélecteur de fichiers ; seuls les fichiers
 * conformes au type de l'emplacement sont remis à l'appelant. Aucun composant ne connaît la démonstration.
 */

const video = (name = 'objet-mouvement.mp4') => new File(['x'], name, { type: 'video/mp4' });
const photo = (name: string) => new File(['x'], name, { type: 'image/jpeg' });
const fileInput = (container: HTMLElement) => container.querySelector<HTMLInputElement>('input[type="file"]');
const choose = (input: HTMLInputElement, files: File[]) => fireEvent.change(input, { target: { files } });

describe('emplacement vidéo principale', () => {
  it('propose un bouton d’ajout qui ouvre un sélecteur de fichiers vidéo, fichier unique, et remet le fichier choisi', () => {
    const onAddFiles = vi.fn();
    const { container } = render(<EmptyMediaSlot slot="main-video" language="FR" canEdit onAddFiles={onAddFiles} />);

    const group = screen.getByRole('group', { name: 'Aucune vidéo ajoutée' });
    expect(group.getAttribute('data-media-slot')).toBe('main-video');
    expect(within(group).getByRole('heading', { level: 3, name: 'Aucune vidéo ajoutée' })).toBeTruthy();
    expect(within(group).getByText(/classée « Vidéo principale »/)).toBeTruthy();
    expect(within(group).getByRole('button', { name: 'Ajouter une vidéo' })).toBeTruthy();

    const input = fileInput(container);
    if (!input) throw new Error('input file introuvable');
    expect(input.accept).toContain('.mp4');
    expect(input.accept).not.toContain('.jpg');
    expect(input.multiple).toBe(false);
    expect(input.classList.contains('sr-only')).toBe(true);
    expect(input.getAttribute('aria-hidden')).toBe('true');
    expect(input.tabIndex).toBe(-1);

    const file = video();
    choose(input, [file]);
    expect(onAddFiles).toHaveBeenCalledOnce();
    expect(onAddFiles).toHaveBeenCalledWith([file]);
    expect(input.value).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ouvre le sélecteur au clic sur le bouton', async () => {
    const user = userEvent.setup();
    const { container } = render(<EmptyMediaSlot slot="main-video" language="FR" canEdit onAddFiles={vi.fn()} />);
    const input = fileInput(container);
    if (!input) throw new Error('input file introuvable');
    const open = vi.spyOn(input, 'click');

    await user.click(screen.getByRole('button', { name: 'Ajouter une vidéo' }));

    expect(open).toHaveBeenCalledOnce();
  });

  it('refuse une image dans l’emplacement vidéo : message inline, rien remis à l’appelant, nouvelle sélection possible', () => {
    const onAddFiles = vi.fn();
    const { container } = render(<EmptyMediaSlot slot="main-video" language="FR" canEdit onAddFiles={onAddFiles} />);
    const input = fileInput(container);
    if (!input) throw new Error('input file introuvable');

    choose(input, [photo('cadran.jpg')]);

    expect(onAddFiles).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Sélectionnez un fichier vidéo (MP4, MOV).');
    expect(input.value).toBe('');

    // Un fichier conforme lève le message.
    choose(input, [video()]);
    expect(onAddFiles).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ne dit rien quand la sélection est annulée', () => {
    const onAddFiles = vi.fn();
    const { container } = render(<EmptyMediaSlot slot="main-video" language="FR" canEdit onAddFiles={onAddFiles} />);
    const input = fileInput(container);
    if (!input) throw new Error('input file introuvable');

    choose(input, []);

    expect(onAddFiles).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('désactive le bouton pendant l’import', () => {
    render(<EmptyMediaSlot slot="main-video" language="FR" canEdit busy onAddFiles={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Ajouter une vidéo' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('emplacement séquence 3D', () => {
  it('accepte plusieurs photos et ne remet que celles-ci', () => {
    const onAddFiles = vi.fn();
    const { container } = render(<EmptyMediaSlot slot="spin-3d" language="FR" canEdit onAddFiles={onAddFiles} />);

    const group = screen.getByRole('group', { name: 'Aucune séquence 3D ajoutée' });
    expect(group.getAttribute('data-media-slot')).toBe('spin-3d');
    expect(within(group).getByText(/classées « Séquence 3D »/)).toBeTruthy();
    expect(within(group).getByRole('button', { name: 'Ajouter une séquence 3D' })).toBeTruthy();

    const input = fileInput(container);
    if (!input) throw new Error('input file introuvable');
    expect(input.multiple).toBe(true);
    expect(input.accept).toContain('.jpg');
    expect(input.accept).toContain('.heic');
    expect(input.accept).not.toContain('.mp4');

    const first = photo('vue-01.jpg');
    const second = photo('vue-02.jpg');
    choose(input, [first, video('intrus.mp4'), second]);

    expect(onAddFiles).toHaveBeenCalledOnce();
    expect(onAddFiles).toHaveBeenCalledWith([first, second]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('refuse une vidéo seule dans l’emplacement séquence', () => {
    const onAddFiles = vi.fn();
    const { container } = render(<EmptyMediaSlot slot="spin-3d" language="FR" canEdit onAddFiles={onAddFiles} />);
    const input = fileInput(container);
    if (!input) throw new Error('input file introuvable');

    choose(input, [video()]);

    expect(onAddFiles).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Sélectionnez des photos (JPG, PNG, WEBP, HEIC).');
  });
});

describe('lecture et invariants', () => {
  it('sans droit d’édition : texte neutre, aucun bouton, aucun sélecteur, aucun « Accès restreint »', () => {
    const { container } = render(<EmptyMediaSlot slot="main-video" language="FR" canEdit={false} onAddFiles={vi.fn()} />);

    expect(screen.getByRole('group', { name: 'Aucune vidéo ajoutée' })).toBeTruthy();
    expect(screen.getByText('Aucune vidéo n’a été ajoutée à ce Cartulaire.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(fileInput(container)).toBeNull();
    expect(screen.queryByText(/Accès restreint|Restricted access/)).toBeNull();
    expect(container.querySelector('.restricted-card')).toBeNull();
  });

  it('sans rappel d’ajout : aucun bouton même en édition (emplacement purement descriptif)', () => {
    const { container } = render(<EmptyMediaSlot slot="spin-3d" language="FR" canEdit />);

    expect(screen.getByText('Aucune séquence 3D n’a été ajoutée à ce Cartulaire.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(fileInput(container)).toBeNull();
  });

  it('livre chaque texte en anglais (parité FR/EN)', () => {
    const onAddFiles = vi.fn();
    const { container, rerender } = render(<EmptyMediaSlot slot="main-video" language="EN" canEdit onAddFiles={onAddFiles} />);

    expect(screen.getByRole('group', { name: 'No video added' })).toBeTruthy();
    expect(screen.getByText(/filed as “Main video”/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a video' })).toBeTruthy();
    const input = fileInput(container);
    if (!input) throw new Error('input file introuvable');
    choose(input, [photo('dial.jpg')]);
    expect(screen.getByRole('alert').textContent).toBe('Select a video file (MP4, MOV).');

    rerender(<EmptyMediaSlot slot="spin-3d" language="EN" canEdit onAddFiles={onAddFiles} />);
    expect(screen.getByRole('group', { name: 'No 3D sequence added' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a 3D sequence' })).toBeTruthy();

    rerender(<EmptyMediaSlot slot="spin-3d" language="EN" canEdit={false} />);
    expect(screen.getByText('No 3D sequence has been added to this Cartulary.')).toBeTruthy();
    expect(screen.queryByText(/[àéè]/)).toBeNull();
  });

  it('impose le tag de l’emplacement', () => {
    expect(MEDIA_SLOT_TAGS).toEqual({ 'main-video': 'main-video', 'spin-3d': 'spin-3d' });
  });
});
