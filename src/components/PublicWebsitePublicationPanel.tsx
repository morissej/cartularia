import { useEffect, useRef, useState } from 'react';
import type { WebsiteDraftBlock } from '../domain/websiteDraft';
import { loadWebsitePublicationState, publishWebsiteSelection, revokeWebsiteSelection, type WebsitePublicationState } from '../services/websitePublication';
import { clearWebsiteRequestSession, readWebsiteRequestSession, writeWebsiteRequestSession, type WebsiteRequestAction, type WebsiteRequestSessionEntry } from '../services/websiteRequestSession';

type PendingRequest = Omit<WebsiteRequestSessionEntry, 'requestedAtIso'>;
const RETRYABLE_CODES = ['functions/unavailable', 'functions/deadline-exceeded', 'functions/internal'];
/** Échec de lecture de l'état : sentinelle traduite au rendu (l'alerte suit la langue de l'interface, sans relire l'état). */
const LOAD_FAILED = 'load-failed';
/**
 * Lot B : une demande n'est conservée que si rien ne s'est produit côté serveur depuis sa préparation. La révision racine
 * en est le témoin, sauf pour la suppression des anciennes copies (elle ne bouge pas la révision) : là, c'est la fin du
 * nettoyage en attente qui atteste la réponse du serveur.
 */
const requestSettled = (entry: PendingRequest, latest: WebsitePublicationState) => latest.revision !== entry.request.expectedRevision
  || (entry.action === 'cleanup' && latest.cleanupPending !== true);

