/**
 * Captures de recette de l'accueil et des pages éditoriales publiques.
 *
 * Le script sert uniquement le build local, bloque la résolution DNS hors 127.0.0.1,
 * pilote Chrome par CDP et écrit deux familles de preuves :
 *   - captures pleine page aux quatre largeurs demandées dans docs/audits/…/screenshots ;
 *   - captures produit versionnées issues des vraies surfaces locales dans public/assets/… .
 *
 * Les surfaces authentifiées ne reçoivent aucun substitut. Si le parcours officiel du
 * compte démo ne peut pas ouvrir le Registre ou sa Collection, le manifeste les marque
 * explicitement en échec et le script termine avec un code non nul.
 *
 * Usage reproductible, avec le Registre et la Collection démo authentifiés localement :
 *   FIREBASE_CLI_DISABLE_UPDATE_CHECK=true firebase emulators:exec --config firebase.demo-test.json \
 *     --project cartularia-demo-test --only auth,firestore \
 *     "npm run schema:check && npm run seed:foundations && npm run seed:demo-account && \
 *      VITE_USE_FIREBASE_EMULATORS=true VITE_FIREBASE_PROJECT_ID=cartularia-demo-test \
 *      VITE_FIREBASE_EMULATOR_HOST=127.0.0.1 VITE_FIREBASE_AUTH_EMULATOR_PORT=19099 \
 *      VITE_FIREBASE_FIRESTORE_EMULATOR_PORT=18087 npm run build && node scripts/capture-home-corrections.mjs"
 *
 * Un simple build sans émulateurs reste possible pour diagnostiquer les pages anonymes,
 * mais le script échoue volontairement si les captures authentifiées ne sont pas obtenues.
 *
 * Options :
 *   --serve <dossier>       build à servir (défaut : dist)
 *   --out <dossier>         dossier d'audit (défaut : docs/audits/2026-09-17-corrections-accueil)
 *   --assets-out <dossier>  captures produit (défaut : public/assets/public/captures)
 *   --version <AAAAMMJJ>    version consignée dans le manifeste (défaut : 20260917)
 *   --chrome <chemin>       exécutable Chrome (sinon CARTULARIA_CHROME, puis Chrome macOS)
 */
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  DEMO_SUBMARINER_CARTULARY_ID,
  DEMO_SUBMARINER_PUBLIC_CODE,
  DEMO_WEBSITE_BLOCK_IDS,
} from '../src/data/demoCartularies.ts';

const argumentsList = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argumentsList.indexOf(name);
  return index >= 0 && argumentsList[index + 1] ? argumentsList[index + 1] : fallback;
};

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDirectory = resolve(rootDirectory, option('--serve', 'dist'));
const auditDirectory = resolve(rootDirectory, option('--out', 'docs/audits/2026-09-17-corrections-accueil'));
const screenshotsDirectory = join(auditDirectory, 'screenshots');
const assetsDirectory = resolve(rootDirectory, option('--assets-out', 'public/assets/public/captures'));
const captureVersion = option('--version', '20260917');
const chromePath = option(
  '--chrome',
  process.env.CARTULARIA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
);
const manifestPath = join(auditDirectory, 'capture-report.json');

const DEMO_CARTULARY = `/cartulary-demo?cartularyId=${encodeURIComponent(DEMO_SUBMARINER_CARTULARY_ID)}`;
const DEMO_WEBSITE_PREVIEW = `/watch-website?${new URLSearchParams({
  publicCode: DEMO_SUBMARINER_PUBLIC_CODE,
  preview: 'local',
  cartularyId: DEMO_SUBMARINER_CARTULARY_ID,
  blocks: DEMO_WEBSITE_BLOCK_IDS.join(','),
}).toString()}`;
const DEMO_REGISTRY_ID = 'reg_cartularia_demo';
const PRODUCT_VIEWPORT = { name: 'desktop-1440', width: 1440, height: 900, mobile: false };
const MAX_FULL_PAGE_HEIGHT = 30_000;

