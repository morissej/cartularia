/**
 * Fiche de spécifications d'un Cartulaire (clé `cartularia-specification-groups`, V5 point 3 / P-C4).
 *
 * Module pur : ni React, ni Firebase, ni Cartulaire actif. La forme persistée
 * `{ id, title, items: [{ id, label, value }] }` est celle normalisée par
 * `src/persistence/storedStateValidation.ts` et écrite par la création
 * (`src/domain/cartularyCreation.ts`) et par les seeds ; elle ne change pas ici.
 *
 * Règle de relecture : dès que l'état enregistré porte la structure du lecteur
 * (au moins un groupe du catalogue), il fait foi pour les groupes, les lignes,
 * leur ordre, leurs libellés et leurs valeurs ; le catalogue ne sert qu'à
 * compléter un titre ou un libellé blanc, à fournir la valeur de repli d'une
 * valeur vide et à réinsérer une ligne d'identité absente. Sinon (forme de
 * création « identity », forme héritée réparée), le catalogue est complété par
 * les valeurs enregistrées, par identifiant, comme avant V5.
 */

export interface SpecificationItem {
  id: string;
  label: string;
  value: string;
}

export interface SpecificationGroup {
  id: string;
  title: string;
  items: SpecificationItem[];
}

/**
 * Lignes posées à la création (`buildCreationSpecificationGroups`), relues par identifiant côté
 * client (`creationProfileFromSpecificationGroups`, `src/data/activeCartulary.ts`) et côté serveur
 * (`scripts/lib/live-sync-command.mjs`, dérivation de l'identité du Registre) : non supprimables,
 * libellé fixe, réinsérées à la relecture si elles manquent.
 */
export const PROTECTED_SPECIFICATION_IDS: ReadonlySet<string> = new Set(['brand', 'model', 'reference', 'year', 'caliber']);

/** Titre de repli d'un groupe sans titre, aligné sur le mini-site (`src/domain/websiteDraft.ts`). */
export const UNTITLED_SPECIFICATION_GROUP_TITLE = 'Caractéristiques';

/** Remplacements de valeurs historiques conservés à la relecture. */
const LEGACY_VALUE_REPLACEMENTS: Readonly<Record<string, string>> = { 'Voir 04 · Valeur': 'Voir 04 · Valorisation' };

const normalizeValue = (value: unknown): string => (typeof value === 'string' ? (LEGACY_VALUE_REPLACEMENTS[value] ?? value) : '');

const normalizeLabel = (label: string): string => label.trim().toLocaleLowerCase();

/** Unicité du libellé dans un groupe, à la casse et aux espaces près (catalogue IA : « Libellé unique dans son groupe »). */
export const isDuplicateSpecificationLabel = (existingLabels: readonly string[], label: string): boolean => {
  const candidate = normalizeLabel(label);
  return candidate.length > 0 && existingLabels.some((existing) => normalizeLabel(existing) === candidate);
};

const cloneItem = (item: SpecificationItem): SpecificationItem => ({ id: item.id, label: item.label, value: item.value });

/**
 * Réinsère chaque ligne d'identité absente depuis le catalogue : en fin de son groupe d'origine,
 * groupe recréé à sa place dans l'ordre du catalogue s'il manque. Les groupes déjà présents ne sont
 * pas réordonnés ; une ligne d'identité déplacée dans un autre groupe est laissée où elle est.
 */
export const ensureProtectedSpecificationRows = (
  groups: readonly SpecificationGroup[],
  defaults: readonly SpecificationGroup[],
): SpecificationGroup[] => {
  const present = new Set(groups.flatMap((group) => group.items.map((item) => item.id)));
  const result = groups.map((group) => ({ id: group.id, title: group.title, items: [...group.items] }));
  const defaultOrder = new Map(defaults.map((group, index) => [group.id, index]));
  for (const defaultGroup of defaults) {
    for (const item of defaultGroup.items) {
      if (!PROTECTED_SPECIFICATION_IDS.has(item.id) || present.has(item.id)) continue;
      let target = result.find((group) => group.id === defaultGroup.id);
      if (!target) {
        target = { id: defaultGroup.id, title: defaultGroup.title, items: [] };
        const rank = defaultOrder.get(defaultGroup.id) ?? Number.MAX_SAFE_INTEGER;
        let insertAt = 0;
        result.forEach((group, index) => {
          const groupRank = defaultOrder.get(group.id);
          if (groupRank !== undefined && groupRank < rank) insertAt = index + 1;
        });
        result.splice(insertAt, 0, target);
      }
      target.items.push(cloneItem(item));
      present.add(item.id);
    }
  }
  return result;
};

