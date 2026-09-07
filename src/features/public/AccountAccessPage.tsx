import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, FolderLock, KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react';
import { BrandLogo } from '../../components/BrandLogo';
import { createCartulariaAccount, resumeRegistryAccountActivation, signInToCartularia } from '../../services/foundations';
import { normalizeUserAlias } from '../../domain/personalDataBoundary';
import { DEMO_ACCOUNT } from '../../data/demoCartularies.ts';
import { personalVaultHref, safeAccountReturnPath } from './publicRoutes';
import './public-site.css';

const friendlyAccountError = (error: unknown, creation: boolean) => {
  const code = (error as { code?: string }).code || (error instanceof Error ? error.message : '');
  if (code.includes('email-already-in-use')) return 'Ce nom utilisateur existe déjà dans le Registre. Utilisez la connexion.';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'Nom utilisateur ou mot de passe du Registre incorrect.';
  if (code.includes('weak-password') || code === 'weak_password') return 'Le mot de passe du Registre doit comporter au moins 12 caractères.';
  if (code === 'invalid_user_name') return 'Le nom utilisateur doit comporter au moins 3 caractères.';
  if (code === 'account/activation-incomplete') return 'Votre identité est créée, mais le Registre n’est pas encore prêt. Vous pouvez terminer sa création sans créer un autre compte.';
  if (code.includes('network-request-failed')) return 'Le service de connexion est injoignable. Vérifiez votre connexion et réessayez.';
  if (code.includes('too-many-requests')) return 'Trop de tentatives. Patientez quelques minutes avant de réessayer.';
  return creation
    ? 'Le compte n’a pas pu être activé complètement. Réessayez ou contactez le support sans communiquer votre mot de passe.'
    : 'Le service de connexion n’a pas confirmé l’ouverture du Registre. Réessayez ou contactez le support, sans communiquer votre mot de passe.';
};

