/** A real, disposable worker used only against explicitly selected loopback emulators. */
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { processPrivateDraftUpload } from '../../scripts/lib/private-upload-command.mjs';

const projectId = process.env.GCLOUD_PROJECT;
const localEndpoint = /^(127\.0\.0\.1|localhost):[0-9]+$/;
if (!['cartularia-private-upload-test', 'demo-cartularia-p2', 'demo-cartularia-p3', 'demo-cartularia-p4'].includes(projectId)
  || !localEndpoint.test(process.env.FIRESTORE_EMULATOR_HOST || '')
  || !localEndpoint.test(process.env.FIREBASE_STORAGE_EMULATOR_HOST || '') || !process.send) {
  throw new Error('Worker de test réservé aux émulateurs locaux avec canal parent.');
}
let resume;
let started = false;
const pause = (stage) => new Promise((resolve) => { resume = resolve; process.send({ type: 'paused', stage }); });
process.on('message', async (message) => {
  if (message?.type === 'resume') { resume?.(); return; }
  if (message?.type !== 'start' || started) return;
  started = true;
  let app;
  try {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    app = initializeApp({ projectId, credential: cert({ projectId, clientEmail: `worker-test@${projectId}.iam.gserviceaccount.com`, privateKey }), storageBucket: `${projectId}.appspot.com` }, `interrupted-upload-${randomUUID()}`);
    const firestore = getFirestore(app);
    const storage = getStorage(app);
    let paused = false;
    const wrappedStorage = {
      bucket: (name) => {
        const bucket = storage.bucket(name);
        return new Proxy(bucket, { get(target, key) {
          if (key !== 'file') { const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; }
          return (path, options) => {
            const file = bucket.file(path, options);
            return new Proxy(file, { get(targetFile, method) {
              if (method === 'download') return async (...args) => {
                if (!paused && message.stage === 'before_download' && path === message.object.name && options?.generation) {
                  paused = true; await pause(message.stage);
                }
                return file.download(...args);
              };
              if (method === 'save') return async (...args) => {
                const result = await file.save(...args);
                if (!paused && message.stage === 'after_derivatives' && path.endsWith('/presentation-v2.webp')) {
                  paused = true; await pause(message.stage);
                }
                return result;
              };
              const value = Reflect.get(targetFile, method);
              return typeof value === 'function' ? value.bind(targetFile) : value;
            } });
          };
        } });
      },
    };
    const result = await processPrivateDraftUpload({ firestore, storage: wrappedStorage, object: message.object, now: () => message.now });
    await firestore.terminate();
    await deleteApp(app);
    process.send({ type: 'done', result }, () => process.exit(0));
  } catch (error) {
    process.send({ type: 'failed', error: { message: error.message, code: error.code, stack: error.stack } }, () => process.exit(1));
  }
});
