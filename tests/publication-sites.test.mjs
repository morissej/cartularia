import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const root = readFileSync(new URL('../src/RootPage.tsx', import.meta.url), 'utf8');
const collectionSite = readFileSync(new URL('../src/components/CollectionWebsitePage.tsx', import.meta.url), 'utf8');
const communitySite = readFileSync(new URL('../src/components/CommunityPage.tsx', import.meta.url), 'utf8');
const communityService = readFileSync(new URL('../src/services/community.ts', import.meta.url), 'utf8');

test('la page Publication expose les sites Collection et Cercle après validation générale', () => {
  assert.match(app, /collectionPublicationEnabled && publicationCollectionIds\.length > 0/);
  assert.match(app, /Accéder au mini-site/);
  assert.match(app, /communityPublicationEnabled &&/);
  assert.match(app, /Accéder au Cercle/);
});

test('le site Collection agrège les objets projetés et les filtre par type', () => {
  assert.match(root, /CollectionWebsitePage/);
  assert.match(collectionSite, /loadCollectionWebsitePublication/);
  assert.match(collectionSite, /publicationId/);
  assert.match(collectionSite, /projection de publication dédiée/);
  assert.match(collectionSite, /Filtrer par type d’objet/);
});

test('Le Cercle agrège toutes les publications approuvées et les filtre par type', () => {
  assert.match(communityService, /loadCommunityCatalog/);
  assert.match(communityService, /collection\(db, 'communityPublications'\)/);
  assert.match(communitySite, /Filtrer Le Cercle par type d’objet/);
  assert.match(communitySite, /visibleCatalog/);
});
