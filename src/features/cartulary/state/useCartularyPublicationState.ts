import { useCallback } from 'react';
import type { PublicationDecision, PublishedBlockId } from '../../../domain/publication';
import type { PublicationSourceBinding } from './cartularyStateTypes';
import { usePersistentCartularyState } from './usePersistentCartularyState';

interface PublicationStateOptions {
  loadWebsiteBlocks: () => PublishedBlockId[];
  loadReportBlocks: () => PublishedBlockId[];
  loadCommunityBlocks: () => PublishedBlockId[];
  loadDecisions: () => PublicationDecision[];
  loadSourceBinding: () => PublicationSourceBinding;
}

export const useCartularyPublicationState = (options: PublicationStateOptions) => {
  const website = usePersistentCartularyState({ key: 'cartularia-published-blocks', load: options.loadWebsiteBlocks });
  const report = usePersistentCartularyState({ key: 'cartularia-report-blocks', load: options.loadReportBlocks });
  const community = usePersistentCartularyState({ key: 'cartularia-community-blocks', load: options.loadCommunityBlocks });
  const decisions = usePersistentCartularyState({ key: 'cartularia-publication-decisions-v1', load: options.loadDecisions });
  const sourceBinding = usePersistentCartularyState({
    key: 'cartularia-publication-source-v1',
    load: options.loadSourceBinding,
    shouldPersist: (binding: PublicationSourceBinding) => Boolean(binding.digest),
  });
  const reloadWebsite = website.reloadIfPresent;
  const reloadReport = report.reloadIfPresent;
  const reloadCommunity = community.reloadIfPresent;
  const reloadDecisions = decisions.reloadIfPresent;
  const reloadSourceBinding = sourceBinding.reloadIfPresent;
  const reloadPublicationState = useCallback((keys: ReadonlySet<string>) => [
    reloadWebsite(keys),
    reloadReport(keys),
    reloadCommunity(keys),
    reloadDecisions(keys),
    reloadSourceBinding(keys),
  ].some(Boolean), [
    reloadWebsite,
    reloadReport,
    reloadCommunity,
    reloadDecisions,
    reloadSourceBinding,
  ]);

  return {
    publishedBlocks: website.value,
    reportBlocks: report.value,
    communityBlocks: community.value,
    publicationDecisions: decisions.value,
    publicationSourceBinding: sourceBinding.value,
    reloadPublicationState,
    commands: {
      replaceWebsiteBlocks: website.replace,
      replaceReportBlocks: report.replace,
      replaceCommunityBlocks: community.replace,
      replaceDecisions: decisions.replace,
      setSourceBinding: sourceBinding.replace,
    },
  };
};
