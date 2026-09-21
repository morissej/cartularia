import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { Eye, EyeOff, KeyRound, Link2, LockKeyhole, Plus, Save, ShieldCheck, Trash2, UserCog } from 'lucide-react';
import type { User } from 'firebase/auth';
import { normalizeStorageCodeName, normalizeUserAlias } from '../domain/personalDataBoundary';
import { generateCorrespondenceCode } from '../domain/correspondenceCodes';
import type { OwnerField } from '../features/cartulary/state/cartularyStateTypes';
import { personalVaultIsConfigured } from './firebase';
import { loadOwnerObjectCodes, saveCodeCorrespondences } from './codeBridgeRepository';
import { authenticatePersonalVault, loadPersonalVault, lockPersonalVault, savePersonalVault } from './repository';
import { useVaultDraft } from './useVaultDraft';
import { observePersonalVaultSession, personalVaultSessionMatches, type PersonalVaultLockReason } from './sessionSecurity';
import { forgetLockedVaultDraft, preserveLockedVaultDraft, readLockedVaultDraft } from './lockedDraft';
import { saveVaultAndCodes } from './vaultSaveWorkflow';
import { CodeHandoffSender } from './CodeHandoffSender';
import { PersonalRecoveryPanel, RecoveryAccessForm, type RecoveredPersonalSession } from './PersonalRecovery';
import type { PersonalRecoveryKit } from './recoveryCrypto';
import {
  createEmptyManager,
  createEmptyOwnerProfile,
  createEmptyStorageLocation,
  createEmptyTransmissionPlan,
  emptyPersonalVaultPayload,
  type PersonalManager,
  type PersonalOwnerProfile,
  type PersonalStorageLocation,
  type PersonalTransmissionPlan,
  type PersonalTransmissionRecipient,
  type PersonalVaultPayload,
} from './types';
import './personalVault.css';

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const isAddressField = (field: OwnerField) => field.label.trim().toLocaleLowerCase('fr').includes('adresse');
const registryHref = (path: '/' | '/registry') => {
  const configured = import.meta.env.VITE_REGISTRY_SITE_URL?.trim();
  const base = configured || (import.meta.env.DEV ? window.location.origin : 'https://studio-2614005370-a3e51.web.app');
  return new URL(path, base).toString();
};

function CodeBadge({ children }: { children: string }) {
  return <code className="vault-code"><KeyRound size={13} />{children}</code>;
}

