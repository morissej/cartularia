import { useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { collection, getDocsFromServer } from 'firebase/firestore';
import { personalAuth } from './firebase';
import { codeBridgeAuth, codeBridgeDb } from './codeBridgeFirebase';
import { normalizeUserAlias } from '../domain/personalDataBoundary';
import { sha256Hex } from './crypto';
import { HANDOFF_TTL, HANDOFF_VERSION, neutralCodeOptions, trustedOrigin, validNonce, validRecipient, type RegistryRecipient } from './codeHandoffProtocol';
import type { PersonalVaultPayload } from './types';
import { capturedHandoff } from './codeHandoffCapture';
import { returnCodesToRegistry } from './codeHandoffNavigation';

export function CodeHandoffSender({ user, bridgeUser, payload, blocked, syncPending, onBusy }: {
  user: User | null; bridgeUser: User | null; payload: PersonalVaultPayload | null; blocked: boolean; syncPending: boolean; onBusy: (value: boolean) => void;
}) {
  const parameters = useRef(new URLSearchParams(capturedHandoff.request || '')).current;
  const nonce = parameters.get('codeHandoff');
  const recipient = { uid: parameters.get('recipientUid'), email: parameters.get('recipientEmail') } as RegistryRecipient;
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [sent, setSent] = useState(false);
  const latest = useRef({ user, bridgeUser, payload, blocked }); latest.current = { user, bridgeUser, payload, blocked };
  const origin = parameters.get('recipientOrigin') || '';
  const expiresAt = Number(parameters.get('expiresAt'));
  const registryOrigin = trustedOrigin(import.meta.env.VITE_REGISTRY_SITE_URL || 'https://studio-2614005370-a3e51.web.app', import.meta.env.DEV || import.meta.env.VITE_PERSONAL_USE_FIREBASE_EMULATORS === 'true');
  const allowed = Boolean(validNonce(nonce) && validRecipient(recipient) && registryOrigin && origin === registryOrigin
    && [...parameters.keys()].sort().join(',') === 'codeHandoff,expiresAt,recipientEmail,recipientOrigin,recipientUid'
    && Number.isFinite(expiresAt) && expiresAt > Date.now() && expiresAt <= Date.now() + HANDOFF_TTL);
  if (!nonce) return null;
  const send = async () => {
    if (!allowed || !recipient || !user || !bridgeUser || !payload || blocked || busy || sent) return;
    setBusy(true); onBusy(true); setMessage('Vérification des sessions et des codes enregistrés…');
    try {
      const expectedEmail = `${await sha256Hex(`registry-alias\u0000${normalizeUserAlias(payload.userName).toLocaleLowerCase('fr')}`)}@registry.cartularia.invalid`;
      if (recipient.email !== expectedEmail) throw new Error('alias');
      await Promise.all([user.getIdToken(true), bridgeUser.getIdToken(true)]);
      if (!codeBridgeDb || personalAuth?.currentUser?.uid !== user.uid || codeBridgeAuth?.currentUser?.uid !== bridgeUser.uid) throw new Error('session');
      const [locations, people] = await Promise.all(['locations', 'people'].map((kind) => getDocsFromServer(collection(codeBridgeDb!, 'codeAccounts', bridgeUser.uid, kind))));
      if (Date.now() >= expiresAt || latest.current.user?.uid !== user.uid || latest.current.bridgeUser?.uid !== bridgeUser.uid
        || latest.current.payload !== payload || personalAuth?.currentUser?.uid !== user.uid || codeBridgeAuth?.currentUser?.uid !== bridgeUser.uid) throw new Error('session');
      const snapshot = { locations: neutralCodeOptions(locations.docs.map((entry) => ({ code: entry.id, genericLabel: entry.data().genericLabel })), 'locations'), people: neutralCodeOptions(people.docs.map((entry) => ({ code: entry.id, genericLabel: entry.data().genericLabel })), 'people') };
      returnCodesToRegistry(registryOrigin!, { version: HANDOFF_VERSION, nonce: nonce!, expiresAt, recipient, outcome: 'codes', snapshot });
      setSent(true); setMessage('Retour vers le Registre pour confirmer la réception des seuls codes…');
    } catch (error) {
      setMessage((error as Error).message === 'alias'
        ? 'Le compte Registre demandeur ne correspond pas au pseudonyme de ce Coffre. Aucun code transmis. Revenez au compte voulu.'
        : 'Le transfert n’est pas confirmé. Vérifiez les sessions, enregistrez le Coffre et recommencez depuis le Registre.');
    } finally { setBusy(false); onBusy(false); }
  };
  return <section className="vault-section vault-code-handoff" aria-label="Partage des codes vers le Registre">
    <h2>Charger mes codes dans le Registre</h2>
    {!allowed ? <p role="alert">Demande expirée ou destination non autorisée. Aucun code ne sera transmis ; recommencez depuis votre Registre.</p> : <>
      <p>Destination vérifiée : <strong>{registryOrigin}</strong>. Seuls les codes Lieux/Personnes et des libellés neutres seront transmis au compte Registre correspondant à votre pseudonyme. Aucun nom, adresse, mot de passe, clé ou jeton de connexion.</p>
      <p>Les codes restent temporairement dans la mémoire de la session Registre. Ce transfert ne crée aucun droit d’accès au Coffre, ni rattachement automatique d’objet à un propriétaire.</p>
      {!payload && <p>Déverrouillez le Coffre ci-dessous avant de confirmer.</p>}
      {syncPending && <p>Une synchronisation des codes reste à reprendre avant ce transfert.</p>}
      <button type="button" disabled={!recipient || !payload || !bridgeUser || blocked || busy || sent || syncPending} onClick={() => void send()}>Confirmer le partage des seuls codes</button>
      <button type="button" disabled={busy || sent || blocked} onClick={() => { returnCodesToRegistry(registryOrigin!, { version: HANDOFF_VERSION, nonce: nonce!, expiresAt, recipient, outcome: 'cancelled' }); setSent(true); setMessage('Partage annulé ; aucun code transmis.'); }}>Refuser</button>
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
