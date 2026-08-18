import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { auth } from '../firebase';
import { useDialogFocus } from '../hooks/useDialogFocus';
import {
  reauthenticatePasswordUser,
  userAuthenticationIsRecent,
} from './sessionSecurity';

export type StepUpPurpose =
  | 'cloud_delete'
  | 'secret_export'
  | 'transfer_propose'
  | 'transfer_accept'
  | 'transfer_reject';

export class StepUpCancelledError extends Error {
  constructor() {
    super('step_up_cancelled');
    this.name = 'StepUpCancelledError';
  }
}

export class StepUpAuthenticationUnavailableError extends Error {
  constructor() {
    super('step_up_authentication_unavailable');
    this.name = 'StepUpAuthenticationUnavailableError';
  }
}

export const isStepUpCancellation = (error: unknown) => error instanceof StepUpCancelledError;

interface PendingStepUp {
  purpose: StepUpPurpose;
  resolve: () => void;
  reject: (error: Error) => void;
}

const purposeLabel = (purpose: StepUpPurpose, language: 'FR' | 'EN') => {
  const labels: Record<StepUpPurpose, { FR: string; EN: string }> = {
    cloud_delete: { FR: 'supprimer la copie privée cloud', EN: 'delete the private cloud copy' },
    secret_export: { FR: 'exporter le carnet secret', EN: 'export the secret journal' },
    transfer_propose: { FR: 'proposer la cession du Cartulaire', EN: 'propose the Cartulary transfer' },
    transfer_accept: { FR: 'accepter la cession du Cartulaire', EN: 'accept the Cartulary transfer' },
    transfer_reject: { FR: 'refuser la cession du Cartulaire', EN: 'reject the Cartulary transfer' },
  };
  return labels[purpose][language];
};

const reauthenticationMessage = (error: unknown, language: 'FR' | 'EN') => {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code === 'auth/too-many-requests') {
    return language === 'FR'
      ? 'Trop de tentatives. Patientez quelques minutes avant de réessayer.'
      : 'Too many attempts. Wait a few minutes before trying again.';
  }
  if (error instanceof Error && error.message === 'password_reauthentication_unavailable') {
    return language === 'FR'
      ? 'Ce compte ne peut pas être reconfirmé par mot de passe. Déconnectez-vous puis reconnectez-vous avec sa méthode habituelle.'
      : 'This account cannot be reconfirmed with a password. Sign out, then sign in again with its usual method.';
  }
  return language === 'FR'
    ? 'Mot de passe incorrect ou session non vérifiable.'
    : 'Incorrect password or unverifiable session.';
};

export const useStepUpAuthentication = (language: 'FR' | 'EN') => {
  const [pending, setPending] = useState<PendingStepUp | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const cancel = useCallback(() => {
    const request = pending;
    if (!request || submitting) return;
    setPending(null);
    setPassword('');
    setError(null);
    request.reject(new StepUpCancelledError());
  }, [pending, submitting]);

  useDialogFocus(Boolean(pending), dialogRef, cancel);

  useEffect(() => () => {
    pending?.reject(new StepUpCancelledError());
  }, [pending]);

  const runWithStepUp = useCallback(async <T,>(
    purpose: StepUpPurpose,
    operation: () => Promise<T>,
    options: { required?: boolean } = {},
  ): Promise<T> => {
    const user = auth.currentUser;
    if (!user) {
      if (options.required) throw new StepUpAuthenticationUnavailableError();
      return operation();
    }

    let recent = false;
    try {
      recent = await userAuthenticationIsRecent(user);
    } catch {
      recent = false;
    }
    if (!recent) {
      await new Promise<void>((resolve, reject) => {
        setPassword('');
        setError(null);
        setPending({ purpose, resolve, reject });
      });
    }
    return operation();
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pending || !password || submitting) return;
    const user = auth.currentUser;
    if (!user) {
      setError(language === 'FR' ? 'La session a expiré. Reconnectez-vous.' : 'The session expired. Sign in again.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await reauthenticatePasswordUser(user, password);
      const request = pending;
      setPending(null);
      setPassword('');
      request.resolve();
    } catch (nextError) {
      setError(reauthenticationMessage(nextError, language));
    } finally {
      setSubmitting(false);
    }
  };

  const stepUpDialog = pending ? (
    <div className="modal-overlay">
      <div
        ref={dialogRef}
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="step-up-title"
        aria-describedby="step-up-description"
        data-focus-layer="true"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">{language === 'FR' ? 'Contrôle de sécurité ciblé' : 'Targeted security check'}</span>
            <strong id="step-up-title">{language === 'FR' ? 'Confirmez votre identité' : 'Confirm your identity'}</strong>
          </div>
        </div>
        <form onSubmit={(event) => void submit(event)} style={{ display: 'grid', gap: 'var(--s3)', padding: 'var(--s4)' }}>
          <p id="step-up-description" style={{ margin: 0, color: 'var(--muted)', lineHeight: 1.5 }}>
            {language === 'FR'
              ? `Pour ${purposeLabel(pending.purpose, language)}, confirmez le mot de passe de votre compte. Cette vérification n’est demandée que lorsque votre connexion n’est plus récente.`
              : `To ${purposeLabel(pending.purpose, language)}, confirm your account password. This check is only requested when your sign-in is no longer recent.`}
          </p>
          <label style={{ display: 'grid', gap: '6px' }}>
            <span>{language === 'FR' ? 'Mot de passe' : 'Password'}</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              disabled={submitting}
              required
            />
          </label>
          {error && <p role="alert" style={{ margin: 0, color: 'var(--mark)' }}>{error}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--s2)' }}>
            <button type="button" className="button button--quiet" onClick={cancel} disabled={submitting}>
              {language === 'FR' ? 'Annuler' : 'Cancel'}
            </button>
            <button type="submit" className="button button--primary" disabled={!password || submitting}>
              {submitting
                ? (language === 'FR' ? 'Vérification…' : 'Checking…')
                : (language === 'FR' ? 'Confirmer et continuer' : 'Confirm and continue')}
            </button>
          </div>
        </form>
      </div>
    </div>
  ) : null;

  return { runWithStepUp, stepUpDialog };
};