export function AccountAccessPage() {
  const creation = window.location.pathname.endsWith('/create');
  const parameters = new URLSearchParams(window.location.search);
  const requestedSpace = parameters.get('space');
  const demoRequested = !creation && parameters.get('demo') === '1';
  const returnTo = safeAccountReturnPath(parameters.get('returnTo'));
  const [userName, setUserName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [demoError, setDemoError] = useState('');
  const [activationPending, setActivationPending] = useState(parameters.get('resume') === '1');
  const vaultHref = useMemo(() => personalVaultHref(creation ? 'create' : 'sign-in'), [creation]);

  useEffect(() => {
    document.title = `${creation ? 'Créer un compte' : 'Connexion'} · Cartularia`;
    if (requestedSpace === 'vault') window.location.replace(vaultHref);
  }, [creation, requestedSpace, vaultHref]);

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
      window.location.assign(creation ? `/account/security?onboarding=1&returnTo=${encodeURIComponent(returnTo)}` : returnTo);
    } catch (nextError) {
      setActivationPending((nextError as { code?: string }).code === 'account/activation-incomplete');
      setError(friendlyAccountError(nextError, creation));
    } finally {
      setSubmitting(false);
    }
  };

  const finishActivation = async () => {
    setSubmitting(true);
    setError('');
    try {
      await resumeRegistryAccountActivation(userName);
      window.location.assign(`/account/security?onboarding=1&returnTo=${encodeURIComponent(returnTo)}`);
    } catch (nextError) {
      setError((nextError as Error).message === 'account/sign-in-required'
        ? 'Connectez-vous avec le nom utilisateur et le mot de passe déjà choisis pour reprendre la création.'
        : friendlyAccountError(nextError, true));
    } finally { setSubmitting(false); }
  };

  const openDemoRegistry = async () => {
    setSubmitting(true);
    setError('');
    setDemoError('');
    try {
      await signInToCartularia(DEMO_ACCOUNT.userName, DEMO_ACCOUNT.password);
      window.location.assign(`/registry/${encodeURIComponent(DEMO_ACCOUNT.registryId)}/items`);
    } catch (nextError) {
      const code = String((nextError as { code?: string }).code || '');
      // Diagnostic code only: never log credentials, request bodies or tokens.
      console.warn('Cartularia demo access:', code || 'unknown');
      setDemoError(code.includes('too-many-requests') ? 'La démonstration reçoit trop de demandes. Réessayez dans quelques minutes.'
        : 'Le Registre de démonstration n’a pas pu être ouvert. Aucun identifiant personnel n’est nécessaire : réessayez ou explorez le Cartulaire fictif sans connexion.');
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
          <h1>{creation ? 'Commencez par votre Registre.' : 'Ouvrez votre Registre.'}</h1>
          <p>{creation
            ? 'Créez votre accès, ajoutez votre premier objet, puis ouvrez un Coffre séparé si vous souhaitez conserver des informations personnelles.'
            : 'Le Registre et le Coffre personnel sont deux interfaces séparées. Chacune exige son propre mot de passe.'}</p>
          <div className="account-identity-rule"><ShieldCheck aria-hidden="true" /><span><strong>Règle essentielle</strong><small>Nom utilisateur identique · mots de passe distincts · aucun mot de passe communiqué à Cartularia.</small></span></div>
          {creation && <ol className="account-progress" aria-label="Étapes de démarrage"><li aria-current="step">1. Créer l’accès Registre</li><li>2. Ajouter un premier objet</li><li>3. Ouvrir le Coffre si nécessaire</li></ol>}
        </section>

        {!creation && (
          <section className={`account-demo-access${demoRequested ? ' is-requested' : ''}`} aria-labelledby="account-demo-title">
            <div>
              <span className="account-space-number">Démo</span>
              <h2 id="account-demo-title">Explorer un Registre prêt à l’emploi</h2>
              <p>Cinq Cartulaires fictifs et réalistes : Rolex Submariner, Audemars Piguet Royal Oak, Tudor Black Bay Chrono, Jaeger-LeCoultre Reverso et Breguet Classique.</p>
              <small>Compte partagé strictement en lecture seule · aucune donnée personnelle · aucune création, modification ou publication possible.</small>
            </div>
            <button type="button" onClick={() => void openDemoRegistry()} disabled={submitting}>
              {submitting ? <LoaderCircle className="account-spinner" aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
              {submitting ? 'Ouverture de la démo…' : 'Ouvrir le Registre démo'}
            </button>
            {demoError && <div><p role="alert">{demoError}</p><a href="/cartulary-demo?cartularyId=cart_demo_rolex_submariner_124060#cover">Explorer le Cartulaire fictif sans connexion</a></div>}
          </section>
        )}

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
              <input id="account-registry-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={creation ? 'new-password' : 'current-password'} minLength={creation ? 12 : undefined} required />
              {creation && <>
                <label htmlFor="account-registry-confirmation">Confirmer le mot de passe du Registre</label>
                <input id="account-registry-confirmation" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" minLength={12} required />
                <label className="account-terms"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} required /><span>J’accepte les <a href="/conditions" target="_blank" rel="noopener">conditions d’utilisation</a> et la <a href="/confidentialite" target="_blank" rel="noopener">politique de confidentialité</a> applicables au compte.</span></label>
              </>}
              {error && <p className="account-form-error" role="alert">{error}</p>}
              <button type="submit" disabled={submitting || normalizeUserAlias(userName).length < 3 || password.length < (creation ? 12 : 1) || (creation && (!accepted || confirmation.length < 12))}>
                {submitting ? <LoaderCircle className="account-spinner" aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
                {submitting ? (creation ? 'Activation…' : 'Connexion…') : (creation ? 'Créer l’accès Registre' : 'Ouvrir le Registre')}
              </button>
              {activationPending && <button type="button" onClick={() => void finishActivation()} disabled={submitting}>Terminer la création de mon Registre</button>}
              {!creation && <a href="/account/recovery">Mot de passe oublié ? Utiliser mon kit de secours</a>}
              {creation && <p>Après création, <a href="/account/security">préparez votre kit de secours</a>. Sans kit activé ni mot de passe, ce parcours ne pourra pas rétablir l’accès.</p>}
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

        <p className="account-switch-mode">{creation ? 'Vous avez déjà un accès Registre ?' : 'Vous n’avez pas encore de compte ?'} <a href={`${creation ? '/account/sign-in' : '/account/create'}?returnTo=${encodeURIComponent(returnTo)}`}>{creation ? 'Se connecter' : 'Créer un compte'}</a></p>
      </main>
    </div>
  );
}
