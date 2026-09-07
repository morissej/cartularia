import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// Read-only inventory: print counts and configuration, never identities or content.
for (const projectId of ['studio-2614005370-a3e51', 'cartularia-vault-a3e51', 'cartularia-bridge-a3e51']) {
  const app = initializeApp({ credential: applicationDefault(), projectId }, `audit-${projectId}`);
  const db = getFirestore(app);
  const auth = getAuth(app);
  let users = 0, disabled = 0, nextPageToken;
  do {
    const page = await auth.listUsers(1000, nextPageToken);
    users += page.users.length;
    disabled += page.users.filter((user) => user.disabled).length;
    nextPageToken = page.pageToken;
  } while (nextPageToken);
  const counts = {};
  for (const group of ['vault', 'memberships']) {
    try { counts[group] = (await db.collectionGroup(group).count().get()).data().count; }
    catch (error) { counts[group] = `unavailable:${error.code || 'unknown'}`; }
  }
  for (const name of ['users', 'vaultRecovery', 'codeBridgeUsers', 'correspondenceCodes', 'publications', 'collectionPublications']) {
    try { counts[name] = (await db.collection(name).count().get()).data().count; }
    catch (error) { counts[name] = `unavailable:${error.code || 'unknown'}`; }
  }
  console.log(JSON.stringify({ projectId, authentication: { users, disabled }, counts }));
}