/**
 * Fusion de relecture de l'état enregistré (déjà normalisé) avec le catalogue du lecteur.
 * Pour un état complet écrit par le lecteur, la sortie est identique à l'entrée
 * (`JSON.stringify` égal) : aucune réécriture du coffre au montage, donc aucune poussée cloud
 * provoquée par la seule ouverture.
 */
export const mergeStoredSpecificationGroups = (
  stored: readonly SpecificationGroup[],
  defaults: readonly SpecificationGroup[],
): SpecificationGroup[] => {
  const defaultGroups = new Map(defaults.map((group) => [group.id, group]));
  const defaultItems = new Map(defaults.flatMap((group) => group.items).map((item) => [item.id, item]));
  const readerShaped = stored.some((group) => defaultGroups.has(group.id));
  if (!readerShaped) {
    // Forme de création « identity » ou forme héritée : catalogue complété par les valeurs enregistrées, par identifiant.
    const storedValues = new Map(stored.flatMap((group) => group.items ?? []).map((item) => [item.id, normalizeValue(item.value)]));
    return defaults.map((group) => ({
      id: group.id,
      title: group.title,
      items: group.items.map((item) => ({ id: item.id, label: item.label, value: storedValues.get(item.id) || item.value })),
    }));
  }
  // Forme du lecteur : l'état enregistré fait foi (groupes, lignes, ordre, ajouts, suppressions, libellés).
  const merged = stored.map((group) => ({
    id: group.id,
    title: group.title.trim() ? group.title : (defaultGroups.get(group.id)?.title ?? UNTITLED_SPECIFICATION_GROUP_TITLE),
    items: (group.items ?? []).map((item) => {
      const fallback = defaultItems.get(item.id);
      const keepDefaultLabel = fallback !== undefined && (PROTECTED_SPECIFICATION_IDS.has(item.id) || !item.label.trim());
      return {
        id: item.id,
        label: keepDefaultLabel ? fallback.label : item.label,
        value: normalizeValue(item.value) || fallback?.value || '',
      };
    }),
  }));
  return ensureProtectedSpecificationRows(merged, defaults);
};

export interface SpecificationDraft {
  id: string;
  label: string;
  value: string;
}

/**
 * Seul point d'entrée de l'ajout d'une ligne : libellé rogné non vide et unique dans son groupe,
 * valeur rognée (facultative). Renvoie `null` si l'ajout est refusé ou si le groupe est inconnu ;
 * l'entrée n'est jamais mutée et les autres groupes sont renvoyés tels quels.
 */
export const appendSpecification = (
  groups: readonly SpecificationGroup[],
  groupId: string,
  draft: SpecificationDraft,
): SpecificationGroup[] | null => {
  const label = draft.label.trim();
  if (!label) return null;
  const group = groups.find((candidate) => candidate.id === groupId);
  if (!group) return null;
  if (isDuplicateSpecificationLabel(group.items.map((item) => item.label), label)) return null;
  const item: SpecificationItem = { id: draft.id, label, value: draft.value.trim() };
  return groups.map((candidate) => (candidate.id === groupId ? { ...candidate, items: [...candidate.items, item] } : candidate));
};

/** Correspondance de l'ancienne clé `cartularia-basic-watch-data` (une valeur par identifiant du groupe « basic »). */
const LEGACY_WATCH_DATA_FIELDS: ReadonlyArray<readonly [itemId: string, legacyField: string]> = [
  ['ad-code', 'adCode'], ['brand', 'brand'], ['collection', 'collection'], ['model', 'model'],
  ['reference', 'reference'], ['movement', 'movement'], ['case', 'caseMaterial'],
  ['bracelet', 'braceletMaterial'], ['year', 'productionYear'], ['condition', 'condition'],
  ['delivered', 'deliveredContent'], ['gender', 'gender'], ['location', 'location'],
  ['price', 'price'], ['availability', 'availability'],
];

/** Migration de l'ancienne clé `cartularia-basic-watch-data` vers le catalogue : reprise de la table historique du lecteur, sans modification. */
export const specificationGroupsFromLegacyWatchData = (
  legacy: Readonly<Record<string, string>>,
  defaults: readonly SpecificationGroup[],
): SpecificationGroup[] => {
  const legacyValues = new Map(LEGACY_WATCH_DATA_FIELDS.map(([itemId, legacyField]) => [itemId, legacy[legacyField]]));
  return defaults.map((group) => ({
    id: group.id,
    title: group.title,
    items: group.items.map((item) => ({ id: item.id, label: item.label, value: legacyValues.get(item.id) ?? item.value })),
  }));
};
