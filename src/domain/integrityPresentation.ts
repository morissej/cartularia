export type AuthoritativeIntegrityLevel =
  | 'sign_in_required'
  | 'loading'
  | 'unavailable'
  | 'broken'
  | 'chain_only'
  | 'timestamped'
  | 'anchor_pending'
  | 'anchor_failed'
  | 'anchored';

export type LocalWorkJournalLevel = 'broken' | 'local_only' | 'timestamped_local';

export const deriveAuthoritativeIntegrityLevel = ({
  authenticated,
  loadState,
  verificationValid,
  timestampStatus,
  publicAnchoringStatus,
}: {
  authenticated: boolean;
  loadState: 'idle' | 'loading' | 'ready' | 'error';
  verificationValid?: boolean;
  timestampStatus?: string | null;
  publicAnchoringStatus?: string | null;
}): AuthoritativeIntegrityLevel => {
  if (!authenticated) return 'sign_in_required';
  if (loadState === 'idle' || loadState === 'loading') return 'loading';
  if (loadState === 'error') return 'unavailable';
  if (verificationValid !== true) return 'broken';
  if (publicAnchoringStatus === 'anchored') return 'anchored';
  if (publicAnchoringStatus === 'processing' || publicAnchoringStatus === 'pending_confirmation') {
    return 'anchor_pending';
  }
  if (publicAnchoringStatus === 'failed') return 'anchor_failed';
  if (['trusted_rfc3161', 'qualified_eidas'].includes(timestampStatus || '')) return 'timestamped';
  return 'chain_only';
};

export const deriveLocalWorkJournalLevel = ({
  verificationValid,
  hasExternalTimestamp,
}: {
  verificationValid: boolean;
  hasExternalTimestamp: boolean;
}): LocalWorkJournalLevel => {
  if (!verificationValid) return 'broken';
  return hasExternalTimestamp ? 'timestamped_local' : 'local_only';
};
