import { useState, type FormEvent } from 'react';
import { KeyRound, Link2, LockKeyhole, Plus, Save, ShieldCheck, Trash2, UserCog } from 'lucide-react';
import type { User } from 'firebase/auth';
import { normalizeStorageCodeName, normalizeUserAlias } from '../domain/personalDataBoundary';
import { generateCorrespondenceCode } from '../domain/correspondenceCodes';
import type { OwnerField } from '../features/cartulary/state/cartularyStateTypes';
import { personalVaultIsConfigured } from './firebase';
import { loadOwnerObjectCodes, saveCodeCorrespondences } from './codeBridgeRepository';
import { authenticatePersonalVault, loadPersonalVault, lockPersonalVault, savePersonalVault } from './repository';
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

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const isAddressField = (field: OwnerField) => field.label.trim().toLocaleLowerCase('fr').includes('adresse');

function CodeBadge({ children }: { children: string }) {
  return <code className="vault-code"><KeyRound size={13} />{children}</code>;
}

export function PersonalVaultApp() {
  const [creationMode, setCreationMode] = useState(() => new URLSearchParams(window.location.search).get('mode') === 'create');
  const [userName, setUserName] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [bridgeUser, setBridgeUser] = useState<User | null>(null);
  const [payload, setPayload] = useState<PersonalVaultPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const authenticateVault = async (createAccount = false) => {
    if (!personalVaultIsConfigured) return setMessage('Configuration Firebase du Coffre personnel manquante.');
    if (normalizeUserAlias(userName).length < 3 || password.length < 12) {
      return setMessage('Utilisez un nom utilisateur valide et un mot de passe d’au moins 12 caractères.');
    }
    setBusy(true);
    setMessage('');
    try {
      const normalizedName = normalizeUserAlias(userName);
      const session = await authenticatePersonalVault({ userAlias: normalizedName, password, createAccount });
      const existing = await loadPersonalVault({ user: session.personalUser, userAlias: normalizedName, password });
      const bridgeCodes = await loadOwnerObjectCodes(session.bridgeUser);
      const restored = existing ? {
        ...existing,
        owners: existing.owners.map((owner) => ({
          ...owner,
          objectCodes: bridgeCodes.get(owner.clientNumber) ?? owner.objectCodes,
        })),
      } : emptyPersonalVaultPayload(normalizedName);
      setUser(session.personalUser);
      setBridgeUser(session.bridgeUser);
      setUserName(normalizedName);
      setPayload(restored);
      setMessage(existing ? 'Coffre patrimonial déchiffré dans cette session.' : 'Nouveau coffre patrimonial prêt à être enregistré.');
    } catch (error) {
      if (import.meta.env.DEV) console.error('[Coffre personnel] Ouverture impossible.', error);
      setMessage('Ouverture impossible. Vérifiez le nom utilisateur et le mot de passe dédiés.');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!user || !payload) return;
    setBusy(true);
    try {
      const updated = { ...payload, updatedAt: new Date().toISOString() };
      await savePersonalVault({ user, payload: updated, password });
      setPayload(updated);
      try {
        await saveCodeCorrespondences(bridgeUser, updated);
        setMessage('Coffre chiffré enregistré ; codes synchronisés dans la base de correspondance.');
      } catch {
        setMessage('Coffre chiffré enregistré. La synchronisation des seuls codes doit être relancée.');
      }
    } catch {
      setMessage('Enregistrement chiffré impossible. Aucune donnée personnelle en clair n’a été envoyée.');
    } finally {
      setBusy(false);
    }
  };

  const lock = async () => {
    await lockPersonalVault();
    setUser(null);
    setBridgeUser(null);
    setPayload(null);
    setPassword('');
    setMessage('Coffre verrouillé. La clé de déchiffrement a été retirée de la session.');
  };

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
      <img src="/cartularia-logo.svg" alt="Cartularia" />
      <div><span className="eyebrow">Site dédié · Bases séparées</span><strong>Coffre personnel</strong></div>
      {!payload && <a className="vault-home-link" href="/">Accueil</a>}
      {payload && <button type="button" onClick={lock}><LockKeyhole size={16} /> Verrouiller</button>}
    </header>
    <main>
      {!payload ? <section key="vault-login" className="vault-login-card">
        <div><span className="eyebrow">Identité séparée</span><h1>{creationMode ? 'Créez votre Coffre personnel.' : 'Votre patrimoine privé reste à part.'}</h1><p>Utilisez le même nom utilisateur que dans le Registre, avec un mot de passe différent. Le Coffre centralise propriétaires, transmissions, lieux réels et gestionnaires.</p></div>
        <form onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void authenticateVault(creationMode); }}>
          <label>Nom utilisateur Cartularia<input value={userName} onChange={(event) => setUserName(event.target.value)} autoComplete="username" required /></label>
          <label>Mot de passe dédié<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={creationMode ? 'new-password' : 'current-password'} minLength={12} required /></label>
          <div><button className="vault-primary" disabled={busy} type="submit">{creationMode ? 'Créer l’accès au Coffre' : 'Entrer dans le Coffre'}</button><button disabled={busy} type="button" onClick={() => { setCreationMode((current) => !current); setMessage(''); }}>{creationMode ? 'J’ai déjà un accès' : 'Créer l’accès'}</button></div>
          <small><ShieldCheck size={14} /> Les données personnelles sont chiffrées avant envoi. La troisième base ne reçoit que des codes.</small>
        </form>
      </section> : <>
        <section className="vault-context">
          <div><span className="eyebrow">Compte patrimonial privé</span><h1>Coffre personnel</h1></div>
          <dl className="vault-account-identity">
            <div><dt>Nom utilisateur</dt><dd>{payload.userName}</dd></div>
            <div><dt>Numéro client principal</dt><dd><CodeBadge>{payload.owners.find((owner) => owner.linkedToUserName)?.clientNumber || '—'}</CodeBadge></dd></div>
          </dl>
          <p>Un seul propriétaire est lié au nom utilisateur. Les codes objets sont fournis en lecture seule par la base de correspondance.</p>
        </section>

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
          <header><div><span className="eyebrow">Délégation encadrée</span><h2>Gestionnaires</h2></div><strong>{payload.managers.length}</strong></header>
          <p className="vault-note">Ces personnes peuvent être désignées pour gérer le compte pour le propriétaire. Leur code dédié ne contient aucune identité.</p>
          <div className="vault-grid">{payload.managers.map((manager, index) => <article key={manager.id}><div className="vault-item-head"><span>Gestionnaire {index + 1}</span><div><CodeBadge>{manager.managerCode}</CodeBadge><button type="button" aria-label="Supprimer ce gestionnaire" onClick={() => setPayload({ ...payload, managers: payload.managers.filter((item) => item.id !== manager.id) })}><Trash2 size={15} /></button></div></div><input aria-label="Prénom du gestionnaire" placeholder="Prénom" value={manager.firstName} onChange={(event) => replaceManager(manager.id, { firstName: event.target.value })} /><input aria-label="Nom du gestionnaire" placeholder="Nom" value={manager.lastName} onChange={(event) => replaceManager(manager.id, { lastName: event.target.value })} /><input aria-label="Rôle du gestionnaire" placeholder="Rôle ou périmètre" value={manager.role} onChange={(event) => replaceManager(manager.id, { role: event.target.value })} /><textarea aria-label="Adresse du gestionnaire" placeholder="Adresse" value={manager.address} onChange={(event) => replaceManager(manager.id, { address: event.target.value })} /><input aria-label="Email du gestionnaire" placeholder="Email" type="email" value={manager.email} onChange={(event) => replaceManager(manager.id, { email: event.target.value })} /><input aria-label="Téléphone du gestionnaire" placeholder="Téléphone" value={manager.phone} onChange={(event) => replaceManager(manager.id, { phone: event.target.value })} /></article>)}</div>
          <button type="button" onClick={() => setPayload({ ...payload, managers: [...payload.managers, createEmptyManager(newId('manager'))] })}><UserCog size={15} /> Ajouter un gestionnaire</button>
        </section>

        <section className="vault-bridge-summary"><Link2 size={20} /><div><strong>Base de correspondance indépendante</strong><p>Elle ne conserve que numéros clients, codes objets, codes transmission, codes lieux et codes gestionnaires. Aucun nom, adresse, email ou instruction.</p></div></section>

        <div className="vault-savebar"><span role="status">{message || 'Modifications conservées uniquement dans cette session jusqu’à l’enregistrement.'}</span><button className="vault-primary" type="button" disabled={busy} onClick={() => void save()}><Save size={16} /> Chiffrer et enregistrer</button></div>
      </>}
      {!payload && message && <p className="vault-message" role="status">{message}</p>}
    </main>
  </div>;
}
