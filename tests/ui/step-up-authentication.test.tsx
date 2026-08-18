import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({ currentUser: null as null | Record<string, unknown> }));
const firebaseAuth = vi.hoisted(() => ({
  credential: vi.fn(() => ({ providerId: 'password' })),
  getIdTokenResult: vi.fn(),
  reauthenticateWithCredential: vi.fn(),
}));

vi.mock('../../src/firebase', () => ({ auth: authState }));
vi.mock('firebase/auth', () => ({
  EmailAuthProvider: { credential: firebaseAuth.credential },
  getIdTokenResult: firebaseAuth.getIdTokenResult,
  onAuthStateChanged: vi.fn(() => () => undefined),
  reauthenticateWithCredential: firebaseAuth.reauthenticateWithCredential,
  signOut: vi.fn(),
}));

import { useStepUpAuthentication } from '../../src/security/useStepUpAuthentication.tsx';

const Harness = ({ operation }: { operation: () => Promise<void> }) => {
  const { runWithStepUp, stepUpDialog } = useStepUpAuthentication('FR');
  return <>
    <button type="button" onClick={() => void runWithStepUp('secret_export', operation, { required: true }).catch(() => undefined)}>Exporter</button>
    {stepUpDialog}
  </>;
};

describe('step-up ciblé', () => {
  beforeEach(() => {
    authState.currentUser = {
      email: 'owner@example.invalid',
      providerData: [{ providerId: 'password' }],
      getIdToken: vi.fn(async () => 'refreshed'),
    };
    firebaseAuth.getIdTokenResult.mockResolvedValue({ authTime: new Date().toISOString() });
    firebaseAuth.reauthenticateWithCredential.mockResolvedValue({});
  });

  it('laisse une opération critique récente continuer sans écran supplémentaire', async () => {
    const operation = vi.fn(async () => undefined);
    render(<Harness operation={operation} />);

    fireEvent.click(screen.getByRole('button', { name: 'Exporter' }));
    await waitFor(() => expect(operation).toHaveBeenCalledOnce());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(firebaseAuth.reauthenticateWithCredential).not.toHaveBeenCalled();
  });

  it('demande le mot de passe lorsque la connexion n’est plus récente', async () => {
    firebaseAuth.getIdTokenResult.mockResolvedValue({ authTime: new Date(Date.now() - 30 * 60_000).toISOString() });
    const operation = vi.fn(async () => undefined);
    render(<Harness operation={operation} />);

    fireEvent.click(screen.getByRole('button', { name: 'Exporter' }));
    expect(await screen.findByRole('dialog', { name: 'Confirmez votre identité' })).toBeTruthy();
    expect(operation).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'correct-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer et continuer' }));

    await waitFor(() => expect(firebaseAuth.reauthenticateWithCredential).toHaveBeenCalledOnce());
    await waitFor(() => expect(operation).toHaveBeenCalledOnce());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('annule sans lancer l’opération protégée', async () => {
    firebaseAuth.getIdTokenResult.mockResolvedValue({ authTime: new Date(Date.now() - 30 * 60_000).toISOString() });
    const operation = vi.fn(async () => undefined);
    render(<Harness operation={operation} />);

    fireEvent.click(screen.getByRole('button', { name: 'Exporter' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(operation).not.toHaveBeenCalled();
  });

  it('reste bloqué lorsque le mot de passe est refusé', async () => {
    firebaseAuth.getIdTokenResult.mockResolvedValue({ authTime: new Date(Date.now() - 30 * 60_000).toISOString() });
    firebaseAuth.reauthenticateWithCredential.mockRejectedValueOnce({ code: 'auth/invalid-credential' });
    const operation = vi.fn(async () => undefined);
    render(<Harness operation={operation} />);

    fireEvent.click(screen.getByRole('button', { name: 'Exporter' }));
    fireEvent.change(await screen.findByLabelText('Mot de passe'), { target: { value: 'incorrect' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer et continuer' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Mot de passe incorrect');
    expect(operation).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
