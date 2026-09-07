import type { useVaultCodeHandoff } from './useVaultCodeHandoff';
export function VaultCodeHandoffControl({ handoff, disabled = false }: { handoff: ReturnType<typeof useVaultCodeHandoff>; disabled?: boolean }) {
  if (disabled) return null;
  return <div className="vault-code-handoff-control"><p role="status">{handoff.message}</p>
    <button type="button" className="button button--quiet" onClick={handoff.connect}>{handoff.status === 'ready' ? 'Actualiser les codes depuis le Coffre' : 'Charger les codes depuis mon Coffre'}</button>
    {handoff.status !== 'inactive' && <button type="button" className="button button--quiet" onClick={handoff.clear}>{handoff.status === 'waiting' ? 'Annuler la demande' : 'Oublier les codes de cette session'}</button>}
    <small>Seuls des codes et libellés neutres sont reçus, jamais le mot de passe ni les identités. Leur sélection ne rattache pas automatiquement l’objet à un propriétaire dans le Coffre.</small>
  </div>;
}
