import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { IWC_CARTULARY_ID, IWC_IMPORT_ACTOR_ID } from '../src/migrations/iwcImport.ts';
import { WATCH_SCHEMA } from '../src/schema/watchSchema.ts';
import {
  addCommunityComment,
  createCommunityPost,
  publishCommunityBlocks,
  setCommunityReaction,
} from './lib/community-command.mjs';

export const WAVE5_COMMUNITY_PUBLICATION_ID = 'community_iwc_pilot_20260814';
export const WAVE5_COMMUNITY_POST_ID = 'post_iwc_pilot_20260814';

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'cartularia-wave2-local';
const usesEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const allowRemote = process.argv.includes('--allow-remote');

if (!usesEmulator && !allowRemote) {
  throw new Error(
    'Communauté interrompue : utilisez l’émulateur ou passez explicitement --allow-remote avec des credentials Admin.',
  );
}

const expectedRevisionArgument = process.argv.find((argument) => argument.startsWith('--expected-revision='));
const expectedRevision = Number(expectedRevisionArgument?.split('=')[1] ?? 2);
if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
  throw new Error('--expected-revision doit être un entier positif.');
}

const app = getApps()[0] || initializeApp({
  projectId,
  ...(usesEmulator ? {} : { credential: applicationDefault() }),
});
const firestore = getFirestore(app);

const publication = await publishCommunityBlocks({
  firestore,
  schema: WATCH_SCHEMA,
  cartularyId: IWC_CARTULARY_ID,
  publicationId: WAVE5_COMMUNITY_PUBLICATION_ID,
  actorId: IWC_IMPORT_ACTOR_ID,
  requestId: 'wave5-publish-community-iwc-v1',
  expectedRevision,
  occurredAt: '2026-08-14T15:00:00.000Z',
  blocks: [
    {
      id: 'community-iwc-cover',
      title: 'Montre pilote',
      fields: {
        'cover.asset.type': 'Montre',
        'cover.watch.brand': 'IWC Schaffhausen',
        'cover.watch.model': 'Flieger UTC',
        'cover.watch.reference': 'IW3251-001',
        'cover.watch.status': 'Démonstration technique non certifiante',
      },
    },
    {
      id: 'community-iwc-reference',
      title: 'Repères de référence',
      fields: {
        'reference.specifications[].label': ['Calibre', 'Diamètre'],
        'reference.specifications[].value': ['Donnée de démonstration', '39 mm'],
      },
    },
    {
      id: 'community-iwc-condition',
      title: 'État partagé',
      fields: {
        'condition.summary.paragraphs[]': ['Fixture communautaire : aucune expertise réelle.'],
        'condition.summary.conclusion': 'Revue humaine requise avant tout usage patrimonial.',
        'condition.summary.openPoint': 'Sources et authenticité non vérifiées.',
      },
    },
  ],
});

const post = await createCommunityPost({
  firestore,
  postId: WAVE5_COMMUNITY_POST_ID,
  publicationId: WAVE5_COMMUNITY_PUBLICATION_ID,
  actorId: IWC_IMPORT_ACTOR_ID,
  body: 'Présentation du pilote communautaire isolé. Les informations affichées sont une fixture technique.',
  requestId: 'wave5-create-community-post-v1',
  occurredAt: '2026-08-14T15:05:00.000Z',
});

const comment = await addCommunityComment({
  firestore,
  postId: WAVE5_COMMUNITY_POST_ID,
  commentId: 'comment_wave5_pilot_001',
  actorId: IWC_IMPORT_ACTOR_ID,
  body: 'Commentaire de démonstration, sans valeur de preuve pour le Cartulaire.',
  requestId: 'wave5-comment-community-post-v1',
  occurredAt: '2026-08-14T15:06:00.000Z',
});

const reaction = await setCommunityReaction({
  firestore,
  postId: WAVE5_COMMUNITY_POST_ID,
  actorId: IWC_IMPORT_ACTOR_ID,
  reaction: 'useful',
  requestId: 'wave5-react-community-post-v1',
});

console.log(JSON.stringify({ publication, post, comment, reaction }, null, 2));
