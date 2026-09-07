import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { BrandLogo } from '../../components/BrandLogo';
import { observeCartulariaSession } from '../../services/foundations';
import { personalVaultHref, safeAccountReturnPath } from './publicRoutes';
import {
  activateRegistryRecoveryKit, changeRecoveredRegistryPassword, createRegistryRecoveryKit,
  downloadRegistryRecoveryKit, loadRegistryRecoveryStatus, parseRegistryRecoveryKit,
  recoverRegistrySession, revokeRegistryRecoveryKit, type RegistryRecoveryKit, type RecoveryStatus,
} from '../../services/registryRecovery';
import './public-site.css';

export function RegistryRecoveryPage() {
  const management = window.location.pathname.endsWith('/security');
  const parameters = new URLSearchParams(window.location.search);
  const onboarding = parameters.get('onboarding') === '1';
  const returnTo = safeAccountReturnPath(parameters.get('returnTo'));
  const [statusAttempt, setStatusAttempt] = useState(0);
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  const [kit, setKit] = useState<RegistryRecoveryKit | null>(null);
  const [saved, setSaved] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [recovered, setRecovered] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const session = useRef({ uid: null as string | null, generation: 0 });
  const running = useRef(false);
  const fileGeneration = useRef(0);
  useEffect(() => {
    const unsubscribe = observeCartulariaSession((next) => {
    if (session.current.uid === (next?.uid ?? null)) { setUser(next); setChecking(false); return; }
    session.current = { uid: next?.uid ?? null, generation: session.current.generation + 1 };
    fileGeneration.current += 1;
    setUser(next); setChecking(false); setKit(null); setSaved(false); setDownloaded(false);
    setRecovered(false); setPassword(''); setConfirmation(''); setStatus(null); setError(''); setNotice('');
    });
    return () => { unsubscribe(); session.current.generation += 1; fileGeneration.current += 1; };
  }, []);
  useEffect(() => {
    if (!management || !user) return;
    let active = true;
    setStatus(null); setError('');
    void loadRegistryRecoveryStatus().then((next) => { if (active) setStatus(next); }, (failure) => {
      if (active) setError(String(failure?.code || '').includes('unauthenticated')
        ? 'Votre session doit être renouvelée pour vérifier le kit actif.'
        : 'Le service de secours est indisponible ou n’a pas répondu. Aucun kit actif n’est confirmé. Réessayez plus tard ; vous pouvez continuer vers le Registre.');
    });
    return () => { active = false; };
  }, [management, user, statusAttempt]);
  const run = async (operation: (assertCurrent: () => void) => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    const generation = session.current.generation;
    const assertCurrent = () => {
      if (session.current.generation !== generation) throw Object.assign(new Error('La session a changé.'), { code: 'recovery-session-changed' });
    };
    setBusy(true); setError(''); setNotice('');
    try { await operation(assertCurrent); }
    catch (failure) {
      const code = (failure as { code?: string }).code || '';
      setError(code === 'recovery-session-changed' ? 'La session a changé. Aucune réponse ancienne ne remplace le compte affiché ; préparez un nouveau kit.'
        : code.includes('unauthenticated') ? 'Reconnectez-vous avant de modifier votre kit de secours.'
        : code.includes('resource-exhausted') ? 'Trop de demandes : réessayez dans quelques minutes.'
        : 'L’opération n’a pas pu être confirmée. Vérifiez le kit et la connexion. Un kit révoqué ou un compte suspendu ne permet pas de récupérer l’accès.');
    } finally { running.current = false; setBusy(false); }
  };
  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirmation) { setError('Les mots de passe ne correspondent pas.'); return; }
    void run(async (assertCurrent) => {
      await changeRecoveredRegistryPassword(password); assertCurrent(); setPassword(''); setConfirmation('');
      setNotice('Le nouveau mot de passe du Registre est enregistré. Le mot de passe et les données du Coffre n’ont pas été modifiés.');
    });
  };
  return <div className="account-access-page service-information-page">
    <header className="account-access-header"><BrandLogo href="/" /><a href={returnTo}>Revenir au Registre</a></header>
    <main>
      <p className="public-kicker">Accès Registre · secours indépendant du Coffre</p>
      <h1>{management ? 'Préparer mon kit de secours' : 'Retrouver mon accès Registre'}</h1>
      {onboarding && <p role="status">Votre accès Registre est créé. Préparez si possible votre secours maintenant ; cette étape ne vous empêche pas de commencer votre premier objet.</p>}
      <p>Le kit contient une clé secrète : toute personne qui le possède peut ouvrir votre Registre. Conservez-le dans un gestionnaire de mots de passe ou un support protégé, séparé de cet appareil. Ne l’envoyez jamais par email ou au support.</p>
      <p>Il ne contient pas votre mot de passe et ne déchiffre pas le Coffre personnel, qui possède son propre secours. Sans kit préalablement activé, ce parcours ne peut pas rétablir votre accès.</p>
      {checking ? <p role="status">Vérification de la session…</p> : management ? <>
        {!user ? <a href="/account/sign-in?returnTo=%2Faccount%2Fsecurity">Se connecter pour préparer le kit</a> : <section className="recovery-panel">
          <p role="status">{status === null ? 'État du kit non confirmé.' : status.active ? `Kit actif depuis le ${new Date(status.createdAt!).toLocaleDateString('fr-FR')}.` : 'Aucun kit actif : préparez votre secours avant de conserver des documents importants.'}</p>
          <button type="button" className="public-solid-button" disabled={busy || status === null} onClick={() => void run(async (assertCurrent) => { const next = await createRegistryRecoveryKit(user); assertCurrent(); if (next.ownerUid !== user.uid) throw new Error('Kit incohérent.'); setKit(next); setSaved(false); setDownloaded(false); })}>{status?.active ? 'Préparer un kit de remplacement' : 'Préparer le kit'}</button>
          {kit && <div>
            <p>1. Téléchargez et rangez ce fichier. Le kit actuel, s’il existe, reste actif jusqu’à la confirmation de remplacement.</p>
            <button type="button" className="public-link-button" onClick={() => { downloadRegistryRecoveryKit(kit); setDownloaded(true); }}>Télécharger le kit secret</button>
            <label className="account-terms"><input type="checkbox" checked={saved} disabled={!downloaded} onChange={(event) => setSaved(event.target.checked)} /> J’ai conservé le fichier dans un emplacement protégé et accessible si je perds cet appareil.</label>
            <button type="button" className="public-solid-button" disabled={busy || !saved || !downloaded} onClick={() => void run(async (assertCurrent) => { await activateRegistryRecoveryKit(kit); assertCurrent(); const next = await loadRegistryRecoveryStatus(); assertCurrent(); if (!next.active || next.credentialId !== kit.credentialId) throw new Error('unconfirmed'); setStatus(next); setKit(null); setNotice('Kit activé et vérifié. Tout kit précédent a été remplacé.'); })}>2. Activer ce kit</button>
          </div>}
          {status?.active && <button type="button" className="public-link-button" disabled={busy} onClick={() => { if (window.confirm('Révoquer le kit ? Il ne permettra plus de récupérer cet accès. Votre mot de passe actuel reste valide.')) void run(async (assertCurrent) => { await revokeRegistryRecoveryKit(); assertCurrent(); const next = await loadRegistryRecoveryStatus(); assertCurrent(); setStatus(next); setNotice('Kit révoqué. Préparez un nouveau secours si nécessaire.'); }); }}>Révoquer le kit actif</button>}
          <p><a href="/account/sign-in?returnTo=%2Faccount%2Fsecurity">Renouveler ma connexion</a></p>
          <button type="button" className="public-link-button" disabled={busy} onClick={() => setStatusAttempt((value) => value + 1)}>Revérifier le service de secours</button>
          <p><a href={returnTo}>{onboarding ? 'Continuer vers mon Registre' : 'Ouvrir mon Registre'}</a></p>
        </section>}
      </> : <section className="recovery-panel">
        <label htmlFor="registry-recovery-file">Choisir mon fichier de secours Registre</label>
        <input id="registry-recovery-file" type="file" accept=".json,application/json" disabled={busy || recovered} onChange={(event) => {
          const file = event.target.files?.[0]; const selected = ++fileGeneration.current; setKit(null); setError('');
          if (!file) return;
          if (file.size > 32_768) { setError('Ce fichier est trop volumineux pour être un kit Registre.'); return; }
          void file.text().then((text) => { if (selected === fileGeneration.current) setKit(parseRegistryRecoveryKit(text)); }).catch(() => { if (selected === fileGeneration.current) setError('Fichier invalide, illisible ou destiné à un autre espace.'); });
        }} />
        <p>Le fichier est lu sur cet appareil. Sa clé privée n’est jamais envoyée au serveur.</p>
        {!recovered && <button type="button" className="public-solid-button" disabled={busy || !kit} onClick={() => void run(async () => { await recoverRegistrySession(kit!); setRecovered(true); setNotice('Accès Registre rétabli. Choisissez maintenant un nouveau mot de passe.'); })}>Récupérer mon accès</button>}
        {recovered && <form onSubmit={submitPassword}>
          <label htmlFor="recovery-password">Nouveau mot de passe du Registre</label><input id="recovery-password" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} />
          <label htmlFor="recovery-confirmation">Confirmer le nouveau mot de passe</label><input id="recovery-confirmation" type="password" autoComplete="new-password" minLength={12} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
          <button type="submit" className="public-solid-button" disabled={busy || password.length < 12 || confirmation !== password}>Enregistrer le nouveau mot de passe</button>
          <p><a href="/registry">Ouvrir mon Registre</a> · <a href="/account/security">Remplacer mon kit de secours</a></p>
        </form>}
        <p><a href="/account/sign-in">Revenir à la connexion</a> · <a href={personalVaultHref('recover')}>Récupérer plutôt mon Coffre</a></p>
      </section>}
      {busy && <p role="status">Vérification en cours…</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </main>
  </div>;
}
