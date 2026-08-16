export interface IdentifiedItem {
  id: string;
}

export interface RemovedItem<T> {
  item: T;
  index: number;
  remaining: T[];
}

export const removeItemById = <T extends IdentifiedItem>(items: T[], id: string): RemovedItem<T> | null => {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return null;
  return {
    item: items[index],
    index,
    remaining: items.filter((item) => item.id !== id),
  };
};

export const restoreItemAtIndex = <T extends IdentifiedItem>(items: T[], item: T, index: number): T[] => {
  if (items.some((candidate) => candidate.id === item.id)) return items;
  const restored = [...items];
  restored.splice(Math.max(0, Math.min(index, restored.length)), 0, item);
  return restored;
};
