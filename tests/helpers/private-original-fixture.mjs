/** An attestation and a separate object inventory: mutating a manifest does not mutate Storage. */
export const ORIGINAL_TEST_BUCKET = 'cartularia-original-test.local';
export const verifiedPrivateBinary = (manifest, { bucket = ORIGINAL_TEST_BUCKET, generation = '1001' } = {}) => ({
  ...manifest,
  verificationIdentity: {
    schemaVersion: 'private-binary-identity@1.0.0',
    ownerUid: manifest.ownerUid, cartularyId: manifest.cartularyId, binaryId: manifest.binaryId,
    storagePath: manifest.storagePath, sha256: manifest.sha256, size: manifest.size, bucket, generation,
  },
});

export const createPrivateOriginalStorage = (manifests = []) => {
  const objects = new Map();
  const reads = [];
  const register = (manifest, overrides = {}) => {
    const identity = manifest.verificationIdentity;
    objects.set(manifest.storagePath, {
      name: manifest.storagePath, bucket: identity.bucket, generation: identity.generation,
      size: String(manifest.size), contentType: manifest.mimeType,
      metadata: { ownerUid: manifest.ownerUid, cartularyId: manifest.cartularyId, binaryId: manifest.binaryId,
        sha256: manifest.sha256, kind: manifest.kind },
      ...overrides,
    });
  };
  for (const manifest of manifests) register(manifest);
  const bucket = {
    name: ORIGINAL_TEST_BUCKET,
    file: (path, options = {}) => ({
      name: path, generation: options.generation,
      getMetadata: async () => {
        reads.push({ path, generation: options.generation });
        const metadata = objects.get(path);
        if (!metadata || (options.generation && String(options.generation) !== String(metadata.generation))) {
          throw Object.assign(new Error('Object not found'), { code: 404 });
        }
        return [structuredClone(metadata)];
      },
    }),
  };
  return { objects, reads, register, bucket: () => bucket };
};
