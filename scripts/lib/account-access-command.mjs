const ADMIN_ROLE = 'cartulariaAdmin';
const RECENT_ADMIN_AUTH_SECONDS = 15 * 60;

export class AccountAccessCommandError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AccountAccessCommandError';
    this.code = code;
  }
}

const denied = (message = 'Ce compte ne dispose plus d’un accès actif.') => new AccountAccessCommandError('permission_denied', message);

/** Read each account's own project. Missing barriers preserve pre-migration accounts only. */
export const assertActiveAccount = async ({ auth, firestore, uid, allowMissingProfile = false, transaction }) => {
  if (typeof uid !== 'string' || !uid || uid.includes('/')) throw new AccountAccessCommandError('unauthenticated', 'Connexion requise.');
  if (!auth?.getUser || !firestore?.doc) throw new AccountAccessCommandError('failed_precondition', 'La vérification de session est indisponible.');
  const read = (path) => transaction ? transaction.get(firestore.doc(path)) : firestore.doc(path).get();
  let user;
  try { user = await auth.getUser(uid); }
  catch (error) {
    if (error?.code === 'auth/user-not-found') throw new AccountAccessCommandError('unauthenticated', 'Ce compte n’existe plus.');
    throw error;
  }
  if (user.disabled === true) throw denied();
  const [accessSnapshot, profileSnapshot] = await Promise.all([read(`accountAccess/${uid}`), read(`users/${uid}`)]);
  const accountAccess = accessSnapshot.exists ? accessSnapshot.data() : null;
  const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
  if (accountAccess && (accountAccess.status !== 'active' || !Number.isInteger(accountAccess.validAfter) || accountAccess.validAfter < 0)) throw denied();
  if (profile ? profile.status !== 'active' : !allowMissingProfile) throw denied();
  const parsedAuthCutoff = user.tokensValidAfterTime ? Date.parse(user.tokensValidAfterTime) / 1000 : 0;
  if (!Number.isFinite(parsedAuthCutoff) || parsedAuthCutoff < 0) throw denied('La validité de session ne peut pas être confirmée.');
  return { uid, user, profile, accountAccess, validAfter: accountAccess?.validAfter ?? 0, authValidAfter: parsedAuthCutoff };
};

/** Firebase callables verify signatures; this adds current account and revocation state. */
export const assertActiveAccountSession = async ({
  auth, firestore, requestAuth, allowMissingProfile = false, requireAdmin = false,
  nowSeconds = Math.floor(Date.now() / 1000), transaction,
}) => {
  if (!requestAuth?.uid) throw new AccountAccessCommandError('unauthenticated', 'Connexion requise.');
  const authenticatedAt = requestAuth.token?.auth_time;
  if (!Number.isInteger(authenticatedAt) || authenticatedAt <= 0 || authenticatedAt > nowSeconds) {
    throw new AccountAccessCommandError('unauthenticated', 'La session n’est pas valide. Reconnectez-vous.');
  }
  const current = await assertActiveAccount({ auth, firestore, uid: requestAuth.uid, allowMissingProfile, transaction });
  // Auth's native cutoff is inclusive (new users can sign in in their creation second).
  // Our explicit suspension barrier is strict so tokens from the cutoff second stay revoked.
  if (authenticatedAt < current.authValidAfter || (current.accountAccess && authenticatedAt <= current.validAfter)) {
    throw new AccountAccessCommandError('unauthenticated', 'Cette session a été révoquée. Reconnectez-vous.');
  }
  if (requestAuth.token?.firebase?.sign_in_provider === 'custom') {
    const issuedAt = requestAuth.token.cartulariaRecoveryIssuedAt;
    // A custom token can be exchanged later and obtain a new auth_time. Its server-issued
    // recovery timestamp must also survive both revocation checks, independently of auth_time.
    if ((current.accountAccess && (!Number.isInteger(issuedAt) || issuedAt <= current.validAfter))
      || (issuedAt !== undefined && (!Number.isInteger(issuedAt) || issuedAt < current.authValidAfter || issuedAt > nowSeconds))) {
      throw new AccountAccessCommandError('unauthenticated', 'Cet accès de récupération a été révoqué. Recommencez la récupération.');
    }
  }
  if (requireAdmin) {
    if (requestAuth.token?.[ADMIN_ROLE] !== true || current.user.customClaims?.[ADMIN_ROLE] !== true) {
      throw denied('Ce compte ne possède plus le rôle administrateur.');
    }
    if (nowSeconds - authenticatedAt > RECENT_ADMIN_AUTH_SECONDS) {
      throw new AccountAccessCommandError('unauthenticated', 'Reconnectez-vous avec votre mot de passe administrateur.');
    }
  }
  return current;
};
