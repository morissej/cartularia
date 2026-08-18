import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

const projectId = 'cartularia-wave1-storage-test';
const bucketUrl = `gs://${projectId}.appspot.com`;
const [host = '127.0.0.1', portValue = '9199'] = (process.env.FIREBASE_STORAGE_EMULATOR_HOST || '').split(':');
const port = Number(portValue);
const [firestoreHost = '127.0.0.1', firestorePortValue = '8080'] =
  (process.env.FIRESTORE_EMULATOR_HOST || '').split(':');
const firestorePort = Number(firestorePortValue);
const privatePath = 'private/org-a/cart-a/originals/asset-a/version-a';
const publicCode = 'PUBLIC-A1';
const publicPath = `public/${publicCode}/asset-a/web-v1`;
const communityPublicationId = 'community-pub-a1';
const communityPath = `community/${communityPublicationId}/asset-a/community-v1`;
const draftBinaryId = 'draft-binary-a1';
const draftDigest = 'a'.repeat(64);
const draftPath = `private-drafts/owner-a/cart-a/${draftBinaryId}/${draftDigest}/original`;

let testEnvironment;

before(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: firestoreHost,
      port: firestorePort,
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
    storage: {
      host,
      port,
      rules: readFileSync(new URL('../storage.rules', import.meta.url), 'utf8'),
    },
  });
});

after(async () => {
  await testEnvironment.cleanup();
});

beforeEach(async () => {
  await testEnvironment.clearStorage();
  await testEnvironment.clearFirestore();
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await Promise.all([
      setDoc(doc(context.firestore(), 'users', 'owner-a'), {
        uid: 'owner-a',
        status: 'active',
      }),
      setDoc(doc(context.firestore(), 'publications', publicCode), {
        publicCode,
        status: 'published',
        publicationStatus: 'published',
      }),
      setDoc(doc(context.firestore(), 'communityMemberships', 'member-a'), {
        uid: 'member-a',
        status: 'active',
        permissions: ['community.read'],
      }),
      setDoc(doc(context.firestore(), 'communityPublications', communityPublicationId), {
        publicationId: communityPublicationId,
        status: 'published',
        moderationStatus: 'approved',
      }),
      setDoc(doc(context.firestore(), 'privateDrafts', 'owner-a', 'cartularies', 'cart-a'), {
        ownerUid: 'owner-a',
        cartularyId: 'cart-a',
        status: 'active',
        retentionPolicyVersion: 'inactive-plus-2y-v1',
      }),
      setDoc(doc(context.firestore(), 'privateDrafts', 'owner-a', 'cartularies', 'cart-a', 'binaries', draftBinaryId), {
        ownerUid: 'owner-a',
        cartularyId: 'cart-a',
        binaryId: draftBinaryId,
        deleted: false,
        revision: 1,
        fileName: 'original.mp4',
        mimeType: 'video/mp4',
        size: 8,
        sha256: `sha256:${draftDigest}`,
        kind: 'media',
        storagePath: draftPath,
        clientUpdatedAt: 1,
        uploadStatus: 'ready',
      }),
      context.storage(bucketUrl).ref(privatePath).putString('original privé'),
      context.storage(bucketUrl).ref(draftPath).putString('original', 'raw', {
        contentType: 'video/mp4',
        customMetadata: {
          ownerUid: 'owner-a',
          cartularyId: 'cart-a',
          binaryId: draftBinaryId,
          sha256: `sha256:${draftDigest}`,
          kind: 'media',
        },
      }),
      context.storage(bucketUrl).ref(publicPath).putString('dérivé web public', 'raw', {
        customMetadata: {
          publicCode,
          assetId: 'asset-a',
          derivativeId: 'web-v1',
        },
      }),
      context.storage(bucketUrl).ref(communityPath).putString('dérivé communautaire', 'raw', {
        customMetadata: {
          publicationId: communityPublicationId,
          assetId: 'asset-a',
          derivativeId: 'community-v1',
        },
      }),
    ]);
  });
});

test('un utilisateur authentifié ne peut pas écrire dans Storage pendant la vague 1', async () => {
  const storage = testEnvironment.authenticatedContext('owner-a').storage(bucketUrl);
  await assertFails(storage.ref('quarantine/org-a/cart-a/upload-a').putString('nouveau fichier'));
});

