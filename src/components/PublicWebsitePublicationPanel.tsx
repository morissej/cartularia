import { useEffect, useRef, useState } from 'react';
import type { WebsiteDraftBlock } from '../domain/websiteDraft';
import { loadWebsitePublicationState, publishWebsiteSelection, revokeWebsiteSelection, type WebsitePublicationRequest, type WebsitePublicationState } from '../services/websitePublication';

export function PublicWebsitePublicationPanel({ cartularyId, blocks, beforePublish, onStateChanged, onSelectionLoaded, onBusyChange, publishingDisabled = false, readOnly = false, language = 'FR' }: {
  cartularyId: string; blocks: WebsiteDraftBlock[]; beforePublish?: () => Promise<void>; onStateChanged?: (state: WebsitePublicationState) => void; onSelectionLoaded?: (state: WebsitePublicationState) => void; onBusyChange?: (busy: boolean) => void; publishingDisabled?: boolean; readOnly?: boolean; language?: 'FR' | 'EN';
}) {
  const [state, setState] = useState<WebsitePublicationState | null>(null);
  const [busy, setBusy] = useState<'loading' | 'publish' | 'revoke' | 'cleanup' | null>(readOnly ? null : 'loading');
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  const pending = useRef<{ signature: string; action: 'publish' | 'revoke' | 'cleanup'; request: WebsitePublicationRequest } | null>(null);
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
    loadWebsitePublicationState(cartularyId).then((value) => { if (active) { setState(value); selectionLoaded.current?.(value); } })
      .catch(() => active && setError('État de publication indisponible. Connectez-vous avec le compte propriétaire puis réessayez.'))
      .finally(() => active && setBusy(null));
    return () => { active = false; };
  }, [cartularyId, readOnly, reload]);
  const run = async (action: 'publish' | 'revoke' | 'cleanup') => {
    if (inFlight.current || !confirmed || readOnly || (action === 'publish' && publishingDisabled)) return;
    inFlight.current = true;
    setBusy(action); setError(''); setMessage('');
    try {
      if (!pending.current || pending.current.signature !== signature || pending.current.action !== action) {
        if (action === 'publish') await beforePublish?.();
        const latest = await loadWebsitePublicationState(cartularyId);
        setState(latest);
        pending.current = { action, signature, request: { cartularyId, requestId: `website_${crypto.randomUUID().replaceAll('-', '')}`, expectedRevision: latest.revision, confirmed: true, ...(action === 'publish' ? { blocks, confirmedNonPersonalMedia: true } : action === 'cleanup' ? { cleanupOnly: true } : {}) } };
      }
      const result = await (action === 'publish' ? publishWebsiteSelection : revokeWebsiteSelection)(pending.current.request);
      setState({ ...result, blockIds: result.blockIds || [] });
      onStateChanged?.({ ...result, blockIds: result.blockIds || [] });
      pending.current = null;
      setConfirmed(false);
      setMessage((action === 'publish' && result.status !== 'published') || (action === 'revoke' && result.status === 'published')
        ? tx('La demande antérieure a été retrouvée, mais une autre décision a changé la publication depuis. L’état actuel est affiché ci-dessus.', 'The earlier request was found, but another decision has changed publication since. Its current status is shown above.')
        : action === 'cleanup' ? tx('Suppression des anciennes copies confirmée. La publication actuelle n’a pas été modifiée. Les copies déjà téléchargées restent chez leurs destinataires.', 'Old copies deleted. The current publication was not changed. Previously downloaded copies remain with their recipients.') : action === 'publish' ? tx('Publication confirmée. Le lien public est consultable sur un autre appareil.', 'Publication confirmed. The public link is available on another device.') : tx('Publication retirée. Les nouveaux accès à ses médias sont bloqués. Les copies déjà téléchargées restent chez leurs destinataires.', 'Publication withdrawn. New access to its media is blocked. Previously downloaded copies remain with their recipients.'));
    } catch (failure) {
      const code = (failure as { code?: string })?.code;
      if (code && !['functions/unavailable', 'functions/deadline-exceeded', 'functions/internal'].includes(code)) pending.current = null;
      setError(failure instanceof Error ? failure.message : tx('La demande n’a pas abouti. Réessayez.', 'The request did not complete. Retry.'));
      try { setState(await loadWebsitePublicationState(cartularyId)); } catch { /* Preserve the initial failure; a refresh offers another status check. */ }
    } finally { inFlight.current = false; setBusy(null); }
  };
  const published = state?.status === 'published';
  if (readOnly) return <p>{tx('Votre accès est en lecture seule ; il ne permet pas de publier cet objet.', 'Your access is read-only and does not allow publishing this object.')}</p>;
  return <section aria-label={tx('Mise en ligne du mini-site', 'Website publication')}>
    <p role="status">{busy === 'loading' ? tx('Vérification de la publication…', 'Checking publication…') : busy === 'publish' ? tx('Publication en cours…', 'Publishing…') : busy === 'cleanup' ? tx('Suppression des anciennes copies…', 'Deleting old copies…') : busy === 'revoke' ? tx('Retrait en cours…', 'Withdrawing…') : published ? tx('Mini-site publié', 'Website published') : !state ? tx('État de publication inconnu', 'Publication status unknown') : state.status === 'revoked' ? tx('Mini-site retiré', 'Website withdrawn') : tx('Brouillon · aucun mini-site publié', 'Draft · no published website')}</p>
    {state?.cleanupPending && <p role="alert">{tx('Suppression des anciennes copies incomplète. Certaines anciennes adresses peuvent rester accessibles jusqu’à la fin du nettoyage. Vous pouvez reprendre cette opération, même après fermeture de cette page.', 'Old copy deletion is incomplete. Some previous URLs may remain accessible until cleanup finishes. You can resume this operation even after closing this page.')}</p>}
    {published && <p><a href={`/watch-website?publicCode=${encodeURIComponent(state.publicCode)}`} target="_blank" rel="noreferrer">{tx('Ouvrir le mini-site public', 'Open public website')}</a></p>}
    <p>{tx('La mise en ligne utilise uniquement les médias autorisés « Tous » avec une copie de présentation vérifiée. Les PDF sont reconstruits en pages images, sans liens actifs, formulaires ni signatures vérifiables. Les vidéos exigent un transcodeur sécurisé disponible ; sinon elles restent privées et la publication est refusée. Les originaux sont conservés.', 'Publication uses only media marked “All” with verified presentation copies. PDFs are rebuilt as page images, without active links, forms or verifiable signatures. Videos require an available secure transcoder; otherwise they remain private and publication is refused. Originals are retained.')}</p>
    <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={Boolean(busy)} /> {tx('Je confirme les contenus choisis et la demande. Pour toute mise en ligne, je dispose des droits de diffusion et j’ai vérifié l’absence de données personnelles, y compris dans les images, scans et vidéos.', 'I confirm the selected content and request. For publication, I hold the distribution rights and have checked that there is no personal data, including in images, scans and videos.')}</label>
    <div><button type="button" className="button button--primary" disabled={Boolean(busy) || publishingDisabled || !confirmed || !blocks.length || state?.cleanupPending} onClick={() => void run('publish')}>{published ? tx('Mettre à jour le mini-site', 'Update website') : tx('Publier le mini-site', 'Publish website')}</button>
      {state?.cleanupPending && <button type="button" className="button button--quiet" disabled={Boolean(busy) || !confirmed} onClick={() => void run('cleanup')}>{tx('Reprendre la suppression des anciennes copies', 'Resume deleting old copies')}</button>}
      {published && <button type="button" className="button button--quiet" disabled={Boolean(busy) || !confirmed} onClick={() => void run('revoke')}>{tx('Retirer le mini-site', 'Withdraw website')}</button>}
    </div>
    {error && <p role="alert">{error}</p>}{!state && !busy && <button type="button" onClick={() => setReload((value) => value + 1)}>{tx('Réessayer la vérification', 'Retry status check')}</button>}{message && <p role="status">{message}</p>}
  </section>;
}
