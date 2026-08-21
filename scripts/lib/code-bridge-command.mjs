const CLIENT_NUMBER_PATTERN = /^CLI-[A-F0-9]{8}$/;
const OBJECT_CODE_PATTERN = /^[A-Z0-9]{2,3}-[A-F0-9]{8}$/;

export class CodeBridgeCommandError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CodeBridgeCommandError';
    this.code = code;
  }
}

const validate = ({ accountUid, clientNumber, objectCode }) => {
  if (typeof accountUid !== 'string' || accountUid.length < 8) throw new CodeBridgeCommandError('invalid_account', 'Compte technique invalide.');
  if (!CLIENT_NUMBER_PATTERN.test(clientNumber)) throw new CodeBridgeCommandError('invalid_client_number', 'Numéro client invalide.');
  if (!OBJECT_CODE_PATTERN.test(objectCode)) throw new CodeBridgeCommandError('invalid_object_code', 'Code objet invalide.');
};

export const attachObjectCodeToClient = async ({ firestore, accountUid, clientNumber, objectCode }) => {
  validate({ accountUid, clientNumber, objectCode });
  const reference = firestore.doc(`codeAccounts/${accountUid}/clients/${clientNumber}`);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new CodeBridgeCommandError('client_not_found', 'Le numéro client n’existe pas dans la base de correspondance.');
    const current = snapshot.data();
    if (current.ownerUid !== accountUid || current.code !== clientNumber) {
      throw new CodeBridgeCommandError('client_mismatch', 'La correspondance client est incohérente.');
    }
    const objectCodes = [...new Set([...(Array.isArray(current.objectCodes) ? current.objectCodes : []), objectCode])].sort();
    transaction.update(reference, { objectCodes, updatedAt: new Date() });
    return { accountUid, clientNumber, objectCode, objectCodes };
  });
};
