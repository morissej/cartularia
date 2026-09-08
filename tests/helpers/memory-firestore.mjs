/**
 * Firestore minimal en mémoire pour tester les commandes serveur sans émulateur :
 * documents, sous-collections, `get/set/update/create/delete`, requêtes `where ==`, transactions
 * sérialisées. Les sentinelles (`FieldValue`) sont conservées telles quelles.
 */
export const createMemoryFirestore = (initial = {}) => {
  const documents = new Map(Object.entries(initial).map(([path, data]) => [path, structuredClone(data)]));
  const snapshot = (path) => ({ id: path.split('/').at(-1), ref: docRef(path), exists: documents.has(path), data: () => (documents.has(path) ? structuredClone(documents.get(path)) : undefined) });
  const write = (path, data, { merge = false, create = false, update = false } = {}) => {
    if (create && documents.has(path)) throw new Error(`Document déjà présent : ${path}`);
    if (update && !documents.has(path)) throw new Error(`Document absent : ${path}`);
    const next = merge || update ? { ...(documents.get(path) ?? {}), ...structuredClone(data) } : structuredClone(data);
    documents.set(path, next);
  };
  const collectionRef = (path) => {
    const query = (filters = []) => ({
      where: (field, operator, value) => query([...filters, { field, operator, value }]),
      get: async () => {
        const depth = path.split('/').length + 1;
        const docs = [...documents.keys()]
          .filter((candidate) => candidate.startsWith(`${path}/`) && candidate.split('/').length === depth)
          .map(snapshot)
          .filter((entry) => filters.every(({ field, operator, value }) => operator === '==' ? entry.data()?.[field] === value : operator === '!=' ? entry.data()?.[field] !== value : true));
        return { docs, size: docs.length, empty: docs.length === 0 };
      },
      doc: (id) => docRef(`${path}/${id}`),
    });
    return query();
  };
  const docRef = (path) => ({
    id: path.split('/').at(-1),
    path,
    get: async () => snapshot(path),
    set: async (data, options) => write(path, data, options),
    update: async (data) => write(path, data, { update: true }),
    create: async (data) => write(path, data, { create: true }),
    delete: async () => { documents.delete(path); },
    collection: (name) => collectionRef(`${path}/${name}`),
  });
  const transaction = {
    get: async (ref) => snapshot(ref.path),
    set: (ref, data, options) => write(ref.path, data, options),
    update: (ref, data) => write(ref.path, data, { update: true }),
    create: (ref, data) => write(ref.path, data, { create: true }),
    delete: (ref) => { documents.delete(ref.path); },
  };
  return {
    doc: docRef,
    collection: collectionRef,
    runTransaction: async (operation) => operation(transaction),
    batch: () => ({ set: (ref, data, options) => write(ref.path, data, options), update: (ref, data) => write(ref.path, data, { update: true }), commit: async () => {} }),
    dump: () => Object.fromEntries([...documents.entries()].map(([path, data]) => [path, structuredClone(data)])),
  };
};