export function PersonalVaultApp() {
  const [creationMode, setCreationMode] = useState(() => new URLSearchParams(window.location.search).get('mode') === 'create');
  const [userName, setUserName] = useState('');
  const [password, setPassword] = useState('');
  // Only a successfully authenticated/decrypted secret may encrypt a save.
  // The login draft must never become the unlocked session's key.
  const [sessionSecret, setSessionSecret] = useState<{ uid: string; password: string } | null>(null);
  const activeSecret = useRef<{ uid: string; password: string } | null>(null);
  const [lockedDraft, setLockedDraft] = useState<PersonalVaultPayload | null>(null);
  const [draftProblem, setDraftProblem] = useState('');
  const opening = useRef(false);
  const openingGeneration = useRef<number | null>(null);
  const openingUid = useRef<string | null>(null);
  const accessGeneration = useRef(0);
  const [confirmation, setConfirmation] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [bridgeUser, setBridgeUser] = useState<User | null>(null);
  const { payload, setPayload, restore, acknowledge, dirty, current } = useVaultDraft();
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [message, setMessage] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);
  const recoveringAccess = useRef(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const recoverySnapshot = useRef<{ payload: PersonalVaultPayload | null; generation: number } | null>(null);
  const [codeSyncPending, setCodeSyncPending] = useState(false);
  const [codeSyncProblem, setCodeSyncProblem] = useState('');
  const [recoveryConflict, setRecoveryConflict] = useState(false);
  const [rotationUncertain, setRotationUncertain] = useState(false);
  const [recoveryKit, setRecoveryKit] = useState<PersonalRecoveryKit | null>(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Coffre personnel · Cartularia';
    return () => { document.title = previousTitle; accessGeneration.current += 1; };
  }, []);

  const lockSession = useRef<(reason: PersonalVaultLockReason) => void>(() => {});
  useEffect(() => observePersonalVaultSession({
    getUid: () => activeSecret.current?.uid || openingUid.current,
    getGeneration: () => accessGeneration.current,
    isOpening: () => opening.current || recoveringAccess.current,
    onLock: (reason) => lockSession.current(reason),
  }), [user?.uid]);

  const authenticateVault = async (createAccount = false) => {
    if (busy || recoveryBusy || opening.current) return;
    if (!personalVaultIsConfigured) return setMessage('Le Coffre est temporairement indisponible. Son accès séparé doit être rétabli.');
    if (normalizeUserAlias(userName).length < 3 || password.length < 12) {
      return setMessage('Utilisez un nom utilisateur valide et un mot de passe d’au moins 12 caractères.');
    }
    if (createAccount && password !== confirmation) return setMessage('Les deux mots de passe du Coffre ne correspondent pas.');
    opening.current = true;
    const generation = ++accessGeneration.current;
    openingGeneration.current = generation;
    const confirmedPassword = password;
    const normalizedName = normalizeUserAlias(userName);
    const assertCurrent = () => {
      if (generation !== accessGeneration.current) throw Object.assign(new Error('Ouverture remplacée.'), { code: 'vault-opening-stale' });
    };
    setBusy(true);
    setMessage('');
    try {
      const session = await authenticatePersonalVault({ userAlias: normalizedName, password: confirmedPassword, createAccount });
      assertCurrent();
      if (!personalVaultSessionMatches(session.personalUser.uid)) throw Object.assign(new Error('Session remplacée.'), { code: 'vault-opening-stale' });
      openingUid.current = session.personalUser.uid;
      const existing = await loadPersonalVault({ user: session.personalUser, userAlias: normalizedName, password: confirmedPassword, isCurrent: () => generation === accessGeneration.current && personalVaultSessionMatches(session.personalUser.uid) });
      assertCurrent();
      const bridgeCodes = await loadOwnerObjectCodes(session.bridgeUser);
      assertCurrent();
      if (!personalVaultSessionMatches(session.personalUser.uid)) throw Object.assign(new Error('Session remplacée.'), { code: 'vault-opening-stale' });
      let preserved: PersonalVaultPayload | null = null;
      let preservedProblem = '';
      try { preserved = await readLockedVaultDraft(session.personalUser.uid, confirmedPassword, normalizedName); }
      catch { preservedProblem = 'Un brouillon local chiffré existe peut-être, mais sa lecture a échoué. Il a été conservé ; ne le supprimez pas avant de vérifier le mot de passe utilisé lors du verrouillage.'; }
      assertCurrent();
      if (!personalVaultSessionMatches(session.personalUser.uid)) throw Object.assign(new Error('Session remplacée.'), { code: 'vault-opening-stale' });
      const restored = existing ? {
        ...existing,
        owners: existing.owners.map((owner) => ({
          ...owner,
          objectCodes: bridgeCodes.get(owner.clientNumber) ?? owner.objectCodes,
        })),
      } : emptyPersonalVaultPayload(normalizedName);
      setUser(session.personalUser);
      activeSecret.current = { uid: session.personalUser.uid, password: confirmedPassword };
      setSessionSecret(activeSecret.current);
      setLockedDraft(preserved);
      setDraftProblem(preservedProblem);
      setPassword('');
      setBridgeUser(session.bridgeUser);
      setUserName(normalizedName);
      restore(restored, Boolean(existing));
      setCodeSyncPending(existing?.codeSyncPending === true);
      setCodeSyncProblem('');
      setConfirmation('');
      setRecoveryKit(null);
      setRotationUncertain(false);
      setRecoveryConflict(false);
      setMessage(existing ? 'Coffre patrimonial déchiffré dans cette session.' : 'Nouveau coffre patrimonial prêt à être enregistré.');
    } catch (error) {
      if (openingGeneration.current !== generation) return;
      if ((error as { code?: string }).code === 'vault-opening-stale') {
        setMessage('Les identifiants ont changé pendant l’ouverture. Réessayez avec les identifiants affichés.');
        return;
      }
      if (import.meta.env.DEV) console.error('[Coffre personnel] Ouverture impossible.', error);
      setMessage('Ouverture impossible. Vérifiez le nom utilisateur et le mot de passe dédiés.');
    } finally {
      if (openingGeneration.current === generation) { opening.current = false; openingUid.current = null; openingGeneration.current = null; setBusy(false); }
    }
  };

  const save = async (andLock = false) => {
    if (!user || !sessionSecret || sessionSecret.uid !== user.uid || !current.current || saving.current || recoveryBusy || rotationUncertain || lockedDraft || draftProblem) return;
    const generation = accessGeneration.current;
    const isCurrent = () => generation === accessGeneration.current && activeSecret.current?.uid === user.uid && personalVaultSessionMatches(user.uid);
    const assertCurrent = () => { if (!isCurrent()) throw Object.assign(new Error('Session verrouillée.'), { code: 'vault-session-stale' }); };
    if (!isCurrent()) return;
    saving.current = true;
    setBusy(true);
    setSaveFailed(false);
    setCodeSyncProblem('');
    const captured = current.current;
    try {
      const updated = { ...captured, updatedAt: new Date().toISOString() };
      const saved = await saveVaultAndCodes(updated,
        (value) => { assertCurrent(); return savePersonalVault({ user, payload: value, password: sessionSecret.password, isCurrent }); },
        async (value, receipt) => {
          assertCurrent();
          if (!bridgeUser) throw new Error('Session de correspondance absente.');
          await saveCodeCorrespondences(bridgeUser, value, receipt);
        }, (error) => {
          if (!isCurrent()) return;
          const code = (error as { code?: string }).code;
          if (code?.startsWith('code-sync-') && error instanceof Error) setCodeSyncProblem(error.message);
          else if (code === 'vault-conflict') setCodeSyncProblem('Une autre session a enregistré le Coffre. Rouvrez sa dernière version ; l’ancienne confirmation n’a rien écrasé.');
        });
      assertCurrent();
      acknowledge(saved);
      if (current.current === captured) {
        try { forgetLockedVaultDraft(user.uid); } catch { /* A retained encrypted copy is safe to keep. */ }
        setLockedDraft(null);
      }
      setCodeSyncPending(saved.codeSyncPending === true);
      setMessage(saved.codeSyncPending
        ? 'Coffre chiffré enregistré. La synchronisation des codes reste à confirmer ; consultez l’attente ci-dessus avant de poursuivre.'
        : 'Coffre chiffré enregistré ; codes synchronisés dans la base de correspondance.');
      if (andLock && current.current === captured) {
        try { await performLock(saved.codeSyncPending); }
        catch { setMessage('Coffre enregistré. Le verrouillage n’a pas été confirmé ; réessayez de verrouiller.'); }
      }
      else if (andLock) setMessage('La sauvegarde est terminée. De nouvelles saisies restent à enregistrer avant de verrouiller.');
    } catch (error) {
      if (!isCurrent()) return;
      if (['permission-denied', 'unauthenticated', 'auth/user-disabled', 'auth/user-token-expired', 'auth/invalid-user-token'].includes((error as { code?: string }).code || '')) {
        lockSession.current('authentication');
        return;
      }
      setSaveFailed(true);
      setMessage((error as { code?: string }).code === 'vault-conflict'
        ? 'Le Coffre a changé dans une autre session. Vos saisies restent affichées. Conservez-les avant de rouvrir la dernière version ; aucune modification distante n’a été écrasée.'
        : 'Enregistrement chiffré impossible. Vos saisies restent affichées et vous pouvez réessayer.');
    } finally {
      if (isCurrent()) { saving.current = false; setBusy(false); }
    }
  };

  const clearUnlockedSession = () => {
    accessGeneration.current += 1;
    activeSecret.current = null;
    opening.current = false;
    openingUid.current = null;
    openingGeneration.current = null;
    saving.current = false;
    recoverySnapshot.current = null;
    recoveringAccess.current = false;
    setUser(null);
    setSessionSecret(null);
    setBridgeUser(null);
    restore(null, true);
    setLockedDraft(null);
    setDraftProblem('');
    setPassword('');
    setConfirmation('');
    setPasswordVisible(false);
    setRecoveryKit(null);
    setCodeSyncProblem('');
    setCodeSyncPending(false);
    setRotationUncertain(false);
    setRecoveryConflict(false);
    setRecoveryBusy(false);
    setBusy(false);
  };

  const performLock = async (pending = codeSyncPending) => {
    clearUnlockedSession();
    setMessage(pending
      ? 'Coffre enregistré et verrouillé. Vérifiez la synchronisation des codes dans la dernière version à la prochaine ouverture.'
      : 'Coffre verrouillé. La clé de déchiffrement a été retirée de la session.');
    const generation = accessGeneration.current;
    setBusy(true);
    try { await lockPersonalVault(); }
    catch { if (generation === accessGeneration.current) setMessage('Coffre verrouillé localement. La déconnexion du service n’a pas été confirmée ; reconnectez-vous explicitement pour le rouvrir.'); }
    finally { if (generation === accessGeneration.current) setBusy(false); }
  };

  lockSession.current = (reason) => {
    const secret = activeSecret.current;
    const draft = current.current;
    const mustPreserve = Boolean(secret && draft && (dirty || saving.current));
    clearUnlockedSession();
    const generation = accessGeneration.current;
    const reasonText = reason === 'authentication' ? 'La session du Coffre a changé.' : reason === 'hidden' ? 'Le Coffre est resté masqué trop longtemps.' : 'La session du Coffre était inactive.';
    setMessage(`${reasonText} Coffre verrouillé.${mustPreserve ? ' Protection du brouillon en cours…' : ''}`);
    // Auth changes belong to the SDK. Do not sign out a newly selected identity.
    if (reason !== 'authentication') {
      setBusy(true);
      void lockPersonalVault().catch(() => undefined).finally(() => { if (generation === accessGeneration.current) setBusy(false); });
    }
    if (mustPreserve && secret && draft) {
      void preserveLockedVaultDraft(secret.uid, secret.password, draft).then((durable) => {
        if (generation !== accessGeneration.current) return;
        setMessage(`${reasonText} Coffre verrouillé. ${durable ? 'Votre brouillon a été conservé chiffré sur cet appareil ; reconnectez-vous au même Coffre pour le reprendre.' : 'Le brouillon est chiffré dans cet onglet seulement : le stockage local est indisponible. Ne fermez pas cet onglet avant de le reprendre.'}`);
      }).catch(() => {
        if (generation === accessGeneration.current) setMessage(`${reasonText} Coffre verrouillé. La protection du brouillon a échoué ; ses dernières saisies n’ont pas pu être conservées.`);
      });
    }
  };

  const lock = async () => {
    if (busy || recoveryBusy) return;
    if (dirty && !window.confirm('Des modifications ne sont pas enregistrées. Les abandonner et verrouiller le Coffre ?')) return;
    try { await performLock(); } catch { setMessage('Verrouillage non confirmé. Réessayez ; vos saisies restent présentes.'); }
  };
  const guardNavigation = (event: MouseEvent<HTMLAnchorElement>) => {
    if (busy || recoveryBusy || (dirty && !window.confirm('Des modifications ne sont pas enregistrées. Les abandonner et quitter le Coffre ?'))) event.preventDefault();
  };
  const confirmRemoval = () => window.confirm('Supprimer cette fiche du formulaire ? La suppression sera appliquée lors du prochain enregistrement.');
  const guardRemoval = (event: MouseEvent<HTMLFieldSetElement>) => {
    const button = event.target instanceof Element ? event.target.closest('button[aria-label^="Supprimer"]') : null;
    if (button && !confirmRemoval()) { event.preventDefault(); event.stopPropagation(); }
  };
  const recovered = async (session: RecoveredPersonalSession) => {
    if (!recoverySnapshot.current || recoverySnapshot.current.generation !== accessGeneration.current || !personalVaultSessionMatches(session.personalUser.uid)) return;
    if (current.current !== recoverySnapshot.current.payload) {
      setRotationUncertain(true);
      setRecoveryConflict(true);
      setMessage('Vos saisies ont changé pendant le secours : elles ont été conservées et aucune réponse ancienne ne les remplace. Conservez-les avant de verrouiller et rouvrir le Coffre.');
      return;
    }
    const generation = accessGeneration.current;
    let preserved: PersonalVaultPayload | null = null;
    let problem = '';
    try { preserved = await readLockedVaultDraft(session.personalUser.uid, session.password, session.kit.userAlias); }
    catch { problem = 'Le brouillon local chiffré n’a pas pu être ouvert avec cet accès. Conservez le mot de passe utilisé lors de son verrouillage pour le reprendre.'; }
    if (generation !== accessGeneration.current || !personalVaultSessionMatches(session.personalUser.uid)) return;
    setLockedDraft(preserved); setDraftProblem(problem);
    setUser(session.personalUser); setBridgeUser(session.bridgeUser);
    setUserName(session.kit.userAlias); setPassword(''); setConfirmation('');
    activeSecret.current = { uid: session.personalUser.uid, password: session.password };
    setSessionSecret(activeSecret.current);
    setRecoveryKit(session.kit); setRotationUncertain(false); setSaveFailed(false);
    restore(session.payload, true);
    setCodeSyncPending(session.payload.codeSyncPending === true);
    setCodeSyncProblem('');
    setRecoveryConflict(false);
    setMessage('Coffre récupéré et déchiffré. Vous pouvez choisir un nouveau mot de passe avec ce kit.');
  };
  const setRecoveryAccessBusy = (active: boolean) => {
    recoveringAccess.current = active;
    if (active) recoverySnapshot.current = { payload: current.current, generation: accessGeneration.current };
    setRecoveryBusy(active);
  };

  const renderedGeneration = accessGeneration.current;
  const sessionCallback = <T,>(callback: (value: T) => void | Promise<void>) => (value: T) => { if (renderedGeneration === accessGeneration.current) return callback(value); };

  const replaceOwner = (id: string, patch: Partial<PersonalOwnerProfile>) => setPayload((current) => current ? ({
    ...current,
    owners: current.owners.map((owner) => owner.id === id ? { ...owner, ...patch } : owner),
  }) : current);

  const replaceOwnerField = (ownerId: string, fieldId: string, patch: Partial<OwnerField>) => setPayload((current) => current ? ({
    ...current,
    owners: current.owners.map((owner) => owner.id === ownerId ? {
      ...owner,
      fields: owner.fields.map((field) => field.id === fieldId ? { ...field, ...patch } : field),
    } : owner),
  }) : current);

  const linkOwnerToUserName = (ownerId: string) => setPayload((current) => current ? ({
    ...current,
    owners: current.owners.map((owner) => ({ ...owner, linkedToUserName: owner.id === ownerId })),
  }) : current);

  const removeOwner = (ownerId: string) => setPayload((current) => {
    if (!current || current.owners.length === 1) return current;
    const removedWasLinked = current.owners.some((owner) => owner.id === ownerId && owner.linkedToUserName);
    const owners = current.owners.filter((owner) => owner.id !== ownerId);
    return { ...current, owners: removedWasLinked ? owners.map((owner, index) => ({ ...owner, linkedToUserName: index === 0 })) : owners };
  });

  const replacePlan = (id: string, patch: Partial<PersonalTransmissionPlan>) => setPayload((current) => current ? ({
    ...current,
    transmissionPlans: current.transmissionPlans.map((plan) => plan.id === id ? { ...plan, ...patch } : plan),
  }) : current);

  const replaceRecipient = (planId: string, recipientId: string, patch: Partial<PersonalTransmissionRecipient>) => setPayload((current) => current ? ({
    ...current,
    transmissionPlans: current.transmissionPlans.map((plan) => plan.id === planId ? {
      ...plan,
      recipients: plan.recipients.map((recipient) => recipient.id === recipientId ? { ...recipient, ...patch } : recipient),
    } : plan),
  }) : current);

  const replaceStorage = (id: string, patch: Partial<PersonalStorageLocation>) => setPayload((current) => current ? ({
    ...current,
    storage: current.storage.map((location) => location.id === id ? { ...location, ...patch } : location),
  }) : current);

  const replaceManager = (id: string, patch: Partial<PersonalManager>) => setPayload((current) => current ? ({
    ...current,
    managers: current.managers.map((manager) => manager.id === id ? { ...manager, ...patch } : manager),
  }) : current);

  return <div id="top" className="personal-vault-shell">
    <header className="personal-vault-header">
      <a href={registryHref('/')} onClick={guardNavigation} aria-label="Cartularia · Accueil"><img src="/cartularia-logo.svg" alt="Cartularia" /></a>
      <div><span className="eyebrow">Votre espace personnel chiffré</span><strong>Coffre personnel</strong></div>
      <nav className="personal-vault-header__actions" aria-label="Navigation du Coffre"><a className="vault-home-link" href={registryHref('/')} onClick={guardNavigation}>Accueil</a><a className="vault-home-link" href={registryHref('/registry')} onClick={guardNavigation}>Registre</a>
      {payload && <button type="button" onClick={() => void lock()} disabled={busy || recoveryBusy}><LockKeyhole size={16} /> Verrouiller</button>}</nav>
    </header>
    <main>
      <CodeHandoffSender key={accessGeneration.current} user={user} bridgeUser={bridgeUser} payload={payload} syncPending={codeSyncPending} blocked={busy || recoveryBusy || dirty || rotationUncertain || codeSyncPending || Boolean(lockedDraft || draftProblem)} onBusy={sessionCallback(setRecoveryBusy)} />
      {!payload ? <section key="vault-login" className="vault-login-card">
        <div><span className="eyebrow">Identité séparée</span><h1>{creationMode ? 'Créez votre Coffre personnel.' : 'Votre patrimoine privé reste à part.'}</h1><p>Utilisez le même nom utilisateur que dans le Registre, avec un mot de passe différent. Le Coffre centralise propriétaires, transmissions, lieux réels et gestionnaires.</p></div>
        {!personalVaultIsConfigured && <p className="vault-message" role="alert">Le Coffre est temporairement indisponible : son accès séparé doit être rétabli. Vos identifiants ne seront pas envoyés à un autre espace.</p>}
        <form onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void authenticateVault(creationMode); }}>
          <label>Nom utilisateur Cartularia<input disabled={busy || recoveryBusy} value={userName} onChange={(event) => { accessGeneration.current += 1; setUserName(event.target.value); }} autoComplete="username" required /></label>
          <label>Mot de passe dédié<input disabled={busy || recoveryBusy} type={passwordVisible ? 'text' : 'password'} value={password} onChange={(event) => { accessGeneration.current += 1; setPassword(event.target.value); }} autoComplete={creationMode ? 'new-password' : 'current-password'} minLength={12} required /></label>
          {creationMode && <label>Confirmer le mot de passe du Coffre<input disabled={busy || recoveryBusy} type={passwordVisible ? 'text' : 'password'} value={confirmation} onChange={(event) => { accessGeneration.current += 1; setConfirmation(event.target.value); }} autoComplete="new-password" minLength={12} required /></label>}
          <button type="button" aria-pressed={passwordVisible} onClick={() => setPasswordVisible((shown) => !shown)}>{passwordVisible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}{passwordVisible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}</button>
          <div><button className="vault-primary" disabled={busy || recoveryBusy || !personalVaultIsConfigured} type="submit">{busy ? 'Ouverture…' : creationMode ? 'Créer l’accès au Coffre' : 'Entrer dans le Coffre'}</button><button disabled={busy || recoveryBusy} type="button" onClick={() => { setCreationMode((mode) => !mode); setConfirmation(''); setMessage(''); }}>{creationMode ? 'J’ai déjà un accès' : 'Créer l’accès'}</button></div>
          <small><ShieldCheck size={14} /> Les données personnelles sont chiffrées avant envoi. La troisième base ne reçoit que des codes.</small>
        </form>
        <RecoveryAccessForm key={`recovery-${accessGeneration.current}`} disabled={busy || !personalVaultIsConfigured} onRecovered={sessionCallback(recovered)} onBusy={sessionCallback(setRecoveryAccessBusy)} />
      </section> : <>
        <section className="vault-context">
          <div><span className="eyebrow">Compte patrimonial privé</span><h1>Coffre personnel</h1></div>
          <dl className="vault-account-identity">
            <div><dt>Nom utilisateur</dt><dd>{payload.userName}</dd></div>
            <div><dt>Numéro client principal</dt><dd><CodeBadge>{payload.owners.find((owner) => owner.linkedToUserName)?.clientNumber || '—'}</CodeBadge></dd></div>
          </dl>
          <p>Un seul propriétaire est lié au nom utilisateur. Les codes objets sont fournis en lecture seule par la base de correspondance.</p>
        </section>

        {draftProblem && <section className="vault-note"><p role="alert">{draftProblem} Les modifications sont suspendues pour ne pas remplacer ce brouillon.</p><button type="button" onClick={() => { if (!user || !window.confirm('Supprimer définitivement le brouillon local illisible ? Ses saisies non enregistrées seront perdues.')) return; try { forgetLockedVaultDraft(user.uid); setDraftProblem(''); } catch { /* Keep the warning and protect the draft. */ } }}>Supprimer le brouillon illisible</button></section>}
        {lockedDraft && <section className="vault-note" aria-label="Brouillon local chiffré"><p>Un brouillon non enregistré a été conservé lors du verrouillage. La version du service est affichée ci-dessous. Reprendre le brouillon remplace le formulaire, sans enregistrer ni écraser la version distante.</p><button type="button" disabled={busy || recoveryBusy || dirty} onClick={() => { restore(lockedDraft, false); setLockedDraft(null); }}>Reprendre mon brouillon</button><button type="button" disabled={busy || recoveryBusy} onClick={() => { if (!user || !window.confirm('Supprimer définitivement ce brouillon local chiffré ?')) return; try { forgetLockedVaultDraft(user.uid); setLockedDraft(null); } catch { setDraftProblem('Le brouillon local n’a pas pu être supprimé.'); } }}>Supprimer ce brouillon</button></section>}
        {rotationUncertain && <p role="alert" className="vault-message">{recoveryConflict ? 'Vos saisies ont changé pendant le secours : elles sont conservées ci-dessous. Aucune réponse ancienne ne les remplace. Conservez-les avant de verrouiller et rouvrir le Coffre ; les modifications sont suspendues.' : 'Le changement d’accès reste à confirmer. Conservez vos saisies, l’ancien et le nouveau mot de passe. Les modifications sont suspendues. Seul un kit encore actif peut permettre une reprise ; un kit remplacé ou révoqué ne le peut pas.'}</p>}
        <RecoveryAccessForm key={`recovery-${accessGeneration.current}`} disabled={busy || recoveryBusy || dirty || Boolean(lockedDraft || draftProblem)} onRecovered={sessionCallback(recovered)} onBusy={sessionCallback(setRecoveryAccessBusy)} />
        {codeSyncPending && <section className="vault-note" aria-label="Synchronisation des codes en attente"><p role="alert">Le Coffre chiffré est enregistré, mais la synchronisation de ses codes n’est pas confirmée dans cette session. Une attente inscrite dans votre dernière sauvegarde chiffrée reste visible après réouverture.</p>{codeSyncProblem && <p role="alert">{codeSyncProblem}</p>}<button type="button" disabled={busy || recoveryBusy || rotationUncertain || dirty} onClick={() => void save()}>Réessayer la synchronisation des codes</button>{dirty && <p>Enregistrez d’abord vos nouvelles saisies.</p>}</section>}
        {bridgeUser && sessionSecret && <PersonalRecoveryPanel key={`${user!.uid}:${recoveryKit?.credentialId || 'password'}`} user={user!} bridgeUser={bridgeUser} password={sessionSecret.password} payload={{ ...payload, codeSyncPending }} dirty={dirty} kit={recoveryKit} blocked={busy || rotationUncertain || Boolean(lockedDraft || draftProblem)} onBusy={sessionCallback(setRecoveryBusy)} onUncertain={() => { if (renderedGeneration === accessGeneration.current) setRotationUncertain(true); }} onPasswordChanged={(nextPassword, kit) => { if (renderedGeneration !== accessGeneration.current || activeSecret.current?.uid !== user!.uid) return; activeSecret.current = { uid: user!.uid, password: nextPassword }; setSessionSecret(activeSecret.current); setRecoveryKit(kit); setRotationUncertain(false); }} />}

        <fieldset className="vault-editable-sections" disabled={recoveryBusy || rotationUncertain || Boolean(lockedDraft || draftProblem)} onClickCapture={guardRemoval}>
        <section className="vault-section">
          <header><div><span className="eyebrow">Identités et coordonnées</span><h2>Propriétaires des biens</h2></div><strong>{payload.owners.length}</strong></header>
          <div className="vault-entity-list">{payload.owners.map((owner, ownerIndex) => <article className="vault-entity-card" key={owner.id}>
            <header className="vault-entity-head"><span>Propriétaire {ownerIndex + 1}</span><div><CodeBadge>{owner.clientNumber}</CodeBadge><button type="button" disabled={payload.owners.length === 1} aria-label="Supprimer ce propriétaire" onClick={() => removeOwner(owner.id)}><Trash2 size={15} /></button></div></header>
            <div className="vault-owner-link"><label><input type="radio" name="owner-linked-to-username" checked={owner.linkedToUserName} onChange={() => linkOwnerToUserName(owner.id)} /> Propriétaire lié au nom utilisateur <strong>{payload.userName}</strong></label><small>Un seul propriétaire peut porter ce rattachement.</small></div>
            <div className="vault-entity-controls">
              <label>Nom de la fiche<input value={owner.label} onChange={(event) => replaceOwner(owner.id, { label: event.target.value })} /></label>
              <label>Type<select value={owner.type} onChange={(event) => replaceOwner(owner.id, { type: event.target.value as PersonalOwnerProfile['type'] })}><option>Personne physique</option><option>Entreprise</option></select></label>
            </div>
            <div className="vault-grid vault-owner-fields">{owner.fields.map((field) => <article key={field.id}><input value={field.label} onChange={(event) => replaceOwnerField(owner.id, field.id, { label: event.target.value })} aria-label="Libellé" />{isAddressField(field) ? <textarea value={field.value} onChange={(event) => replaceOwnerField(owner.id, field.id, { value: event.target.value })} aria-label={field.label} /> : <input value={field.value} onChange={(event) => replaceOwnerField(owner.id, field.id, { value: event.target.value })} aria-label={field.label} />}</article>)}</div>
            <section className="vault-code-list" aria-label={`Codes objets du client ${owner.clientNumber}`}><header><span>Codes objets rattachés</span><small>Lecture seule · base de correspondance</small></header>{owner.objectCodes.length > 0 ? <div>{owner.objectCodes.map((code) => <CodeBadge key={code}>{code}</CodeBadge>)}</div> : <p>Aucun code objet rattaché à ce numéro client.</p>}</section>
            <button type="button" onClick={() => replaceOwner(owner.id, { fields: [...owner.fields, { id: newId('owner-field'), label: 'Nouvelle catégorie', value: '' }] })}><Plus size={15} /> Ajouter une catégorie</button>
          </article>)}</div>
          <button type="button" onClick={() => setPayload({ ...payload, owners: [...payload.owners, createEmptyOwnerProfile(newId('owner'))] })}><Plus size={15} /> Ajouter un propriétaire</button>
        </section>

        <section className="vault-section">
          <header><div><span className="eyebrow">Organisation successorale</span><h2>Plans de transmission</h2></div><strong>{payload.transmissionPlans.length}</strong></header>
          <div className="vault-entity-list">{payload.transmissionPlans.map((plan, planIndex) => <article className="vault-entity-card" key={plan.id}>
            <header className="vault-entity-head"><span>Plan {planIndex + 1}</span><div><CodeBadge>{plan.transmissionCode}</CodeBadge><button type="button" aria-label="Supprimer ce plan" onClick={() => setPayload({ ...payload, transmissionPlans: payload.transmissionPlans.filter((item) => item.id !== plan.id) })}><Trash2 size={15} /></button></div></header>
            <div className="vault-entity-controls"><label>Nom du plan<input value={plan.name} onChange={(event) => replacePlan(plan.id, { name: event.target.value })} /></label><label>Instructions générales<textarea value={plan.notes} onChange={(event) => replacePlan(plan.id, { notes: event.target.value })} placeholder="Intentions, conditions ou coordination à prévoir…" /></label></div>
            <div className="vault-grid">{plan.recipients.map((recipient, index) => <article key={recipient.id}><div className="vault-item-head"><span>Bénéficiaire {index + 1}</span><button type="button" aria-label="Supprimer ce bénéficiaire" onClick={() => replacePlan(plan.id, { recipients: plan.recipients.filter((item) => item.id !== recipient.id) })}><Trash2 size={15} /></button></div><input aria-label="Prénom du bénéficiaire" placeholder="Prénom" value={recipient.firstName} onChange={(event) => replaceRecipient(plan.id, recipient.id, { firstName: event.target.value })} /><input aria-label="Nom du bénéficiaire" placeholder="Nom" value={recipient.lastName} onChange={(event) => replaceRecipient(plan.id, recipient.id, { lastName: event.target.value })} /><textarea aria-label="Adresse du bénéficiaire" placeholder="Adresse" value={recipient.address} onChange={(event) => replaceRecipient(plan.id, recipient.id, { address: event.target.value })} /><input aria-label="Email du bénéficiaire" placeholder="Email" type="email" value={recipient.email} onChange={(event) => replaceRecipient(plan.id, recipient.id, { email: event.target.value })} /><input aria-label="Téléphone du bénéficiaire" placeholder="Téléphone" value={recipient.phone} onChange={(event) => replaceRecipient(plan.id, recipient.id, { phone: event.target.value })} /></article>)}</div>
            <button type="button" onClick={() => replacePlan(plan.id, { recipients: [...plan.recipients, { id: newId('recipient'), recipientCode: generateCorrespondenceCode('person'), firstName: '', lastName: '', address: '', email: '', phone: '' }] })}><Plus size={15} /> Ajouter un bénéficiaire</button>
          </article>)}</div>
          <button type="button" onClick={() => setPayload({ ...payload, transmissionPlans: [...payload.transmissionPlans, createEmptyTransmissionPlan(newId('plan'))] })}><Plus size={15} /> Ajouter un plan de transmission</button>
        </section>

        <section className="vault-section">
          <header><div><span className="eyebrow">Adresses et conditions réelles</span><h2>Lieux de stockage</h2></div><strong>{payload.storage.length}</strong></header>
          <p className="vault-note">Le code lieu est généré automatiquement. Le nom usuel et l’adresse restent chiffrés dans le Coffre.</p>
          <div className="vault-grid">{payload.storage.map((location, index) => <article key={location.id}><div className="vault-item-head"><span>Lieu {index + 1}</span><div><CodeBadge>{location.locationCode}</CodeBadge><button type="button" aria-label="Supprimer ce lieu" onClick={() => setPayload({ ...payload, storage: payload.storage.filter((item) => item.id !== location.id) })}><Trash2 size={15} /></button></div></div><input aria-label="Nom usuel du lieu" placeholder="Nom usuel — ex. Résidence secondaire" value={location.codeName} onChange={(event) => replaceStorage(location.id, { codeName: normalizeStorageCodeName(event.target.value) })} /><textarea aria-label="Adresse ou localisation précise" placeholder="Adresse ou localisation précise" value={location.preciseLocation} onChange={(event) => replaceStorage(location.id, { preciseLocation: event.target.value })} /><textarea aria-label="Objets et éléments conservés" placeholder="Objets et éléments conservés" value={location.contents} onChange={(event) => replaceStorage(location.id, { contents: event.target.value })} /><textarea aria-label="Sécurité et conditions" placeholder="Sécurité, accès, température, humidité…" value={location.securityAndConditions} onChange={(event) => replaceStorage(location.id, { securityAndConditions: event.target.value })} /></article>)}</div>
          <button type="button" onClick={() => setPayload({ ...payload, storage: [...payload.storage, createEmptyStorageLocation(newId('storage'))] })}><Plus size={15} /> Ajouter un lieu de stockage</button>
        </section>

        <section className="vault-section">
          <header><div><span className="eyebrow">Carnet de contacts</span><h2>Contacts gestionnaires</h2></div><strong>{payload.managers.length}</strong></header>
          <p className="vault-note">Ces fiches décrivent vos interlocuteurs. Leur ajout ne crée aucun compte, invitation ou droit d’accès au Coffre ou au Registre.</p>
          <div className="vault-grid">{payload.managers.map((manager, index) => <article key={manager.id}><div className="vault-item-head"><span>Gestionnaire {index + 1}</span><div><CodeBadge>{manager.managerCode}</CodeBadge><button type="button" aria-label="Supprimer ce gestionnaire" onClick={() => setPayload({ ...payload, managers: payload.managers.filter((item) => item.id !== manager.id) })}><Trash2 size={15} /></button></div></div><input aria-label="Prénom du gestionnaire" placeholder="Prénom" value={manager.firstName} onChange={(event) => replaceManager(manager.id, { firstName: event.target.value })} /><input aria-label="Nom du gestionnaire" placeholder="Nom" value={manager.lastName} onChange={(event) => replaceManager(manager.id, { lastName: event.target.value })} /><input aria-label="Rôle du gestionnaire" placeholder="Rôle ou périmètre" value={manager.role} onChange={(event) => replaceManager(manager.id, { role: event.target.value })} /><textarea aria-label="Adresse du gestionnaire" placeholder="Adresse" value={manager.address} onChange={(event) => replaceManager(manager.id, { address: event.target.value })} /><input aria-label="Email du gestionnaire" placeholder="Email" type="email" value={manager.email} onChange={(event) => replaceManager(manager.id, { email: event.target.value })} /><input aria-label="Téléphone du gestionnaire" placeholder="Téléphone" value={manager.phone} onChange={(event) => replaceManager(manager.id, { phone: event.target.value })} /></article>)}</div>
          <button type="button" onClick={() => setPayload({ ...payload, managers: [...payload.managers, createEmptyManager(newId('manager'))] })}><UserCog size={15} /> Ajouter un contact gestionnaire</button>
        </section>

        <section className="vault-bridge-summary"><Link2 size={20} /><div><strong>Base de correspondance indépendante</strong><p>Elle ne conserve que numéros clients, codes objets, codes transmission, codes lieux et codes gestionnaires. Aucun nom, adresse, email ou instruction.</p></div></section>
        </fieldset>

        <div className="vault-savebar"><div><span role="status">{busy ? 'Enregistrement en cours…' : recoveryBusy ? 'Moyens de secours : opération en cours…' : dirty ? 'Modifications non enregistrées. Pensez à enregistrer avant de quitter.' : message || 'Toutes les modifications sont enregistrées.'}</span>{saveFailed && <p role="alert">{message}</p>}</div><div className="vault-savebar__actions"><button className="vault-primary" type="button" disabled={busy || recoveryBusy || rotationUncertain || Boolean(lockedDraft || draftProblem)} onClick={() => void save()}><Save size={16} /> Chiffrer et enregistrer</button><button type="button" disabled={busy || recoveryBusy || rotationUncertain || Boolean(lockedDraft || draftProblem)} onClick={() => void save(true)}><LockKeyhole size={16} /> Enregistrer et verrouiller</button></div></div>
      </>}
      {!payload && message && <p className="vault-message" role="status">{message}</p>}
    </main>
  </div>;
}
