import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRIVATE_UPLOAD_BACKLOG_CURSOR_PATH,
  processPrivateDraftUploadBacklog,
} from '../scripts/lib/private-upload-command.mjs';
import { createMemoryFirestore } from './helpers/memory-firestore.mjs';

const UID = 'owner_backlog';
const CARTULARY = 'cart_backlog';

const fixture = (count) => {
  const initial = {};
  const names = [];
  for (let index = 0; index < count; index += 1) {
    const binaryId = `bin-${String(index).padStart(4, '0')}`;
    const digest = index.toString(16).padStart(64, '0');
    const name = `private-drafts/${UID}/${CARTULARY}/${binaryId}/${digest}/original`;
    names.push(name);
    initial[`privateDrafts/${UID}/cartularies/${CARTULARY}/binaries/${binaryId}`] = {
      ownerUid: UID,
      cartularyId: CARTULARY,
      binaryId,
      storagePath: name,
      deleted: true,
      verificationStatus: null,
    };
  }
  const base = createMemoryFirestore(initial);
  const manifestReads = [];
  const firestore = {
    ...base,
    doc: (path) => {
      const reference = base.doc(path);
      return {
        ...reference,
        get: async () => {
          if (/\/binaries\//.test(path)) manifestReads.push(path);
          return reference.get();
        },
      };
    },
  };
  const listings = [];
  const bucket = {
    getFiles: async (options) => {
      listings.push(options);
      const available = names.filter((name) => !options.startOffset || name >= options.startOffset);
      const selected = available.slice(0, options.maxResults);
      return [selected.map((name) => ({
        name,
        getMetadata: async () => { throw new Error('Un fichier supprimé ne doit pas être traité.'); },
      })), available.length > selected.length ? { pageToken: 'next-page' } : undefined];
    },
  };
  return {
    firestore,
    storage: { bucket: () => bucket },
    manifestReads,
    listings,
    names,
    dump: base.dump,
  };
};

test('un historique bien plus grand que le lot reste borné et les deux curseurs progressent équitablement', async () => {
  const env = fixture(250);
  const first = await processPrivateDraftUploadBacklog({
    firestore: env.firestore,
    storage: env.storage,
    limit: 10,
    readBudget: 20,
    variantReadBudget: 20,
  });
  assert.deepEqual(first, {
    inspected: 0,
    accepted: 0,
    rejected: 0,
    variantsRegenerated: 0,
    variantsFailed: 0,
    mirrored: 0,
  });
  assert.equal(env.listings.length, 2, 'une page bornée par passe, jamais deux inventaires intégraux');
  assert.ok(env.listings.every(({ autoPaginate, maxResults }) => autoPaginate === false && maxResults === 20));
  assert.equal(env.manifestReads.length, 40, '20 lectures de manifeste au plus pour chacune des deux passes');
  assert.deepEqual(new Set(env.manifestReads).size, 20, 'les passes ont des curseurs indépendants sur la même première page');
  const firstPageReads = new Set(env.manifestReads);
  const cursor = env.dump()[PRIVATE_UPLOAD_BACKLOG_CURSOR_PATH];
  assert.equal(cursor.verificationCursor, env.names[19]);
  assert.equal(cursor.variantCursor, env.names[19]);

  env.manifestReads.length = 0;
  env.listings.length = 0;
  await processPrivateDraftUploadBacklog({
    firestore: env.firestore,
    storage: env.storage,
    limit: 10,
    readBudget: 20,
    variantReadBudget: 20,
  });
  assert.equal(env.manifestReads.length, 40);
  assert.ok(env.manifestReads.every((path) => !firstPageReads.has(path)), 'le passage suivant ne recommence pas au début');
  const secondCursor = env.dump()[PRIVATE_UPLOAD_BACKLOG_CURSOR_PATH];
  assert.equal(secondCursor.verificationCursor, env.names[39]);
  assert.equal(secondCursor.variantCursor, env.names[39]);
});
