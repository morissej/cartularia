import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CartularyAccessNotice } from '../../src/features/cartulary/components/CartularyAccessNotice.tsx';
import type { AuthoritativeCartularyStatus } from '../../src/features/cartulary/state/useAuthoritativeCartulary.ts';

// V5 point 1 (2/2, D5 (a)) : le bandeau d'accès nomme la lecture (démonstration, session fermée, chargement impossible)
// sans aucun bouton, et ne rend rien pendant la résolution des droits ni pour le propriétaire reconnu (aucun clignotement).

const TECHNICAL_WORDS = /Mode de consultation|canManage|permission-denied|Firestore/i;

describe('CartularyAccessNotice', () => {
  it('nomme la démonstration en lecture seule, quel que soit le statut du hook (désactivé en démo)', () => {
    const { container } = render(<CartularyAccessNotice demonstration status="idle" language="FR" />);
    const note = screen.getByRole('note');
    expect(note.className).toContain('cartulary-access-notice');
    expect(note.textContent).toContain('Démonstration en lecture seule');
    expect(note.textContent).toContain('Gabarit Cartulaire standard · données, documents, valeurs et médias fictifs.');
    expect(container.querySelector('button, input, a')).toBeNull();
    expect(note.textContent).not.toMatch(TECHNICAL_WORDS);
  });

  it('invite le propriétaire hors session à se reconnecter, en lecture seule', () => {
    render(<CartularyAccessNotice demonstration={false} status="signed-out" language="FR" />);
    const note = screen.getByRole('note');
    expect(note.textContent).toContain('Lecture seule');
    expect(note.textContent).toContain('Connectez-vous avec le compte propriétaire pour modifier ce Cartulaire.');
    expect(note.textContent).not.toContain('Démonstration');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each<AuthoritativeCartularyStatus>(['denied', 'error', 'empty'])('explique un chargement impossible (%s) sans message technique', (status) => {
    render(<CartularyAccessNotice demonstration={false} status={status} language="FR" />);
    const note = screen.getByRole('note');
    expect(note.textContent).toContain('Lecture seule');
    expect(note.textContent).toContain('Le Cartulaire n’a pas pu être chargé depuis le serveur ; seules les informations disponibles localement sont affichées.');
    expect(note.textContent).not.toContain('Démonstration');
    expect(note.textContent).not.toMatch(TECHNICAL_WORDS);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each<AuthoritativeCartularyStatus>(['idle', 'loading', 'ready'])('ne rend rien pendant la résolution des droits ni pour un Cartulaire chargé (%s)', (status) => {
    const { container } = render(<CartularyAccessNotice demonstration={false} status={status} language="FR" />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('garde la parité anglaise de chaque texte', () => {
    const { unmount } = render(<CartularyAccessNotice demonstration status="idle" language="EN" />);
    expect(screen.getByRole('note').textContent).toContain('Read-only demonstration');
    expect(screen.getByRole('note').textContent).toContain('Standard Cartulary template · fictional data, documents, values and media.');
    unmount();
    const signedOut = render(<CartularyAccessNotice demonstration={false} status="signed-out" language="EN" />);
    expect(screen.getByRole('note').textContent).toContain('Read-only');
    expect(screen.getByRole('note').textContent).toContain('Sign in with the owner account to edit this Cartulary.');
    signedOut.unmount();
    render(<CartularyAccessNotice demonstration={false} status="denied" language="EN" />);
    expect(screen.getByRole('note').textContent).toContain('The Cartulary could not be loaded from the server; only the information available locally is shown.');
    expect(screen.getByRole('note').textContent).not.toMatch(/[àéèç]/);
  });
});