export function PublicWebsitePublicationPanel({ cartularyId, blocks, beforePublish, onStateChanged, onSelectionLoaded, onBusyChange, publishingDisabled = false, readOnly = false, language = 'FR' }: {
  cartularyId: string; blocks: WebsiteDraftBlock[]; beforePublish?: () => Promise<void>; onStateChanged?: (state: WebsitePublicationState) => void; onSelectionLoaded?: (state: WebsitePublicationState) => void; onBusyChange?: (busy: boolean) => void; publishingDisabled?: boolean; readOnly?: boolean; language?: 'FR' | 'EN';
}) {
  const [state, setState] = useState<WebsitePublicationState | null>(null);
  const [busy, setBusy] = useState<'loading' | WebsiteRequestAction | null>(readOnly ? null : 'loading');
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  // Lot B : demande retrouvée dans l'onglet après rechargement, tant que le serveur est resté à la révision attendue.
  const [retained, setRetained] = useState<WebsiteRequestSessionEntry | null>(null);
  const pending = useRef<PendingRequest | null>(null);
  const inFlight = useRef(false);
  const selectionLoaded = useRef(onSelectionLoaded);
  selectionLoaded.current = onSelectionLoaded;
  useEffect(() => { onBusyChange?.(Boolean(busy)); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  const signature = JSON.stringify(blocks);
  const tx = (fr: string, en: string) => language === 'FR' ? fr : en;
  useEffect(() => { setConfirmed(false); setMessage(''); }, [signature]);
  useEffect(() => {
    if (readOnly) return;
    setState(null); setBusy('loading'); setError('');
    let active = true;
    loadWebsitePublicationState(cartularyId).then((value) => {
      if (!active) return;
      setState(value); selectionLoaded.current?.(value);
      // La demande conservée n'est reprise que si rien ne s'est produit côté serveur depuis sa préparation ; sinon l'état
      // serveur fait foi et la demande est oubliée partout, y compris en mémoire (aucun rejeu d'une demande dépassée).
      const entry = readWebsiteRequestSession(cartularyId);
      if (entry && !requestSettled(entry, value)) { pending.current = entry; setRetained(entry); } else { pending.current = null; clearWebsiteRequestSession(cartularyId); setRetained(null); }
    })
      .catch(() => active && setError(LOAD_FAILED))
      .finally(() => active && setBusy(null));
    return () => { active = false; };
  }, [cartularyId, readOnly, reload]);
  const forgetRequest = () => { pending.current = null; clearWebsiteRequestSession(cartularyId); setRetained(null); };
  const prepareRequest = async (action: WebsiteRequestAction) => {
    if (action === 'publish') await beforePublish?.();
    const latest = await loadWebsitePublicationState(cartularyId);
    setState(latest);
    const entry: PendingRequest = { action, signature, request: { cartularyId, requestId: `website_${crypto.randomUUID().replaceAll('-', '')}`, expectedRevision: latest.revision, confirmed: true, ...(action === 'publish' ? { blocks, confirmedNonPersonalMedia: true } : action === 'cleanup' ? { cleanupOnly: true } : {}) } };
    pending.current = entry; setRetained(null);
    writeWebsiteRequestSession(cartularyId, { ...entry, requestedAtIso: new Date().toISOString() });
    return entry;
  };
  // Le SDK Firebase fabrique un message égal au code nu pour les échecs sans réponse (coupure réseau → « internal »,
  // délai → « deadline-exceeded ») : ces jetons sont traduits ; un message serveur lisible est conservé tel quel.
  const readableMessage = (failure: unknown, code: string | undefined) => {
    const raw = failure instanceof Error ? failure.message.trim() : '';
    return raw && raw !== (code ?? '').replace(/^functions\//, '') ? raw : '';
  };
  const fallbackMessage = (code: string | undefined) => code === 'functions/deadline-exceeded' ? tx('Le serveur n’a pas répondu dans le délai.', 'The server did not respond in time.')
    : code === 'functions/unavailable' || code === 'functions/internal' ? tx('Connexion au serveur interrompue.', 'Server connection interrupted.')
      : tx('La demande n’a pas abouti. Réessayez.', 'The request did not complete. Retry.');
  // Un « internal » porteur d'un message serveur est une réponse du serveur (erreur ou refus non détaillé), pas une absence
  // de réponse : la demande est conservée pour un rejeu à l'identique, sans prétendre qu'aucune confirmation n'est arrivée.
  const retainedSuffix = (serverAnswered: boolean) => serverAnswered
    ? tx('Demande conservée : réponse serveur non concluante (erreur ou refus non détaillé) ; le prochain clic sur le même bouton reprend cette demande à l’identique, sans doublon.', 'Request kept: inconclusive server response (error or undetailed refusal); the next click on the same button resumes this exact request, without duplication.')
    : tx('Demande conservée, confirmation serveur non reçue : le prochain clic sur le même bouton reprend cette demande à l’identique, sans doublon.', 'Request kept, no server confirmation received: the next click on the same button resumes this exact request, without duplication.');
  const run = async (action: WebsiteRequestAction, options: { replay?: boolean } = {}) => {
    if (inFlight.current || !confirmed || readOnly || (action === 'publish' && publishingDisabled)) return;
    inFlight.current = true;
    setBusy(action); setError(''); setMessage('');
    try {
      // Rejeu à l'identique (même requestId, même révision attendue) d'une demande conservée après un échec réseau ou retrouvée dans l'onglet ; sinon nouvelle demande.
      const reusable = pending.current && (options.replay || (pending.current.signature === signature && pending.current.action === action)) ? pending.current : null;
      const current = reusable ?? await prepareRequest(action);
      const result = await (current.action === 'publish' ? publishWebsiteSelection : revokeWebsiteSelection)(current.request);
      setState({ ...result, blockIds: result.blockIds || [] });
      onStateChanged?.({ ...result, blockIds: result.blockIds || [] });
      forgetRequest();
      setConfirmed(false);
      setMessage((action === 'publish' && result.status !== 'published') || (action === 'revoke' && result.status === 'published')
        ? tx('La demande antérieure a été retrouvée, mais une autre décision a changé la publication depuis. L’état actuel est affiché ci-dessus.', 'The earlier request was found, but another decision has changed publication since. Its current status is shown above.')
        : action === 'cleanup' ? tx('Suppression des anciennes copies confirmée. La publication actuelle n’a pas été modifiée. Les copies déjà téléchargées restent chez leurs destinataires.', 'Old copies deleted. The current publication was not changed. Previously downloaded copies remain with their recipients.') : action === 'publish' ? tx('Publication confirmée. Le lien public est consultable sur un autre appareil.', 'Publication confirmed. The public link is available on another device.') : tx('Publication retirée. Les nouveaux accès à ses médias sont bloqués. Les copies déjà téléchargées restent chez leurs destinataires.', 'Publication withdrawn. New access to its media is blocked. Previously downloaded copies remain with their recipients.'));
    } catch (failure) {
      const code = (failure as { code?: string })?.code;
      if (code && !RETRYABLE_CODES.includes(code)) forgetRequest();
      // Relecture avant l'alerte : si le serveur a bougé depuis la préparation de la demande (réponse perdue après
      // exécution), la demande est oubliée et l'état relu fait foi, chez les hôtes aussi (QR, résumé).
      let overtaken = false;
      try {
        const latest = await loadWebsitePublicationState(cartularyId);
        setState(latest);
        overtaken = pending.current !== null && requestSettled(pending.current, latest);
        if (overtaken) { forgetRequest(); onStateChanged?.(latest); }
      } catch { /* Preserve the initial failure; a refresh offers another status check. */ }
      const readable = readableMessage(failure, code);
      setError((readable || fallbackMessage(code)) + (pending.current ? ' ' + retainedSuffix(code === 'functions/internal' && Boolean(readable))
        : overtaken ? ' ' + tx('Le serveur a répondu entre-temps : l’état affiché ci-dessus fait foi.', 'The server answered in the meantime: the status shown above is authoritative.') : ''));
    } finally { inFlight.current = false; setBusy(null); }
  };
  const published = state?.status === 'published';
  // D2 : écart entre la sélection courante et les contenus réellement en ligne (ordre indifférent).
  const onlineIds = published ? state.blockIds : null;
  const selectedIds = blocks.map((block) => block.id);
  const selectionDiffers = onlineIds !== null && (onlineIds.length !== selectedIds.length || onlineIds.some((id) => !selectedIds.includes(id)));
  // Demande de publication retrouvée dont le contenu diffère de la sélection affichée : l'écart est annoncé avant tout clic.
  const retainedBlocks = retained?.action === 'publish' ? retained.request.blocks ?? [] : null;
  const retainedDiffers = retainedBlocks !== null && retained !== null && retained.signature !== signature;
  const requestedAt = (entry: WebsiteRequestSessionEntry) => { const date = new Date(entry.requestedAtIso); const locale = language === 'FR' ? 'fr-FR' : 'en-GB'; return tx(`le ${date.toLocaleDateString(locale)} à ${date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`, `on ${date.toLocaleDateString(locale)} at ${date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`); };
  const retainedLabel = (entry: WebsiteRequestSessionEntry) => entry.action === 'revoke'
    ? tx(`Retrait demandé · non confirmé (${requestedAt(entry)}). Revérifiez, reprenez ou abandonnez la demande.`, `Withdrawal requested · unconfirmed (${requestedAt(entry)}). Check again, resume or abandon the request.`)
    : entry.action === 'cleanup'
      ? tx(`Suppression des anciennes copies demandée · non confirmée (${requestedAt(entry)}). Revérifiez, reprenez ou abandonnez la demande.`, `Old copy deletion requested · unconfirmed (${requestedAt(entry)}). Check again, resume or abandon the request.`)
      : tx(`Publication demandée · non confirmée (${requestedAt(entry)}). Revérifiez, reprenez ou abandonnez la demande.`, `Publication requested · unconfirmed (${requestedAt(entry)}). Check again, resume or abandon the request.`);
  if (readOnly) return <p>{tx('Votre accès est en lecture seule ; il ne permet pas de publier cet objet.', 'Your access is read-only and does not allow publishing this object.')}</p>;
  return <section aria-label={tx('Mise en ligne du mini-site', 'Website publication')}>
    <p role="status">{busy === 'loading' ? tx('Vérification de la publication…', 'Checking publication…') : busy === 'publish' ? tx('Publication demandée · en cours (10 à 30 s)…', 'Publication requested · in progress (10 to 30 s)…') : busy === 'revoke' ? tx('Retrait demandé · en cours…', 'Withdrawal requested · in progress…') : busy === 'cleanup' ? tx('Suppression des anciennes copies…', 'Deleting old copies…') : retained ? retainedLabel(retained) : published ? tx('Mini-site publié', 'Website published') : !state ? tx('État de publication inconnu', 'Publication status unknown') : state.status === 'revoked' ? tx('Mini-site retiré', 'Website withdrawn') : tx('Brouillon · aucun mini-site publié', 'Draft · no published website')}</p>
    {selectionDiffers && <p role="note">{tx(`Sélection différente des contenus en ligne : ${onlineIds.length} en ligne, ${selectedIds.length} sélectionnés. « Mettre à jour le mini-site » publiera la sélection actuelle.`, `Selection differs from the online content: ${onlineIds.length} online, ${selectedIds.length} selected. “Update website” will publish the current selection.`)}</p>}
    {retainedDiffers && <p role="note">{tx(`La demande conservée (${retainedBlocks.length} contenus) diffère de la sélection actuelle (${selectedIds.length} contenus) : « Reprendre la demande » publiera la demande conservée telle quelle, « Publier le mini-site » la sélection actuelle.`, `The kept request (${retainedBlocks.length} items) differs from the current selection (${selectedIds.length} items): “Resume the request” will publish the kept request as it is, “Publish website” the current selection.`)}</p>}
    {state?.cleanupPending && <p role="alert">{tx('Suppression des anciennes copies incomplète. Certaines anciennes adresses peuvent rester accessibles jusqu’à la fin du nettoyage. Vous pouvez reprendre cette opération, même après fermeture de cette page.', 'Old copy deletion is incomplete. Some previous URLs may remain accessible until cleanup finishes. You can resume this operation even after closing this page.')}</p>}
    {published && <p><a href={`/watch-website?publicCode=${encodeURIComponent(state.publicCode)}`} target="_blank" rel="noreferrer">{tx('Ouvrir le mini-site public', 'Open public website')}</a></p>}
    <p>{tx('La mise en ligne utilise uniquement les médias autorisés « Tous » avec une copie de présentation vérifiée. Les PDF sont reconstruits en pages images, sans liens actifs, formulaires ni signatures vérifiables. Les vidéos exigent un transcodeur sécurisé disponible ; sinon elles restent privées et la publication est refusée. Les originaux sont conservés.', 'Publication uses only media marked “All” with verified presentation copies. PDFs are rebuilt as page images, without active links, forms or verifiable signatures. Videos require an available secure transcoder; otherwise they remain private and publication is refused. Originals are retained.')}</p>
    <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={Boolean(busy)} /> {tx('Je confirme les contenus choisis et la demande. Pour toute mise en ligne, je dispose des droits de diffusion et j’ai vérifié l’absence de données personnelles, y compris dans les images, scans et vidéos.', 'I confirm the selected content and request. For publication, I hold the distribution rights and have checked that there is no personal data, including in images, scans and videos.')}</label>
    <div><button type="button" className="button button--primary" disabled={Boolean(busy) || publishingDisabled || !confirmed || !blocks.length || state?.cleanupPending} onClick={() => void run('publish')}>{published ? tx('Mettre à jour le mini-site', 'Update website') : tx('Publier le mini-site', 'Publish website')}</button>
      {state?.cleanupPending && <button type="button" className="button button--quiet" disabled={Boolean(busy) || !confirmed} onClick={() => void run('cleanup')}>{tx('Reprendre la suppression des anciennes copies', 'Resume deleting old copies')}</button>}
      {published && <button type="button" className="button button--quiet" disabled={Boolean(busy) || !confirmed} onClick={() => void run('revoke')}>{tx('Retirer le mini-site', 'Withdraw website')}</button>}
    </div>
    {retained && <div>
      <button type="button" className="button button--quiet" disabled={Boolean(busy)} onClick={() => setReload((value) => value + 1)}>{tx('Revérifier', 'Check again')}</button>
      <button type="button" className="button button--quiet" disabled={Boolean(busy) || !confirmed} onClick={() => void run(retained.action, { replay: true })}>{tx('Reprendre la demande', 'Resume the request')}</button>
      <button type="button" className="button button--quiet" disabled={Boolean(busy)} onClick={forgetRequest}>{tx('Abandonner la demande', 'Abandon the request')}</button>
    </div>}
    {error && <p role="alert">{error === LOAD_FAILED ? tx('État de publication indisponible. Connectez-vous avec le compte propriétaire puis réessayez.', 'Publication status unavailable. Sign in with the owner account and retry.') : error}</p>}{!state && !busy && <button type="button" onClick={() => setReload((value) => value + 1)}>{tx('Réessayer la vérification', 'Retry status check')}</button>}{message && <p role="status">{message}</p>}
  </section>;
}
