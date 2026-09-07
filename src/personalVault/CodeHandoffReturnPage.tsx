import { useEffect, useState } from 'react';
import { capturedHandoff } from './codeHandoffCapture';
import { handoffChannelName, parseHandoffReturn } from './codeHandoffProtocol';
import { BrandLogo } from '../components/BrandLogo';
export function CodeHandoffReturnPage() {
  const [message, setMessage] = useState('Vérification du retour des codes…');
  useEffect(() => {
    let packet;
    try { packet = parseHandoffReturn(JSON.parse(decodeURIComponent(capturedHandoff.response || ''))); } catch { packet = null; }
    if (!packet || typeof BroadcastChannel === 'undefined') {
      setMessage('Ce retour est invalide, expiré ou le canal sécurisé est indisponible. Aucun code importé. Recommencez dans votre onglet Registre.'); return;
    }
    const channel = new BroadcastChannel(handoffChannelName(packet.nonce));
    const send = () => channel.postMessage(packet);
    const repeat = window.setInterval(send, 300);
    const timeout = window.setTimeout(() => {
      channel.close(); window.clearInterval(repeat);
      setMessage('L’onglet Registre n’a pas confirmé la réception. Il a pu être fermé ou déconnecté. Aucun succès n’est présumé ; recommencez depuis cet onglet.');
    }, 10_000);
    channel.onmessage = (event) => {
      if (event.data?.type !== 'received' || event.data.nonce !== packet.nonce || event.data.recipientUid !== packet.recipient.uid) return;
      window.clearInterval(repeat); window.clearTimeout(timeout); channel.close();
      setMessage(packet.outcome === 'cancelled' ? 'Le Registre a confirmé l’annulation. Aucun code transmis.' : 'Le Registre a confirmé la réception des seuls codes. Revenez à votre onglet initial ; vous pouvez fermer cette fenêtre.');
    };
    send();
    return () => { window.clearInterval(repeat); window.clearTimeout(timeout); channel.close(); };
  }, []);
  return <main className="account-access-page service-information-page"><BrandLogo href="/" /><h1>Retour des codes au Registre</h1><p role="status">{message}</p><p>Aucun mot de passe, clé ou jeton de connexion n’a été transféré. Les codes sont reçus uniquement par la session qui a demandé ce partage.</p><a href="/registry">Ouvrir le Registre</a></main>;
}
