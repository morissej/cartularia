import { writeFile } from 'node:fs/promises';
import { verifiedPrivateBinary } from './private-original-fixture.mjs';

/** Real byte inventory; manifests never supply Storage metadata implicitly. */
export const createMemoryStorage = (bucketName = 'cartularia-v3-test.appspot.com') => {
  const blobs = new Map();
  const journal = [];
  const downloads = [];
  let nextGeneration = 1000;
  const bucket = {
    name: bucketName,
    file: (path, { generation } = {}) => {
      const resolve = () => {
        const blob = blobs.get(path);
        if (!blob || (generation && String(generation) !== blob.generation)) throw Object.assign(new Error(`No such object: ${path}`), { code: 404 });
        return blob;
      };
      return {
        name: path, generation,
        save: async (bytes, options) => {
          const expected = options?.preconditionOpts?.ifGenerationMatch;
          if (expected !== undefined && String(expected) !== (blobs.get(path)?.generation ?? '0')) throw Object.assign(new Error('Precondition failed'), { code: 412 });
          blobs.set(path, { bytes: Buffer.from(bytes), options, generation: String(++nextGeneration) });
          journal.push(`save:${path}`);
        },
        download: async (options) => {
          const blob = resolve(); downloads.push({ path, generation });
          if (options?.destination) { await writeFile(options.destination, blob.bytes); return []; }
          return [Buffer.from(blob.bytes)];
        },
        exists: async () => [blobs.has(path) && (!generation || generation === blobs.get(path).generation)],
        getMetadata: async () => {
          const blob = resolve();
          return [{ name: path, bucket: bucketName, generation: blob.generation, size: String(blob.bytes.length),
            contentType: blob.options?.metadata?.contentType, metadata: blob.options?.metadata?.metadata ?? {} }];
        },
        delete: async () => { resolve(); blobs.delete(path); },
      };
    },
    getFiles: async ({ prefix }) => [[...blobs.keys()].filter((name) => name.startsWith(prefix)).sort().map((name) => bucket.file(name))],
  };
  return { blobs, journal, downloads, bucket, storage: { bucket: () => bucket } };
};

export const attestStoredManifest = async (bucket, manifest) => {
  const [metadata] = await bucket.file(manifest.storagePath).getMetadata();
  return verifiedPrivateBinary(manifest, { bucket: bucket.name, generation: metadata.generation });
};