test('un utilisateur authentifié ne peut pas lire un original privé pendant la vague 1', async () => {
  const storage = testEnvironment.authenticatedContext('owner-a').storage(bucketUrl);
  await assertFails(storage.ref(privatePath).getDownloadURL());
});

test('un visiteur anonyme ne peut lire aucun original privé', async () => {
  const storage = testEnvironment.unauthenticatedContext().storage(bucketUrl);
  await assertFails(storage.ref(privatePath).getDownloadURL());
});

test('le propriétaire peut écrire et lire son original de brouillon privé', async () => {
  const ownerStorage = testEnvironment.authenticatedContext('owner-a').storage(bucketUrl);
  const newDigest = 'b'.repeat(64);
  const newPath = `private-drafts/owner-a/cart-a/new-binary-a1/${newDigest}/original`;
  await assertSucceeds(ownerStorage.ref(newPath).putString('nouveau média', 'raw', {
    contentType: 'video/mp4',
    customMetadata: {
      ownerUid: 'owner-a',
      cartularyId: 'cart-a',
      binaryId: 'new-binary-a1',
      sha256: `sha256:${newDigest}`,
      kind: 'media',
    },
  }));
  await assertSucceeds(ownerStorage.ref(draftPath).getDownloadURL());
});

test('un nouvel original est immuable et les types actifs déguisés sont refusés', async () => {
  const ownerStorage = testEnvironment.authenticatedContext('owner-a').storage(bucketUrl);
  const digest = 'c'.repeat(64);
  const path = `private-drafts/owner-a/cart-a/immutable-binary/${digest}/original`;
  const metadata = {
    contentType: 'image/jpeg',
    customMetadata: {
      ownerUid: 'owner-a',
      cartularyId: 'cart-a',
      binaryId: 'immutable-binary',
      sha256: `sha256:${digest}`,
      kind: 'media',
    },
  };
  await assertSucceeds(ownerStorage.ref(path).putString('premier original', 'raw', metadata));
  await assertSucceeds(ownerStorage.ref(path).getDownloadURL());
  await assertFails(ownerStorage.ref(path).putString('remplacement', 'raw', metadata));

  const disguisedDigest = 'd'.repeat(64);
  await assertFails(ownerStorage.ref(
    `private-drafts/owner-a/cart-a/disguised-binary/${disguisedDigest}/original`,
  ).putString('<script>alert(1)</script>', 'raw', {
    contentType: 'text/html',
    customMetadata: {
      ownerUid: 'owner-a',
      cartularyId: 'cart-a',
      binaryId: 'disguised-binary',
      sha256: `sha256:${disguisedDigest}`,
      kind: 'media',
    },
  }));
});

test('un dérivé nettoyé est lisible par son seul propriétaire et jamais inscriptible par le client', async () => {
  const derivativePath = 'private-derivatives/owner-a/cart-a/draft-binary-a1/presentation-v1';
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await context.storage(bucketUrl).ref(derivativePath).putString('dérivé privé', 'raw', {
      contentType: 'image/webp',
      customMetadata: {
        ownerUid: 'owner-a',
        cartularyId: 'cart-a',
        binaryId: 'draft-binary-a1',
        derivativeId: 'presentation-v1',
        metadataStripped: 'true',
      },
    });
  });
  const ownerStorage = testEnvironment.authenticatedContext('owner-a').storage(bucketUrl);
  const outsiderStorage = testEnvironment.authenticatedContext('owner-b').storage(bucketUrl);
  await assertSucceeds(ownerStorage.ref(derivativePath).getDownloadURL());
  await assertFails(outsiderStorage.ref(derivativePath).getDownloadURL());
  await assertFails(ownerStorage.ref(derivativePath).putString('faux dérivé'));
});

