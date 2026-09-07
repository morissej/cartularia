import { mediaByteSize, type MediaTransferProgress } from '../utils/mediaTransfer';
import './media-transfer.css';

export function MediaTransferStatus({ progress, language = 'FR', onCancel }: { progress?: MediaTransferProgress; language?: 'FR' | 'EN'; onCancel?: () => void }) {
  const stages = language === 'FR'
    ? { queued: 'En attente de chargement…', metadata: 'Vérification de la taille et des droits…', downloading: 'Transfert du fichier…', verifying: 'Contrôle du fichier…', ready: 'Fichier prêt.' }
    : { queued: 'Waiting to load…', metadata: 'Checking size and access…', downloading: 'Transferring file…', verifying: 'Verifying file…', ready: 'File ready.' };
  const size = mediaByteSize(progress?.byteSize, language) || (progress?.stage === 'downloading' ? (language === 'FR' ? 'taille non disponible' : 'size unavailable') : '');
  return <span className="media-transfer-status"><span role="status">{stages[progress?.stage || 'queued']}{size && <> · {size}</>}</span><small>{language === 'FR' ? 'Le fichier complet est chargé avant ouverture. Le service ne fournit pas de pourcentage de transfert.' : 'The complete file loads before opening. Transfer percentages are not available.'}</small>{onCancel && <><button type="button" onClick={onCancel}>{language === 'FR' ? 'Annuler l’attente' : 'Cancel waiting'}</button><small>{language === 'FR' ? 'L’annulation empêche l’ouverture ; les traitements demandés peuvent continuer en arrière-plan.' : 'Cancellation prevents opening; requested transfers may continue in the background.'}</small></>}</span>;
}