const PUBLIC_SCENES = [
  { name: 'accueil', path: '/' },
  { name: 'objets', path: '/objets' },
  { name: 'aide-documentaire', path: '/aide-documentaire' },
  { name: 'conseils-photo-video', path: '/conseils-photo-video' },
  { name: 'confidentialite', path: '/confidentialite', viewportOnly: true },
  { name: 'livrable-cartulaire', path: '/livrables/cartulaire' },
  { name: 'livrable-registre', path: '/livrables/registre' },
  { name: 'livrable-collection', path: '/livrables/collection' },
  { name: 'livrable-mini-site', path: '/livrables/mini-site' },
  { name: 'livrable-rapport-pdf', path: '/livrables/rapport-pdf' },
  { name: 'livrable-sceau-integrite', path: '/livrables/sceau-integrite' },
  { name: 'livrable-cercle', path: '/livrables/cercle' },
  { name: 'livrable-todo-list', path: '/livrables/todo-list' },
];

const VIEWPORTS = [
  { name: 'mobile-390', width: 390, height: 844, mobile: true },
  { name: 'tablet-768', width: 768, height: 1024, mobile: false },
  { name: 'desktop-1440', width: 1440, height: 900, mobile: false },
  { name: 'wide-1728', width: 1728, height: 1080, mobile: false },
];

const PRODUCT_SCENES = [
  {
    name: 'cartulaire-cover',
    path: `${DEMO_CARTULARY}#cover`,
    fileName: 'cartulaire-accueil.webp',
    selector: '.app-shell .page-tabs [aria-current="page"]',
    expectedActivePage: 'Accueil',
  },
  {
    name: 'cartulaire-publication',
    path: `${DEMO_CARTULARY}#publication`,
    fileName: 'cartulaire-publication.webp',
    selector: '.app-shell .page-tabs [aria-current="page"]',
    expectedActivePage: 'Publication',
  },
  {
    name: 'mini-site-demo',
    path: DEMO_WEBSITE_PREVIEW,
    fileName: 'mini-site-demo.webp',
    selector: '.watch-website__main h1',
    expectedH1: 'Accueil',
  },
  {
    name: 'sceau-integrite',
    path: `${DEMO_CARTULARY}&view=proofs#cover`,
    fileName: 'sceau-integrite.webp',
    selector: '.drawer-panel.active .audit-panel--read-only',
    expectedActivePage: 'Accueil',
  },
];

const MIME_TYPES = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webm': 'video/webm',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
};

const sleep = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    socket.onmessage = (event) => this.receive(JSON.parse(event.data));
    socket.onerror = () => this.rejectPending(new Error('Connexion CDP interrompue.'));
    socket.onclose = () => this.rejectPending(new Error('Connexion CDP fermée.'));
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((open, fail) => {
      socket.onopen = open;
      socket.onerror = fail;
    });
    return new Cdp(socket);
  }

  receive(message) {
    const call = this.pending.get(message.id);
    if (!call) return;
    this.pending.delete(message.id);
    if (message.error) call.reject(new Error(message.error.message));
    else call.resolve(message.result);
  }

  rejectPending(error) {
    for (const call of this.pending.values()) call.reject(error);
    this.pending.clear();
  }

  send(method, parameters = {}, sessionId) {
    const id = ++this.nextId;
    return new Promise((resolveCall, rejectCall) => {
      this.pending.set(id, { resolve: resolveCall, reject: rejectCall });
      try {
        this.socket.send(JSON.stringify({ id, method, params: parameters, sessionId }));
      } catch (error) {
        this.pending.delete(id);
        rejectCall(error);
      }
    });
  }

  close() {
    try { this.socket.close(); } catch { /* fermeture déjà engagée */ }
  }
}

const pageMetricsExpression = `(() => ({
  clientWidth: document.documentElement.clientWidth,
  scrollWidth: document.documentElement.scrollWidth,
  scrollHeight: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0),
  title: document.title,
  h1: Array.from(document.querySelectorAll('h1')).map((heading) => heading.textContent.replace(/\\s+/g, ' ').trim()).filter(Boolean),
  pathname: window.location.pathname,
  search: window.location.search,
  hash: window.location.hash,
}))()`;

