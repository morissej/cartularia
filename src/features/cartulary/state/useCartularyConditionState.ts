import { useCallback } from 'react';
import type {
  ConditionEntry,
  DocumentationItem,
  IdentificationCheck,
} from './cartularyStateTypes';
import { usePersistentCartularyState } from './usePersistentCartularyState';

interface ConditionStateOptions {
  loadChecks: () => IdentificationCheck[];
  loadEntries: () => ConditionEntry[];
  loadDocumentation: () => DocumentationItem[];
}

export const useCartularyConditionState = ({ loadChecks, loadEntries, loadDocumentation }: ConditionStateOptions) => {
  const checks = usePersistentCartularyState({ key: 'cartularia-identification-checks', load: loadChecks });
  const entries = usePersistentCartularyState({
    key: 'cartularia-condition-entries',
    load: loadEntries,
    serialize: (items: ConditionEntry[]) => items.map((entry) => ({
      ...entry,
      attachments: entry.attachments.map((attachment) => ({
        ...attachment,
        url: attachment.url?.startsWith('blob:') ? undefined : attachment.url,
      })),
    })),
  });
  const documentation = usePersistentCartularyState({ key: 'cartularia-documentation-items', load: loadDocumentation });
  const reloadChecks = checks.reloadIfPresent;
  const reloadEntries = entries.reloadIfPresent;
  const reloadDocumentation = documentation.reloadIfPresent;
  const reloadConditionState = useCallback((keys: ReadonlySet<string>) => [
    reloadChecks(keys),
    reloadEntries(keys),
    reloadDocumentation(keys),
  ].some(Boolean), [reloadChecks, reloadEntries, reloadDocumentation]);

  return {
    identificationChecks: checks.value,
    conditionEntries: entries.value,
    documentationItems: documentation.value,
    reloadConditionState,
    commands: {
      replaceChecks: checks.replace,
      replaceEntries: entries.replace,
      replaceDocumentation: documentation.replace,
      updateCheck: (id: string, patch: Partial<IdentificationCheck>) => checks.replace((current) => current.map((item) => (
        item.id === id ? { ...item, ...patch } : item
      ))),
      addCheck: (item: IdentificationCheck) => checks.replace((current) => [...current, item]),
      addEntry: (entry: ConditionEntry) => entries.replace((current) => [entry, ...current].sort((a, b) => b.date.localeCompare(a.date))),
      updateEntry: (id: string, patch: Partial<ConditionEntry>) => entries.replace((current) => current.map((entry) => (
        entry.id === id ? { ...entry, ...patch } : entry
      ))),
      updateDocumentation: <K extends keyof DocumentationItem>(id: string, key: K, value: DocumentationItem[K]) => {
        documentation.replace((current) => current.map((item) => item.id === id ? { ...item, [key]: value } : item));
      },
    },
  };
};
