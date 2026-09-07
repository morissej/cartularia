import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { HANDOFF_TTL, handoffChannelName, parseHandoffReturn, trustedOrigin, validRecipient, type CodeSnapshot } from './codeHandoffProtocol';
const EMPTY: CodeSnapshot = { locations: [], people: [] };
/** COOP-compatible: the same-origin return page relays a single-use capability. */
export function useVaultCodeHandoff(user: Pick<User, 'uid' | 'email'> | null) {
  const [snapshot, setSnapshot] = useState(EMPTY); const [snapshotBinding, setSnapshotBinding] = useState('');
  const [status, setStatus] = useState<'inactive' | 'waiting' | 'ready' | 'error'>('inactive');
  const [message, setMessage] = useState('Les codes du Coffre ne sont pas encore chargés dans cette session.');
  const latestUser = useRef(user); latestUser.current = user;
  const cleanup = useRef<(() => void) | null>(null);
  const binding = `${user?.uid || ''}:${user?.email || ''}`;
  const clear = () => {
    cleanup.current?.(); cleanup.current = null; setSnapshot(EMPTY); setStatus('inactive');
    setMessage('Les codes ont été retirés de cette session. Les références déjà enregistrées dans le Cartulaire restent inchangées.');
  };
  useEffect(() => {
    cleanup.current?.(); cleanup.current = null; setSnapshot(EMPTY); setStatus('inactive');
    setMessage('Les codes du Coffre ne sont pas encore chargés dans cette session.');
    return () => { cleanup.current?.(); cleanup.current = null; };
  }, [binding]);
  const connect = () => {
    clear();
    const recipient = user && { uid: user.uid, email: user.email };
    if (!validRecipient(recipient)) { setStatus('error'); setMessage('Connectez-vous avec votre accès Registre à pseudonyme pour charger les codes du Coffre correspondant.'); return; }
    if (typeof BroadcastChannel === 'undefined') { setStatus('error'); setMessage('Ce navigateur ne permet pas le canal de retour sécurisé. Utilisez un navigateur récent ; aucun code ni identifiant ne sera transféré.'); return; }
    let vaultUrl: URL;
    try { vaultUrl = new URL(import.meta.env.VITE_PERSONAL_VAULT_URL?.trim() || '/personal-vault', window.location.origin); }
    catch { setStatus('error'); setMessage('Le domaine sécurisé du Coffre n’est pas configuré.'); return; }
    const vaultOrigin = trustedOrigin(vaultUrl.href, import.meta.env.DEV || import.meta.env.VITE_PERSONAL_USE_FIREBASE_EMULATORS === 'true');
    if (!vaultOrigin) { setStatus('error'); setMessage('Le domaine sécurisé du Coffre n’est pas configuré.'); return; }
    const nonce = crypto.randomUUID(); const expiresAt = Date.now() + HANDOFF_TTL;
    vaultUrl.hash = new URLSearchParams({ codeHandoff: nonce, recipientOrigin: window.location.origin, expiresAt: String(expiresAt), recipientUid: recipient.uid, recipientEmail: recipient.email }).toString();
    let completed = false;
    let acknowledgementTimer: number | undefined;
    const channel = new BroadcastChannel(handoffChannelName(nonce));
    const fail = (text: string) => { cleanup.current?.(); cleanup.current = null; setSnapshot(EMPTY); setStatus('error'); setMessage(text); };
    channel.onmessage = (event) => {
      const packet = parseHandoffReturn(event.data);
      if (!packet || packet.nonce !== nonce || packet.expiresAt !== expiresAt || packet.recipient.uid !== recipient.uid || packet.recipient.email !== recipient.email) return;
      if (latestUser.current?.uid !== recipient.uid || latestUser.current.email !== recipient.email) { fail('La session a changé. Aucun code importé ; recommencez depuis le compte voulu.'); return; }
      channel.postMessage({ type: 'received', nonce, recipientUid: recipient.uid });
      if (completed) return;
      completed = true;
      if (packet.outcome === 'cancelled') {
        window.clearTimeout(timer);
        acknowledgementTimer = window.setTimeout(() => { cleanup.current?.(); cleanup.current = null; }, 10_000);
        setStatus('inactive'); setMessage('Le partage des codes a été annulé dans le Coffre.'); return;
      }
      setSnapshot(packet.snapshot!); setSnapshotBinding(binding); setStatus('ready');
      setMessage('Codes chargés pour cette session, valables 10 minutes au maximum. Rafraîchissez-les après une modification dans le Coffre.');
    };
    const timer = window.setTimeout(() => fail('La demande ou les codes ont expiré. Si la fenêtre Coffre a été fermée, recommencez depuis ce bouton.'), HANDOFF_TTL);
    cleanup.current = () => { channel.close(); window.clearTimeout(timer); window.clearTimeout(acknowledgementTimer); };
    const popup = window.open(vaultUrl.toString(), `cartularia-codes-${nonce}`, 'popup,width=900,height=800');
    if (!popup) { fail('La fenêtre du Coffre a été bloquée. Autorisez cette fenêtre puis réessayez.'); return; }
    // COOP deliberately severs window.opener/closed. Never mistake it for user closure.
    setStatus('waiting'); setMessage('Dans la fenêtre Coffre, déverrouillez votre compte puis confirmez les seuls codes. Si vous avez fermé cette fenêtre, annulez la demande puis recommencez.');
  };
  return { ...(snapshotBinding === binding ? snapshot : EMPTY), status, message, connect, clear };
}