function safeStaticPath(pathname) {
  const candidate = resolve(distDirectory, `.${pathname}`);
  const rel = relative(distDirectory, candidate);
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\\\' : '/'}`)) return null;
  return candidate;
}

function startStaticServer() {
  const server = createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const candidate = safeStaticPath(pathname);
      const file = candidate && existsSync(candidate) && statSync(candidate).isFile()
        ? candidate
        : join(distDirectory, 'index.html');
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': MIME_TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
        'x-content-type-options': 'nosniff',
      });
      response.end(readFileSync(file));
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(error instanceof Error ? error.message : 'Erreur de lecture.');
    }
  });
  return new Promise((resolveServer, rejectServer) => {
    server.once('error', rejectServer);
    server.listen(0, '127.0.0.1', () => resolveServer(server));
  });
}

async function waitForDevtoolsPort(profileDirectory, chrome, launchState) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (launchState.error) throw new Error(`Chrome n’a pas pu démarrer : ${launchState.error.message}`);
    if (chrome.exitCode !== null || chrome.signalCode !== null) {
      const diagnostic = launchState.stderr.trim();
      throw new Error(`Chrome s’est arrêté avant d’ouvrir DevTools (code ${chrome.exitCode ?? '—'}, signal ${chrome.signalCode ?? '—'}).${diagnostic ? `\n${diagnostic}` : ''}`);
    }
    try {
      const value = readFileSync(join(profileDirectory, 'DevToolsActivePort'), 'utf8').split('\n')[0];
      const port = Number(value);
      if (port > 0) return port;
    } catch { /* Chrome initialise encore le profil. */ }
    await sleep(200);
  }
  throw new Error("Chrome n'a pas ouvert son port DevTools dans le délai imparti.");
}

async function createPageSession(browser, viewport) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, parameters = {}) => browser.send(method, parameters, sessionId);
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description || exceptionDetails.text || 'Évaluation JavaScript impossible.');
    }
    return result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  });
  await send('Emulation.setScrollbarsHidden', { hidden: true });
  if (viewport.mobile) {
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }

  return {
    evaluate,
    send,
    sessionId,
    targetId,
    close: () => browser.send('Target.closeTarget', { targetId }),
  };
}

async function navigateAndWait(page, url, options = {}) {
  const {
    expectedActivePage,
    readySelector = 'main h1',
    timeout = 25_000,
  } = options;
  await page.send('Page.navigate', { url });
  const startedAt = Date.now();
  let state = null;
  while (Date.now() - startedAt < timeout) {
    state = await page.evaluate(`(() => {
      const headings = Array.from(document.querySelectorAll('h1')).map((heading) => heading.textContent.replace(/\\s+/g, ' ').trim()).filter(Boolean);
      const activePage = document.querySelector('.page-tabs [aria-current="page"]')?.textContent.replace(/\\s+/g, ' ').trim() || '';
      return {
        complete: document.readyState === 'complete',
        ready: Boolean(document.querySelector(${JSON.stringify(readySelector)})),
        headings,
        activePage,
        pathname: window.location.pathname,
      };
    })()`);
    const notFound = state.headings.some((heading) => heading === "Cette page n'existe pas" || heading === 'Cette page n’existe pas');
    if (notFound) throw new Error(`Route non reconnue par le build : ${new URL(url).pathname}`);
    const activePageReady = !expectedActivePage || state.activePage.includes(expectedActivePage);
    if (state.complete && state.ready && state.headings.length > 0 && activePageReady) break;
    await sleep(250);
  }
  if (!state?.complete || !state?.ready || state.headings.length === 0) {
    throw new Error(`Page non rendue après ${Math.round(timeout / 1000)} s : ${new URL(url).pathname}`);
  }
  if (expectedActivePage && !state.activePage.includes(expectedActivePage)) {
    throw new Error(`Onglet actif inattendu : « ${state.activePage || 'absent'} » au lieu de « ${expectedActivePage} ».`);
  }

  await page.evaluate(`(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    const step = Math.max(320, Math.floor(window.innerHeight * 0.75));
    const height = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0);
    for (let top = 0; top < height; top += step) {
      window.scrollTo(0, top);
      await new Promise((done) => setTimeout(done, 35));
    }
    window.scrollTo(0, 0);
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const localImages = Array.from(document.images).filter((image) => image.currentSrc.startsWith(window.location.origin) || image.src.startsWith(window.location.origin));
    await Promise.all(localImages.map((image) => image.complete ? undefined : new Promise((done) => {
      image.addEventListener('load', done, { once: true });
      image.addEventListener('error', done, { once: true });
      setTimeout(done, 3000);
    })));
  })()`);
  await sleep(250);
  return page.evaluate(pageMetricsExpression);
}

