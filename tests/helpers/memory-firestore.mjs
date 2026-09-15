/**
 * Firestore minimal en mémoire pour tester les commandes serveur sans émulateur :
 * documents, sous-collections, `get/set/update/create/delete`, requêtes `where ==`, `orderBy`
 * (tri simple sur un champ), `limit`, transactions sérialisées. Les sentinelles (`FieldValue`)
 * sont conservées telles quelles.
 *
 * Extensions rétrocompatibles (purge de Cartulaire de test) : `docRef.listCollections()`,
 * `collectionRef.listDocuments()` (documents « manquants » mais porteurs de descendants inclus,
 * comme Firestore), `collectionRef.id/path/parent`, `docRef.parent`, `firestore.collectionGroup(name)`
 * (`where ==` seulement), `firestore.listCollections()`, `batch.delete(ref)`.
 */
export const createMemoryFirestore = (initial = {}) => {
  const documents = new Map(Object.entries(initial).map(([path, data]) => [path, structuredClone(data)]));
  const snapshot = (path) => ({ id: path.split('/').at(-1), ref: docRef(path), exists: documents.has(path), data: () => (documents.has(path) ? structuredClone(documents.get(path)) : undefined) });
  // Sémantique Firestore (SDK Admin, DocumentMask.fromObject) : `set(…, { merge: true })` fusionne les maps imbriquées EN
  // PROFONDEUR (un champ map existant garde ses clés absentes du patch) ; une map explicitement VIDE ({}), un tableau, null,
  // une instance (Timestamp) ou une sentinelle REMPLACENT le champ ; `FieldValue.delete()` retire le champ ; `update()` et un
  // `set` sans merge REMPLACENT chaque champ nommé. La fusion est décidée sur la donnée brute (prototypes intacts), le clonage
  // vient après : une instance ou une sentinelle n'est jamais confondue avec une map. Les clés pointées ne sont pas des
  // chemins ici (aucun appelant n'en écrit).
  const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
  const isDeleteSentinel = (value) => value !== null && typeof value === 'object' && value.methodName === 'FieldValue.delete';
  const deepMerge = (base, patch) => {
    const next = { ...base };
    for (const [key, value] of Object.entries(patch)) {
      if (isDeleteSentinel(value)) { delete next[key]; continue; }
      next[key] = isPlainObject(value) && Object.keys(value).length > 0 && isPlainObject(base?.[key]) ? deepMerge(base[key], value) : value;
    }
    return next;
  };
  const shallowApply = (base, patch) => {
    const next = { ...base };
    for (const [key, value] of Object.entries(patch)) { if (isDeleteSentinel(value)) delete next[key]; else next[key] = value; }
    return next;
  };
  const write = (path, data, { merge = false, create = false, update = false } = {}) => {
    if (create && documents.has(path)) throw new Error(`Document déjà présent : ${path}`);
    if (update && !documents.has(path)) throw new Error(`Document absent : ${path}`);
    const existing = documents.get(path) ?? {};
    const next = merge ? deepMerge(existing, data) : update ? shallowApply(existing, data) : data;
    documents.set(path, structuredClone(next));
  };
  const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
  const matches = (entry, filters) => filters.every(({ field, operator, value }) => operator === '==' ? entry.data()?.[field] === value : operator === '!=' ? entry.data()?.[field] !== value : true);
  const finish = (docs, order, maximum) => {
    // Sans orderBy, Firestore rend les documents dans l'ordre de leur identifiant (jamais l'ordre d'insertion).
    let result = [...docs].sort((left, right) => compare(left.ref.path, right.ref.path));
    if (order) result = [...result].sort((left, right) => (order.direction === 'desc' ? -1 : 1) * compare(left.data()?.[order.field], right.data()?.[order.field]));
    if (maximum !== null) result = result.slice(0, maximum);
    return { docs: result, size: result.length, empty: result.length === 0 };
  };
  /** Identifiants des enfants directs (documents existants ou simplement porteurs de descendants) d'un chemin. */
  const childIds = (path, minimumExtraSegments) => {
    const prefix = path ? `${path}/` : '';
    const base = path ? path.split('/').length : 0;
    return [...new Set([...documents.keys()]
      .filter((candidate) => candidate.startsWith(prefix) && candidate.split('/').length >= base + minimumExtraSegments)
      .map((candidate) => candidate.split('/')[base]))].sort();
  };
  const collectionRef = (path) => {
    const query = (filters = [], order = null, maximum = null) => ({
      id: path.split('/').at(-1),
      path,
      parent: path.includes('/') ? docRef(path.split('/').slice(0, -1).join('/')) : null,
      where: (field, operator, value) => query([...filters, { field, operator, value }], order, maximum),
      orderBy: (field, direction = 'asc') => query(filters, { field, direction }, maximum),
      limit: (count) => query(filters, order, count),
      get: async () => {
        const depth = path.split('/').length + 1;
        const docs = [...documents.keys()]
          .filter((candidate) => candidate.startsWith(`${path}/`) && candidate.split('/').length === depth)
          .map(snapshot)
          .filter((entry) => matches(entry, filters));
        return finish(docs, order, maximum);
      },
      listDocuments: async () => childIds(path, 1).map((id) => docRef(`${path}/${id}`)),
      doc: (id) => docRef(`${path}/${id}`),
    });
    return query();
  };
  const docRef = (path) => ({
    id: path.split('/').at(-1),
    path,
    parent: collectionRef(path.split('/').slice(0, -1).join('/')),
    get: async () => snapshot(path),
    set: async (data, options) => write(path, data, options),
    update: async (data) => write(path, data, { update: true }),
    create: async (data) => write(path, data, { create: true }),
    delete: async () => { documents.delete(path); },
    collection: (name) => collectionRef(`${path}/${name}`),
    listCollections: async () => childIds(path, 2).map((name) => collectionRef(`${path}/${name}`)),
  });
  const collectionGroup = (name) => {
    const query = (filters = [], order = null, maximum = null) => ({
      where: (field, operator, value) => query([...filters, { field, operator, value }], order, maximum),
      orderBy: (field, direction = 'asc') => query(filters, { field, direction }, maximum),
      limit: (count) => query(filters, order, count),
      get: async () => {
        const docs = [...documents.keys()]
          .filter((candidate) => { const segments = candidate.split('/'); return segments.length % 2 === 0 && segments.at(-2) === name; })
          .map(snapshot)
          .filter((entry) => matches(entry, filters));
        return finish(docs, order, maximum);
      },
    });
    return query();
  };
  const transaction = {
    get: async (ref) => (typeof ref.get === 'function' && ref.path && !ref.where ? snapshot(ref.path) : ref.get()),
    set: (ref, data, options) => write(ref.path, data, options),
    update: (ref, data) => write(ref.path, data, { update: true }),
    create: (ref, data) => write(ref.path, data, { create: true }),
    delete: (ref) => { documents.delete(ref.path); },
  };
  return {
    doc: docRef,
    collection: collectionRef,
    collectionGroup,
    listCollections: async () => childIds('', 1).map((name) => collectionRef(name)),
    runTransaction: async (operation) => operation(transaction),
    batch: () => ({
      set: (ref, data, options) => write(ref.path, data, options),
      update: (ref, data) => write(ref.path, data, { update: true }),
      delete: (ref) => { documents.delete(ref.path); },
      commit: async () => {},
    }),
    dump: () => Object.fromEntries([...documents.entries()].map(([path, data]) => [path, structuredClone(data)])),
  };
};