test('un autre compte et un visiteur ne peuvent ni lire ni écrire le brouillon privé', async () => {
  const outsiderStorage = testEnvironment.authenticatedContext('owner-b').storage(bucketUrl);
  const anonymousStorage = testEnvironment.unauthenticatedContext().storage(bucketUrl);
  await assertFails(outsiderStorage.ref(draftPath).getDownloadURL());
  await assertFails(anonymousStorage.ref(draftPath).getDownloadURL());
  await assertFails(outsiderStorage.ref(draftPath).putString('écrasement', 'raw', {
    customMetadata: {
      ownerUid: 'owner-a', cartularyId: 'cart-a', binaryId: draftBinaryId,
      sha256: `sha256:${draftDigest}`, kind: 'media',
    },
  }));
});

test('un objet dont les métadonnées ne correspondent pas au chemin reste illisible', async () => {
  const inconsistentPath = `private-drafts/owner-a/cart-a/inconsistent-binary/${draftDigest}/original`;
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await context.storage(bucketUrl).ref(inconsistentPath).putString('objet incohérent', 'raw', {
      customMetadata: {
        ownerUid: 'owner-a',
        cartularyId: 'cart-a',
        binaryId: 'autre-binaire',
        sha256: `sha256:${draftDigest}`,
        kind: 'media',
      },
    });
  });
  const ownerStorage = testEnvironment.authenticatedContext('owner-a').storage(bucketUrl);
  await assertFails(ownerStorage.ref(inconsistentPath).getDownloadURL());
});

test('la suppression logique du brouillon coupe immédiatement la lecture Storage', async () => {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'privateDrafts', 'owner-a', 'cartularies', 'cart-a'), {
      ownerUid: 'owner-a',
      cartularyId: 'cart-a',
      status: 'deleted',
      retentionPolicyVersion: 'inactive-plus-2y-v1',
    });
  });
  const ownerStorage = testEnvironment.authenticatedContext('owner-a').storage(bucketUrl);
  await assertFails(ownerStorage.ref(draftPath).getDownloadURL());
});

test('le passage du compte à inactif coupe immédiatement la lecture et les nouveaux dépôts privés', async () => {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', 'owner-a'), { uid: 'owner-a', status: 'inactive' });
  });
  const ownerStorage = testEnvironment.authenticatedContext('owner-a').storage(bucketUrl);
  await assertFails(ownerStorage.ref(draftPath).getDownloadURL());
  const newDigest = 'e'.repeat(64);
  await assertFails(ownerStorage.ref(`private-drafts/owner-a/cart-a/inactive-file/${newDigest}/original`).putString('refusé', 'raw', {
    customMetadata: {
      ownerUid: 'owner-a', cartularyId: 'cart-a', binaryId: 'inactive-file',
      sha256: `sha256:${newDigest}`, kind: 'media',
    },
  }));
});

test('un visiteur anonyme lit uniquement le dérivé d’une publication active', async () => {
  const storage = testEnvironment.unauthenticatedContext().storage(bucketUrl);
  await assertSucceeds(storage.ref(publicPath).getDownloadURL());
});

test('la révocation Firestore invalide immédiatement l’accès au dérivé', async () => {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'publications', publicCode), {
      publicCode,
      status: 'revoked',
      publicationStatus: 'revoked',
    });
  });
  const storage = testEnvironment.unauthenticatedContext().storage(bucketUrl);
  await assertFails(storage.ref(publicPath).getDownloadURL());
});

test('seul un membre admis lit un dérivé communautaire séparé', async () => {
  const memberStorage = testEnvironment.authenticatedContext('member-a').storage(bucketUrl);
  const outsiderStorage = testEnvironment.authenticatedContext('outsider-a').storage(bucketUrl);
  const anonymousStorage = testEnvironment.unauthenticatedContext().storage(bucketUrl);
  await assertSucceeds(memberStorage.ref(communityPath).getDownloadURL());
  await assertFails(outsiderStorage.ref(communityPath).getDownloadURL());
  await assertFails(anonymousStorage.ref(communityPath).getDownloadURL());
});

test('la modération suspend immédiatement le dérivé communautaire', async () => {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'communityPublications', communityPublicationId), {
      publicationId: communityPublicationId,
      status: 'suspended',
      moderationStatus: 'suspended',
    });
  });
  const storage = testEnvironment.authenticatedContext('member-a').storage(bucketUrl);
  await assertFails(storage.ref(communityPath).getDownloadURL());
});
