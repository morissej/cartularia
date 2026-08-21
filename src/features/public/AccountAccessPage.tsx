import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, FolderLock, KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react';
import { BrandLogo } from '../../components/BrandLogo';
import { createCartulariaAccount, signInToCartularia } from '../../services/foundations';
import { normalizeUserAlias } from '../../domain/personalDataBoundary';
import { personalVaultHref } from './publicRoutes';
import './public-site.css';

const friendlyAccountError = (error: unknown, creation: boolean) => {
  const code = (error as { code?: string }).code || (error instanceof Error ? error.message : '');
  if (code.includes('email-already-in-use')) return 'Ce nom utilisateur existe déjà dans le Registre. Utilisez la connexion.';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'Nom utilisateur ou mot de passe du Registre incorrect.';
  if (code.includes('weak-password') || code === 'weak_password') return 'Le mot de passe du Registre doit comporter au moins 12 caractères.';
  if (code === 'invalid_user_name') return 'Le nom utilisateur doit comporter au moins 3 caractères.';
  return creation
    ? 'Le compte n’a pas pu être activé complètement. Réessayez ou contactez le support sans communiquer votre mot de passe.'
    : 'Connexion impossible. Vérifiez vos identifiants et réessayez.';
};

export function AccountAccessPage() {
  const creation = window.location.pathname.endsWith('/create');
  const requestedSpace = new URLSearchParams(window.location.search).get('space');
  const [userName, setUserName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const vaultHref = useMemo(() => personalVaultHref(creation ? 'create' : 'sign-in'), [creation]);

  useEffect(() => {
    document.title = `${creation ? 'Créer un compte' : 'Connexion'} · Cartularia`;
  }, [creation]);

  const submitRegistry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = normalizeUserAlias(userName);
    if (creation && password !== confirmation) {
      setError('Les deux saisies du mot de passe Registre ne correspondent pas.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      if (creation) await createCartulariaAccount(normalized, password);
      else await signInToCartularia(normalized, password);
      window.location.assign('/registry');
    } catch (nextError) {
      setError(friendlyAccountError(nextError, creation));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="account-access-page">
      <header className="account-access-header">
        <BrandLogo href="/" />
        <a href="/"><ArrowLeft aria-hidden="true" /> Retour à l’accueil</a>
      </header>

      <main>
        <section className="account-access-intro">
          <p className="public-kicker">{creation ? 'Création du compte' : 'Connexion sécurisée'}</p>
          <h1>{creation ? 'Un nom utilisateur, deux clés différentes.' : 'Quel espace souhaitez-vous ouvrir ?'}</h1>
          <p>{creation
            ? 'Créez séparément vos accès au Registre et au Coffre personnel. Réutilisez le même pseudonyme, jamais le même mot de passe.'
            : 'Le Registre et le Coffre personnel sont deux interfaces séparées. Chacune exige son propre mot de passe.'}</p>
          <div className="account-identity-rule"><ShieldCheck aria-hidden="true" /><span><strong>Règle essentielle</strong><small>Nom utilisateur identique · mots de passe distincts · aucun mot de passe communiqué à Cartularia.</small></span></div>
        </section>

        <section className="account-space-grid" aria-label={creation ? 'Création des deux accès' : 'Choix de l’espace de connexion'}>
          <article className={requestedSpace === 'vault' ? '' : 'is-primary'}>
            <header>
              <span className="account-space-number">01</span>
              <KeyRound aria-hidden="true" />
              <div><p>Interface principale</p><h2>Registre</h2></div>
            </header>
            <p>Gérez vos collections, Cartulaires, échéances, accès et décisions de publication.</p>
            <form onSubmit={submitRegistry}>
              <label htmlFor="account-registry-user">Nom utilisateur</label>
              <input id="account-registry-user" value={userName} onChange={(event) => setUserName(event.target.value)} autoComplete="username" minLength={3} maxLength={64} required placeholder="Votre pseudonyme Cartularia" />
              <label htmlFor="account-registry-password">Mot de passe du Registre</label>
              <input id="account-registry-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={creation ? 'new-password' : 'current-password'} minLength={12} required />
              {creation && <>
                <label htmlFor="account-registry-confirmation">Confirmer le mot de passe du Registre</label>
                <input id="account-registry-confirmation" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" minLength={12} required />
                <label className="account-terms"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} required /><span>J’accepte les conditions d’utilisation et la politique de confidentialité applicables au compte.</span></label>
              </>}
              {error && <p className="account-form-error" role="alert">{error}</p>}
              <button type="submit" disabled={submitting || normalizeUserAlias(userName).length < 3 || password.length < 12 || (creation && (!accepted || confirmation.length < 12))}>
                {submitting ? <LoaderCircle className="account-spinner" aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
                {submitting ? (creation ? 'Activation…' : 'Connexion…') : (creation ? 'Créer l’accès Registre' : 'Ouvrir le Registre')}
              </button>
            </form>
          </article>

          <article className={requestedSpace === 'vault' ? 'is-primary' : ''}>
            <header>
              <span className="account-space-number">02</span>
              <FolderLock aria-hidden="true" />
              <div><p>Interface personnelle séparée</p><h2>Coffre personnel</h2></div>
            </header>
            <p>Conservez vos identités, coordonnées, lieux réels, gestionnaires et intentions de transmission dans la base chiffrée dédiée.</p>
            <ul>
              <li><Check aria-hidden="true" /> Reprenez exactement le même nom utilisateur.</li>
              <li><Check aria-hidden="true" /> Choisissez un autre mot de passe, de 12 caractères minimum.</li>
              <li><Check aria-hidden="true" /> La clé de déchiffrement reste dans votre session.</li>
            </ul>
            <a className="account-vault-action" href={vaultHref}>
              {creation ? 'Créer l’accès au Coffre' : 'Ouvrir le Coffre'} <ArrowRight aria-hidden="true" />
            </a>
            <small>Le Coffre s’ouvre sur son interface dédiée. Cartularia ne transfère aucun mot de passe entre les deux espaces.</small>
          </article>
        </section>

        <p className="account-switch-mode">{creation ? 'Vous avez déjà créé vos deux accès ?' : 'Vous n’avez pas encore de compte ?'} <a href={creation ? '/account/sign-in' : '/account/create'}>{creation ? 'Se connecter' : 'Créer un compte'}</a></p>
      </main>
    </div>
  );
}

