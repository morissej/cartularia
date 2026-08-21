import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { isSignInWithEmailLink, signInWithEmailLink } from 'firebase/auth';
import { CheckCircle2, LoaderCircle, LockKeyhole, Mail } from 'lucide-react';
import { BrandLogo } from '../../components/BrandLogo.tsx';
import { auth } from '../../firebase.ts';
import { acceptRegistryAccess } from '../../services/access.ts';
import './registry.css';

const invitationParameters = (href: string) => {
  const url = new URL(href);
  const nested = url.searchParams.get('continueUrl');
  const source = nested ? new URL(nested) : url;
  return {
    invitationId: source.searchParams.get('invitationId') || '',
    token: source.searchParams.get('token') || '',
  };
};

export function RegistryInvitationPage() {
  const parameters = useMemo(() => invitationParameters(window.location.href), []);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'ready' | 'working' | 'accepted' | 'error'>('ready');
  const [message, setMessage] = useState('');
  const [destination, setDestination] = useState('/registry');
  const validLink = parameters.invitationId && parameters.token && isSignInWithEmailLink(auth, window.location.href);

  useEffect(() => {
    if (!validLink) {
      setStatus('error');
      setMessage("Ce lien d’invitation est incomplet ou n’est plus un lien de connexion valide.");
    }
  }, [validLink]);

  const accept = async (event: FormEvent) => {
    event.preventDefault();
    if (!validLink || !email.trim()) return;
    setStatus('working');
    setMessage('');
    try {
      await signInWithEmailLink(auth, email.trim(), window.location.href);
      const result = await acceptRegistryAccess(parameters.invitationId, parameters.token);
      const next = result.scopeType === 'cartulary'
        ? `/?cartularyId=${encodeURIComponent(result.scopeId)}&returnTo=${encodeURIComponent(`/registry/${result.registryId}/items`)}`
        : `/registry/${encodeURIComponent(result.registryId)}/items`;
      setDestination(next);
      setStatus('accepted');
      setMessage('Votre adresse a été vérifiée et l’accès a été activé uniquement pour le périmètre invité.');
    } catch {
      setStatus('error');
      setMessage("Impossible d’accepter cette invitation. Vérifiez l’adresse destinataire ; le lien peut aussi être expiré, révoqué ou déjà utilisé par un autre compte.");
    }
  };

  return (
    <main className="registry-auth-page registry-invitation-page">
      <section className="registry-auth-intro" aria-labelledby="invitation-title">
        <div className="registry-auth-logo"><BrandLogo /></div>
        <p className="registry-kicker">Invitation sécurisée</p>
        <h1 id="invitation-title">Accéder à Cartularia</h1>
        <p>Le lien vérifie votre adresse électronique avant d’activer le droit prévu par l’invitant.</p>
        <div className="registry-auth-principle"><LockKeyhole aria-hidden="true" /><span>Aucun mot de passe n’est transmis ou choisi par l’administrateur.</span></div>
      </section>
      <section className="registry-auth-panel" aria-label="Acceptation de l’invitation">
        {status !== 'accepted' ? (
          <>
            <div><span className="registry-step">01</span><h2>Confirmer votre adresse</h2><p>Saisissez exactement l’adresse à laquelle l’invitation a été envoyée.</p></div>
            <form onSubmit={accept}>
              <label htmlFor="invitation-email">Adresse électronique</label>
              <input id="invitation-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
              {message && <p className="registry-form-error" role="alert">{message}</p>}
              <button type="submit" disabled={status === 'working' || !validLink || !email.trim()}>
                {status === 'working' ? <LoaderCircle className="registry-spinner" aria-hidden="true" /> : <Mail aria-hidden="true" />}
                {status === 'working' ? 'Vérification…' : "Accepter l’invitation"}
              </button>
            </form>
          </>
        ) : (
          <div className="registry-invitation-success" role="status">
            <CheckCircle2 aria-hidden="true" />
            <span className="registry-step">02</span>
            <h2>Accès activé</h2>
            <p>{message}</p>
            <a className="button button--primary" href={destination}>Ouvrir le contenu autorisé</a>
          </div>
        )}
      </section>
    </main>
  );
}

export default RegistryInvitationPage;
