import { useEffect, useState, type FormEvent } from 'react';
import { Download, FileKey, KeyRound } from 'lucide-react';
import type { User } from 'firebase/auth';
import { personalVaultProjectId } from './firebase';
import { createPersonalRecoveryKit, type PersonalRecoveryKit } from './recoveryCrypto';
import {
  enrollPersonalRecovery, getPersonalRecoveryStatus, recoverPersonalVault, revokePersonalRecovery,
  rotatePersonalPasswordWithKit, type RecoveryStatus,
} from './recoveryRepository';
import type { PersonalVaultPayload } from './types';

export type RecoveredPersonalSession = Awaited<ReturnType<typeof recoverPersonalVault>>;
const recoveryError = (error: unknown) => {
  const code = String((error as { code?: string })?.code || '');
  if (code.includes('resource-exhausted')) return 'Trop de demandes de secours. Réessayez dans quelques minutes.';
  if (code.includes('unauthenticated')) return 'Reconnectez-vous avant de modifier vos moyens de secours.';
  if (code.includes('permission-denied')) return 'Ce kit est refusé, remplacé ou révoqué, ou le compte n’est plus autorisé.';
  return 'L’opération de secours n’a pas été confirmée. Conservez votre kit et réessayez.';
};

export function RecoveryAccessForm({ disabled, onRecovered, onBusy }: { disabled: boolean; onRecovered: (session: RecoveredPersonalSession) => void; onBusy?: (busy: boolean) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const recover = async (event: FormEvent) => {
    event.preventDefault();
    if (!file || disabled || busy) return;
    if (file.size > 32_768) return setMessage('Ce fichier ne correspond pas à un kit de secours.');
    setBusy(true);
    onBusy?.(true);
    setMessage('');
    try { onRecovered(await recoverPersonalVault(await file.text())); }
    catch (error) { setMessage(recoveryError(error)); }
    finally { setBusy(false); onBusy?.(false); }
  };
  return <details className="vault-recovery-access" open={new URLSearchParams(window.location.search).get('mode') === 'recover' || undefined}>
    <summary><FileKey size={16} aria-hidden="true" /> Mot de passe oublié ? Ouvrir avec mon kit de secours</summary>
    <p>Choisissez le kit précédemment activé pour ce Coffre. Ses clés restent dans ce navigateur ; le serveur vérifie une preuve signée. Le kit ouvre les données enregistrées, même si vous avez oublié le mot de passe.</p>
    <form onSubmit={(event) => void recover(event)}>
      <label>Mon fichier de secours<input type="file" accept=".json,application/json" disabled={disabled || busy} onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
      <button type="submit" disabled={disabled || busy || !file}><KeyRound size={16} aria-hidden="true" /> {busy ? 'Vérification du kit…' : 'Récupérer mon Coffre'}</button>
      {message && <p role="alert">{message}</p>}
    </form>
    <small>Sans mot de passe ni kit activé conservé, Cartularia ne peut pas déchiffrer ce Coffre. Un changement d’accès seul ne restitue pas les données.</small>
  </details>;
}

export function PersonalRecoveryPanel({ user, bridgeUser, password, payload, dirty, kit, blocked, onBusy, onPasswordChanged, onUncertain }: {
  user: User; bridgeUser: User; password: string; payload: PersonalVaultPayload; dirty: boolean;
  kit: PersonalRecoveryKit | null; blocked: boolean; onBusy: (busy: boolean) => void;
  onPasswordChanged: (password: string, kit: PersonalRecoveryKit) => void; onUncertain: () => void;
}) {
  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  const [pendingKit, setPendingKit] = useState<PersonalRecoveryKit | null>(null);
  const [activeKit, setActiveKit] = useState<PersonalRecoveryKit | null>(kit);
  const [downloaded, setDownloaded] = useState(false);
  const [kept, setKept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  useEffect(() => {
    let current = true;
    void getPersonalRecoveryStatus(user, bridgeUser).then((result) => { if (current) setStatus(result); })
      .catch(() => { if (current) setMessage('Le statut du kit n’a pas pu être vérifié. Réessayez avant de modifier vos moyens de secours.'); });
    return () => { current = false; };
  }, [user, bridgeUser]);
  const act = async (task: () => Promise<void>) => {
    if (busy || blocked) return;
    setBusy(true); onBusy(true); setMessage('');
    try { await task(); } catch (error) { setMessage(recoveryError(error)); }
    finally { setBusy(false); onBusy(false); }
  };
  const generate = () => act(async () => {
    if (!personalVaultProjectId) return;
    setPendingKit(await createPersonalRecoveryKit({ personalUid: user.uid, personalProjectId: personalVaultProjectId, userAlias: payload.userName }));
    setDownloaded(false); setKept(false);
  });
  const download = () => {
    if (!pendingKit) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(pendingKit, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = `cartularia-coffre-secours-${pendingKit.credentialId}.json`;
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDownloaded(true);
  };
  const activate = () => act(async () => {
    if (!pendingKit || !downloaded || !kept || dirty) return;
    if (status?.active && !window.confirm('Activer ce nouveau kit révoquera le précédent. Avez-vous conservé le nouveau fichier ?')) return;
    const result = await enrollPersonalRecovery(user, bridgeUser, pendingKit, password);
    setStatus({ active: true, ...result }); setActiveKit(pendingKit); setPendingKit(null);
    setMessage('Kit activé. Conservez ce fichier hors de cet appareil, dans un emplacement auquel vous seul avez accès.');
  });
  const revoke = () => act(async () => {
    if (!window.confirm('Révoquer le kit ? Il ne permettra plus de récupérer le Coffre. Vérifiez que vous connaissez encore votre mot de passe.')) return;
    await revokePersonalRecovery(user, bridgeUser); setStatus({ active: false }); setActiveKit(null);
    setMessage('Kit révoqué. Vous pouvez en créer un nouveau.');
  });
  const rotate = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeKit || dirty || nextPassword.length < 12 || nextPassword !== confirmation) return;
    await act(async () => {
      try {
        await rotatePersonalPasswordWithKit({ user, bridgeUser, kit: activeKit, password: nextPassword, payload, operationId: crypto.randomUUID() });
        onPasswordChanged(nextPassword, activeKit); setNextPassword(''); setConfirmation('');
        setMessage('Nouveau mot de passe confirmé avec le kit actif lors de cette opération.');
      } catch (error) {
        if ((error as { code?: string }).code === 'vault-rotation-uncertain') {
          onUncertain();
          setMessage(error instanceof Error ? error.message : 'Une partie du changement peut avoir abouti. Conservez vos mots de passe et vos saisies ; seul le kit actuellement actif peut permettre une reprise.');
        } else if ((error as { code?: string }).code === 'vault-kit-stale') {
          setActiveKit(null); setStatus(null);
          setMessage(error instanceof Error ? error.message : 'Le kit a changé. Vérifiez le secours actif.');
        } else setMessage(error instanceof Error ? error.message : 'Le changement a été arrêté avant modification du mot de passe.');
      }
    });
  };
  return <section className="vault-section vault-recovery-panel">
    <header><div><span className="eyebrow">Conserver l’accès dans la durée</span><h2>Kit de secours du Coffre</h2></div></header>
    <p>{status === null ? 'Statut du kit à vérifier.' : status.active ? 'Un kit de secours est actif pour ce Coffre.' : 'Aucun kit de secours actif. Créez-en un pendant que vous connaissez votre mot de passe.'}</p>
    <p>Ce fichier donne accès à votre Coffre. Gardez-le en lieu sûr et ne l’envoyez jamais au support. Le kit n’est pas une copie de vos données ; il permet de retrouver la dernière sauvegarde auprès du service.</p>
    {dirty && <p className="vault-note">Enregistrez vos modifications avant d’activer un kit ou de changer le mot de passe.</p>}
    <div className="vault-recovery-actions"><button type="button" disabled={busy || blocked || dirty || status === null} onClick={() => void generate()}>{status?.active ? 'Préparer un nouveau kit' : 'Préparer mon kit'}</button>{status?.active && <button type="button" disabled={busy || blocked} onClick={() => void revoke()}>Révoquer le kit</button>}{status === null && <button type="button" disabled={busy || blocked} onClick={() => void act(async () => { setStatus(await getPersonalRecoveryStatus(user, bridgeUser)); })}>Vérifier le statut du kit</button>}</div>
    {pendingKit && <div className="vault-recovery-preparation">
      <button type="button" onClick={download} disabled={busy || blocked}><Download size={16} aria-hidden="true" /> Télécharger mon kit</button>
      <label><input type="checkbox" checked={kept} disabled={!downloaded || busy || blocked} onChange={(event) => setKept(event.target.checked)} /> J’ai conservé le fichier dans un emplacement sûr, accessible si je perds cet appareil.</label>
      <button type="button" disabled={!downloaded || !kept || dirty || busy || blocked} onClick={() => void activate()}>Activer ce kit enregistré</button>
      <small>Le kit précédent reste en vigueur jusqu’à la confirmation d’activation.</small>
    </div>}
    {activeKit && status?.active && <form onSubmit={(event) => void rotate(event)} className="vault-recovery-password">
      <h3>Choisir un nouveau mot de passe</h3>
      <label>Nouveau mot de passe du Coffre<input type="password" minLength={12} maxLength={128} autoComplete="new-password" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} required disabled={busy || blocked} /></label>
      <label>Confirmer le nouveau mot de passe<input type="password" minLength={12} maxLength={128} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required disabled={busy || blocked} /></label>
      <button type="submit" disabled={busy || blocked || dirty || nextPassword.length < 12 || nextPassword !== confirmation}>Changer le mot de passe avec mon kit</button>
    </form>}
    {message && <p role="status">{message}</p>}
  </section>;
}
