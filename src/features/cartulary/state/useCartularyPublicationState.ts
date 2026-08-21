import { useCallback } from 'react';
import type { PublicationDecision, PublishedBlockId } from '../../../domain/publication';
import type { PublicationSourceBinding } from './cartularyStateTypes';
import { usePersistentCartularyState } from './usePersistentCartularyState';

interface PublicationStateOptions {
  loadWebsiteBlocks: () => PublishedBlockId[];
  loadReportBlocks: () => PublishedBlockId[];
  loadCommunityBlocks: () => PublishedBlockId[];
  loadCollectionBlocks: () => PublishedBlockId[];
  loadCollectionIds: () => string[];
  loadExternalEnabled: () => boolean;
  loadCollectionEnabled: () => boolean;
  loadCommunityEnabled: () => boolean;
  loadDecisions: () => PublicationDecision[];
  loadSourceBinding: () => PublicationSourceBinding;
}

export const useCartularyPublicationState = (options: PublicationStateOptions) => {
  const website = usePersistentCartularyState({ key: 'cartularia-published-blocks', load: options.loadWebsiteBlocks });
  const report = usePersistentCartularyState({ key: 'cartularia-report-blocks', load: options.loadReportBlocks });
  const community = usePersistentCartularyState({ key: 'cartularia-community-blocks', load: options.loadCommunityBlocks });
  const collection = usePersistentCartularyState({ key: 'cartularia-collection-blocks', load: options.loadCollectionBlocks });
  const collectionIds = usePersistentCartularyState({ key: 'cartularia-publication-collection-ids', load: options.loadCollectionIds });
  const externalEnabled = usePersistentCartularyState({ key: 'cartularia-external-publication-enabled', load: options.loadExternalEnabled });
  const collectionEnabled = usePersistentCartularyState({ key: 'cartularia-collection-publication-enabled', load: options.loadCollectionEnabled });
  const communityEnabled = usePersistentCartularyState({ key: 'cartularia-community-publication-enabled', load: options.loadCommunityEnabled });
  const decisions = usePersistentCartularyState({ key: 'cartularia-publication-decisions-v1', load: options.loadDecisions });
  const sourceBinding = usePersistentCartularyState({
    key: 'cartularia-publication-source-v1',
    load: options.loadSourceBinding,
    shouldPersist: (binding: PublicationSourceBinding) => Boolean(binding.digest),
  });
  const reloadWebsite = website.reloadIfPresent;
  const reloadReport = report.reloadIfPresent;
  const reloadCommunity = community.reloadIfPresent;
  const reloadCollection = collection.reloadIfPresent;
  const reloadCollectionIds = collectionIds.reloadIfPresent;
  const reloadExternalEnabled = externalEnabled.reloadIfPresent;
  const reloadCollectionEnabled = collectionEnabled.reloadIfPresent;
  const reloadCommunityEnabled = communityEnabled.reloadIfPresent;
  const reloadDecisions = decisions.reloadIfPresent;
  const reloadSourceBinding = sourceBinding.reloadIfPresent;
  const reloadPublicationState = useCallback((keys: ReadonlySet<string>) => [
    reloadWebsite(keys),
    reloadReport(keys),
    reloadCommunity(keys),
    reloadCollection(keys),
    reloadCollectionIds(keys),
    reloadExternalEnabled(keys),
    reloadCollectionEnabled(keys),
    reloadCommunityEnabled(keys),
    reloadDecisions(keys),
    reloadSourceBinding(keys),
  ].some(Boolean), [
    reloadWebsite,
    reloadReport,
    reloadCommunity,
    reloadCollection,
    reloadCollectionIds,
    reloadExternalEnabled,
    reloadCollectionEnabled,
    reloadCommunityEnabled,
    reloadDecisions,
    reloadSourceBinding,
  ]);

  return {
    publishedBlocks: website.value,
    reportBlocks: report.value,
    communityBlocks: community.value,
    collectionBlocks: collection.value,
    publicationCollectionIds: collectionIds.value,
    externalPublicationEnabled: externalEnabled.value,
    collectionPublicationEnabled: collectionEnabled.value,
    communityPublicationEnabled: communityEnabled.value,
    publicationDecisions: decisions.value,
    publicationSourceBinding: sourceBinding.value,
    reloadPublicationState,
    commands: {
      replaceWebsiteBlocks: website.replace,
      replaceReportBlocks: report.replace,
      replaceCommunityBlocks: community.replace,
      replaceCollectionBlocks: collection.replace,
      replaceCollectionIds: collectionIds.replace,
      setExternalEnabled: externalEnabled.replace,
      setCollectionEnabled: collectionEnabled.replace,
      setCommunityEnabled: communityEnabled.replace,
      replaceDecisions: decisions.replace,
      setSourceBinding: sourceBinding.replace,
    },
  };
};