async function writeWebpScreenshot(page, filePath, clip, quality = 82) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  let bytes;
  try {
    const { data } = await page.send('Page.captureScreenshot', {
      captureBeyondViewport: true,
      clip,
      format: 'webp',
      fromSurface: true,
      optimizeForSpeed: false,
      quality,
    });
    bytes = Buffer.from(data, 'base64');
  } catch (webpError) {
    const { data } = await page.send('Page.captureScreenshot', {
      captureBeyondViewport: true,
      clip,
      format: 'png',
      fromSurface: true,
      optimizeForSpeed: false,
    });
    try {
      bytes = await sharp(Buffer.from(data, 'base64')).webp({ quality }).toBuffer();
    } catch (conversionError) {
      throw new Error(`Capture WebP refusée (${webpError.message}) et conversion PNG impossible (${conversionError.message}).`);
    }
  }
  try {
    writeFileSync(temporaryPath, bytes);
    renameSync(temporaryPath, filePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  return { bytes: bytes.length };
}

async function captureFullPage(browser, baseUrl, scene, viewport) {
  const page = await createPageSession(browser, viewport);
  const filePath = join(screenshotsDirectory, `${scene.name}-${viewport.width}.webp`);
  try {
    const metrics = await navigateAndWait(page, baseUrl + scene.path);
    if (!scene.viewportOnly && metrics.scrollHeight > MAX_FULL_PAGE_HEIGHT) {
      throw new Error(`Page trop haute pour une capture fiable : ${metrics.scrollHeight}px (maximum ${MAX_FULL_PAGE_HEIGHT}px).`);
    }
    const capture = await writeWebpScreenshot(page, filePath, {
      x: 0,
      y: 0,
      width: viewport.width,
      height: scene.viewportOnly ? viewport.height : Math.max(viewport.height, metrics.scrollHeight),
      scale: 1,
    });
    return {
      file: relative(rootDirectory, filePath),
      metrics,
      path: scene.path,
      scene: scene.name,
      status: 'captured',
      viewport,
      ...capture,
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function captureProductSurface(browser, baseUrl, scene, mutate) {
  const page = await createPageSession(browser, PRODUCT_VIEWPORT);
  const filePath = join(assetsDirectory, scene.fileName);
  try {
    let metrics = await navigateAndWait(page, baseUrl + scene.path, {
      expectedActivePage: scene.expectedActivePage,
      readySelector: scene.selector || 'main h1',
    });
    if (mutate) {
      await mutate(page);
      await sleep(350);
      metrics = await page.evaluate(pageMetricsExpression);
    }
    if (scene.expectedH1 && !metrics.h1.some((heading) => heading.includes(scene.expectedH1))) {
      throw new Error(`Surface inattendue : h1 « ${scene.expectedH1} » absent (${metrics.h1.join(' | ') || 'aucun h1'}).`);
    }
    await page.evaluate('window.scrollTo(0, 0)');
    const capture = await writeWebpScreenshot(page, filePath, {
      x: 0,
      y: 0,
      width: PRODUCT_VIEWPORT.width,
      height: PRODUCT_VIEWPORT.height,
      scale: 1,
    }, 88);
    return {
      file: relative(rootDirectory, filePath),
      metrics,
      path: scene.path,
      scene: scene.name,
      status: 'captured',
      viewport: PRODUCT_VIEWPORT,
      ...capture,
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function captureAuthenticatedDemoSurfaces(browser, baseUrl) {
  const results = [];
  const page = await createPageSession(browser, PRODUCT_VIEWPORT);
  const registryPath = join(assetsDirectory, 'registre-demo.webp');
  const collectionPath = join(assetsDirectory, 'collection-demo.webp');
  const failBoth = (message) => [
    {
      error: message,
      file: relative(rootDirectory, registryPath),
      path: '/account/sign-in?demo=1 → Registre démo',
      scene: 'registre-demo',
      status: 'failed',
      viewport: PRODUCT_VIEWPORT,
    },
    {
      error: `Collection non capturée : ${message}`,
      file: relative(rootDirectory, collectionPath),
      path: '/account/sign-in?demo=1 → Registre démo → Collections',
      scene: 'collection-demo',
      status: 'failed',
      viewport: PRODUCT_VIEWPORT,
    },
  ];

  try {
    await navigateAndWait(page, `${baseUrl}/account/sign-in?demo=1`, { readySelector: '.account-demo-access button' });
    const clicked = await page.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('.account-demo-access button')).find((candidate) => candidate.textContent.includes('Ouvrir le Registre démo'));
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!clicked) return failBoth('Bouton officiel « Ouvrir le Registre démo » introuvable.');

    const startedAt = Date.now();
    let loginState = null;
    while (Date.now() - startedAt < 35_000) {
      loginState = await page.evaluate(`(() => ({
        error: document.querySelector('.account-demo-access [role="alert"]')?.textContent.trim() || '',
        registryReady: Boolean(document.querySelector('.registry-app .registry-main h1')),
        pathname: window.location.pathname,
      }))()`);
      if (loginState.error) return failBoth(`Connexion démo refusée : ${loginState.error}`);
      if (loginState.registryReady && loginState.pathname.startsWith('/registry/')) break;
      await sleep(250);
    }
    if (!loginState?.registryReady) {
      return failBoth('Le parcours officiel de connexion démo n’a pas atteint le Registre dans le délai imparti. Vérifier le build émulateur, les données seedées et les services locaux.');
    }

    await page.evaluate('(async () => { if (document.fonts?.ready) await document.fonts.ready; window.scrollTo(0, 0); })()');
    await sleep(350);
    const registryMetrics = await page.evaluate(pageMetricsExpression);
    const registryCapture = await writeWebpScreenshot(page, registryPath, {
      x: 0,
      y: 0,
      width: PRODUCT_VIEWPORT.width,
      height: PRODUCT_VIEWPORT.height,
      scale: 1,
    }, 88);
    results.push({
      ...registryCapture,
      file: relative(rootDirectory, registryPath),
      metrics: registryMetrics,
      path: windowPath(loginState),
      scene: 'registre-demo',
      status: 'captured',
      viewport: PRODUCT_VIEWPORT,
    });

    const collectionRoute = `/registry/${encodeURIComponent(DEMO_REGISTRY_ID)}/collections`;
    const collectionMetrics = await navigateAndWait(page, baseUrl + collectionRoute, {
      readySelector: '.registry-collections h1',
      timeout: 25_000,
    });
    const collectionHeading = collectionMetrics.h1.join(' ');
    if (!collectionHeading.includes('Collections')) {
      throw new Error(`La surface Collections n’est pas rendue (h1 : ${collectionHeading || 'absent'}).`);
    }
    await page.evaluate('window.scrollTo(0, 0)');
    const collectionCapture = await writeWebpScreenshot(page, collectionPath, {
      x: 0,
      y: 0,
      width: PRODUCT_VIEWPORT.width,
      height: PRODUCT_VIEWPORT.height,
      scale: 1,
    }, 88);
    results.push({
      ...collectionCapture,
      file: relative(rootDirectory, collectionPath),
      metrics: collectionMetrics,
      path: collectionRoute,
      scene: 'collection-demo',
      status: 'captured',
      viewport: PRODUCT_VIEWPORT,
    });
    return results;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const capturedScenes = new Set(results.map((entry) => entry.scene));
    if (!capturedScenes.has('registre-demo')) {
      results.push(failBoth(message)[0]);
    }
    if (!capturedScenes.has('collection-demo')) {
      results.push({
        error: `Collection non capturée : ${message}`,
        file: relative(rootDirectory, collectionPath),
        path: '/account/sign-in?demo=1 → Registre démo → Collections',
        scene: 'collection-demo',
        status: 'failed',
        viewport: PRODUCT_VIEWPORT,
      });
    }
    return results;
  } finally {
    await page.close().catch(() => undefined);
  }
}

const windowPath = (state) => state?.pathname || `/registry/${DEMO_REGISTRY_ID}/items`;

function errorEntry(error, base) {
  return {
    ...base,
    error: error instanceof Error ? error.message : String(error),
    status: 'failed',
  };
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((done) => server.close(() => done()));
}

async function stopChrome(chrome) {
  if (!chrome || chrome.exitCode !== null || chrome.signalCode !== null) return;
  chrome.kill('SIGTERM');
  await Promise.race([
    new Promise((done) => chrome.once('exit', done)),
    sleep(2_000),
  ]);
  if (chrome.exitCode === null && chrome.signalCode === null) {
    chrome.kill('SIGKILL');
    await Promise.race([
      new Promise((done) => chrome.once('exit', done)),
      sleep(2_000),
    ]);
  }
}

async function main() {
  if (!existsSync(join(distDirectory, 'index.html'))) {
    throw new Error(`Build absent : ${join(distDirectory, 'index.html')}. Lancer npm run build avant les captures.`);
  }
  if (!existsSync(chromePath)) {
    throw new Error(`Chrome introuvable : ${chromePath}. Utiliser --chrome ou CARTULARIA_CHROME.`);
  }
  if (!/^\d{8}$/.test(captureVersion)) {
    throw new Error(`Version de capture invalide : ${captureVersion}. Format attendu : AAAAMMJJ.`);
  }

  mkdirSync(screenshotsDirectory, { recursive: true });
  mkdirSync(assetsDirectory, { recursive: true });
  const profileDirectory = mkdtempSync(join(tmpdir(), 'cartularia-home-captures-'));
  let server;
  let chrome;
  let browser;
  let fatalError = null;
  let cleanupPromise;
  const cleanup = () => {
    cleanupPromise ??= (async () => {
      if (browser) {
        await browser.send('Browser.close').catch(() => undefined);
        browser.close();
      }
      await stopChrome(chrome);
      await closeServer(server);
      rmSync(profileDirectory, { recursive: true, force: true });
    })();
    return cleanupPromise;
  };
  const onSignal = (signal) => {
    void cleanup().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  const report = {
    captureVersion,
    chrome: chromePath,
    dist: relative(rootDirectory, distDirectory),
    generatedAt: new Date().toISOString(),
    productAssets: [],
    publicScenes: [],
    screenshotsDirectory: relative(rootDirectory, screenshotsDirectory),
    network: 'bloqué hors 127.0.0.1',
  };

  try {
    server = await startStaticServer();
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Port local du serveur indisponible.');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const launchState = { error: null, stderr: '' };
    chrome = spawn(chromePath, [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profileDirectory}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-component-update',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
      'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    chrome.once('error', (error) => { launchState.error = error; });
    chrome.stderr?.setEncoding('utf8');
    chrome.stderr?.on('data', (chunk) => {
      launchState.stderr = `${launchState.stderr}${chunk}`.slice(-4_000);
    });
    const port = await waitForDevtoolsPort(profileDirectory, chrome, launchState);
    const versionResponse = await fetch(`http://127.0.0.1:${port}/json/version`);
    const { webSocketDebuggerUrl } = await versionResponse.json();
    browser = await Cdp.connect(webSocketDebuggerUrl);

    for (const viewport of VIEWPORTS) {
      for (const scene of PUBLIC_SCENES) {
        try {
          const result = await captureFullPage(browser, baseUrl, scene, viewport);
          report.publicScenes.push(result);
          console.log(`CAPTURED ${scene.path} ${viewport.width}px -> ${result.file}`);
        } catch (error) {
          const entry = errorEntry(error, {
            file: relative(rootDirectory, join(screenshotsDirectory, `${scene.name}-${viewport.width}.webp`)),
            path: scene.path,
            scene: scene.name,
            viewport,
          });
          report.publicScenes.push(entry);
          console.error(`FAILED ${scene.path} ${viewport.width}px: ${entry.error}`);
        }
      }
    }

    for (const scene of PRODUCT_SCENES) {
      try {
        const result = await captureProductSurface(browser, baseUrl, scene);
        report.productAssets.push(result);
        console.log(`CAPTURED ${scene.name} -> ${result.file}`);
      } catch (error) {
        const entry = errorEntry(error, {
          file: relative(rootDirectory, join(assetsDirectory, scene.fileName)),
          path: scene.path,
          scene: scene.name,
          viewport: PRODUCT_VIEWPORT,
        });
        report.productAssets.push(entry);
        console.error(`FAILED ${scene.name}: ${entry.error}`);
      }
    }

    const todoScene = {
      name: 'cartulaire-todo',
      path: `${DEMO_CARTULARY}#cover`,
      fileName: 'todo-demo.webp',
      selector: '.app-shell .todo-trigger',
      expectedActivePage: 'Accueil',
    };
    try {
      const result = await captureProductSurface(browser, baseUrl, todoScene, async (page) => {
        const opened = await page.evaluate(`(async () => {
          const trigger = document.querySelector('.todo-trigger');
          if (!trigger) return false;
          trigger.click();
          for (let attempt = 0; attempt < 20; attempt += 1) {
            if (document.querySelector('#cartularia-todo-panel')) return true;
            await new Promise((done) => setTimeout(done, 100));
          }
          return false;
        })()`);
        if (!opened) throw new Error('Le panneau réel « À Faire » ne s’est pas ouvert.');
      });
      report.productAssets.push(result);
      console.log(`CAPTURED ${todoScene.name} -> ${result.file}`);
    } catch (error) {
      const entry = errorEntry(error, {
        file: relative(rootDirectory, join(assetsDirectory, todoScene.fileName)),
        path: todoScene.path,
        scene: todoScene.name,
        viewport: PRODUCT_VIEWPORT,
      });
      report.productAssets.push(entry);
      console.error(`FAILED ${todoScene.name}: ${entry.error}`);
    }

    const circleScene = {
      name: 'cercle-acces',
      path: '/community',
      fileName: 'cercle-acces.webp',
      selector: '.community-state h1',
      expectedH1: 'Cercle',
    };
    try {
      const result = await captureProductSurface(browser, baseUrl, circleScene);
      report.productAssets.push(result);
      console.log(`CAPTURED ${circleScene.name} -> ${result.file}`);
    } catch (error) {
      const entry = errorEntry(error, {
        file: relative(rootDirectory, join(assetsDirectory, circleScene.fileName)),
        path: circleScene.path,
        scene: circleScene.name,
        viewport: PRODUCT_VIEWPORT,
      });
      report.productAssets.push(entry);
      console.error(`FAILED ${circleScene.name}: ${entry.error}`);
    }

    const authenticatedResults = await captureAuthenticatedDemoSurfaces(browser, baseUrl);
    report.productAssets.push(...authenticatedResults);
    for (const result of authenticatedResults) {
      const message = `${result.status === 'captured' ? 'CAPTURED' : 'FAILED'} ${result.scene}`;
      if (result.status === 'captured') console.log(`${message} -> ${result.file}`);
      else console.error(`${message}: ${result.error}`);
    }
  } catch (error) {
    fatalError = error instanceof Error ? error.message : String(error);
    report.fatalError = fatalError;
    throw error;
  } finally {
    const failures = [...report.publicScenes, ...report.productAssets].filter((entry) => entry.status !== 'captured');
    report.summary = {
      captured: report.publicScenes.length + report.productAssets.length - failures.length,
      failed: failures.length + (fatalError ? 1 : 0),
      productAssets: report.productAssets.length,
      publicScenes: report.publicScenes.length,
    };
    mkdirSync(auditDirectory, { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify(report, null, 2)}\n`);
    await cleanup();
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    if (failures.length > 0 || fatalError) process.exitCode = 1;
    console.log(`REPORT ${relative(rootDirectory, manifestPath)} (${report.summary.captured} captures, ${report.summary.failed} échec(s))`);
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 2;
});
