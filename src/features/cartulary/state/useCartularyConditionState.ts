import { useCallback } from 'react';
import type {
  ConditionEntry,
  DocumentationItem,
  IdentificationCheck,
} from './cartularyStateTypes';
import { usePersistentCartularyState } from './usePersistentCartularyState';
import type { CartulariaLocalVault } from '../../../persistence/localVault';
import type { PreparedImport } from '../media/importMediaFiles';
import type { ConditionAttachment } from './cartularyStateTypes';

interface ConditionStateOptions {
  loadChecks: () => IdentificationCheck[];
  loadEntries: () => ConditionEntry[];
  loadDocumentation: () => DocumentationItem[];
}

export const useCartularyConditionState = ({ loadChecks, loadEntries, loadDocumentation }: ConditionStateOptions) => {
  const checks = usePersistentCartularyState({ key: 'cartularia-identification-checks', load: loadChecks });
  const entries = usePersistentCartularyState({
    key: 'cartularia-condition-entries',
    protectImports: true,
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
    persistenceError: entries.persistenceError,
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
      importEntry: (vault: CartulariaLocalVault, prepared: PreparedImport<ConditionAttachment>, entry: ConditionEntry) => entries.commitImport(
        vault, prepared.binaries,
        (current) => [entry, ...current].sort((a, b) => b.date.localeCompare(a.date)),
        (committed, current) => {
          const previews = new Map([...current.flatMap((item) => item.attachments), ...prepared.items]
            .filter((attachment) => attachment.binaryId).map((attachment) => [attachment.binaryId, attachment.url]));
          return committed.map((item) => ({ ...item, attachments: item.attachments.map((attachment) => ({
            ...attachment, url: (attachment.binaryId && previews.get(attachment.binaryId)) || attachment.url,
          })) }));
        },
      ),
      updateEntry: (id: string, patch: Partial<ConditionEntry>) => entries.replace((current) => current.map((entry) => (
        entry.id === id ? { ...entry, ...patch } : entry
      ))),
      updateDocumentation: <K extends keyof DocumentationItem>(id: string, key: K, value: DocumentationItem[K]) => {
        documentation.replace((current) => current.map((item) => item.id === id ? { ...item, [key]: value } : item));
      },
    },
  };
};
