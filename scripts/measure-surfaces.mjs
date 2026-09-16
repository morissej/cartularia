// V7 (V-B2) — mesure reproductible des scripts chargés par surface sur le build (dist/), rattachée à verify:v7 par --check.
// Même socle que scripts/audit-accessibility.mjs : sert dist/ avec node:http (repli index.html comme la réécriture Hosting, en-têtes
// de cache de firebase.json), pilote le Chrome installé par le protocole DevTools (WebSocket natif de Node ≥ 22, aucune dépendance),
// réseau coupé hors 127.0.0.1 (aucun appel Firebase : Firestore, Auth et App Check échouent en DNS) — avec --fonts, Google Fonts est
// toléré tant que V-B5 (polices hébergées avec le site, commit C4) n'est pas livrée.
// À froid (cache désactivé et vidé), pour chaque surface × fenêtre : requêtes par type, octets transférés, morceaux JS (initiaux = demandés
// avant le premier rendu utile), morceaux « icône seule » (signature : unique import statique ./createLucideIcon-*), modulepreload et
// preload du document, polices résolues, DOMContentLoaded / load / LCP (observe({ type, buffered })). À chaud (un onglet, cache actif) :
// accueil → connexion (inactivité 3,5 s, le temps d'un éventuel préchargement) → /registry/reg_cartularia_demo/items, avec pour chaque
// étape les requêtes servies par le cache et ce que le réseau coûte encore.
// Usage : node scripts/measure-surfaces.mjs --serve dist [--out docs/audits/perf] [--check] [--fonts] [--chrome <chemin>]
// Sorties : <out>/<date>.json (relevé complet) et <out>/<date>.md (résumé), sans port ni heure (seuls les temps mesurés varient d'une
// exécution à l'autre). Codes : 0 sans dépassement, 1 seuil dépassé (--check), 2 non exécuté.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const distDir = resolve(option('--serve', 'dist'));
const outDir = resolve(option('--out', 'docs/audits/perf'));
const check = args.includes('--check');
const allowFonts = args.includes('--fonts');
const chromePath = option('--chrome', process.env.CARTULARIA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
if (!existsSync(chromePath)) { console.error(`Mesure non exécutée : Chrome introuvable (${chromePath}). Définir CARTULARIA_CHROME.`); process.exit(2); }
if (!existsSync(join(distDir, 'index.html'))) { console.error(`Mesure non exécutée : build absent (${distDir}/index.html). Lancer npm run build.`); process.exit(2); }
mkdirSync(outDir, { recursive: true });

const DEMO = '/cartulary-demo?cartularyId=cart_demo_rolex_submariner_124060';
const REGISTRY_ITEMS = '/registry/reg_cartularia_demo/items';
const surfaces = [
  { name: 'accueil', path: '/' },
  { name: 'connexion', path: '/account/sign-in' },
  { name: 'demo-cover', path: `${DEMO}#cover` },
  { name: 'registre', path: '/registry' },
];
const viewports = [
  { name: 'desktop-1440', width: 1440, height: 900, mobile: false, scale: 1 },
  { name: 'mobile-390', width: 390, height: 844, mobile: true, scale: 3 },
];
// Seuils de --check (comptes et octets seulement, jamais de durée : les temps locaux sont du bruit). Fixés au commit de fusion C5 (K9) depuis le
// relevé du build fusionné C1-C3 du 16 septembre 2026 (docs/audits/perf/2026-09-16.json : deux groupes react/icons, préchargement du Registre,
// Google Fonts encore ; mesuré, identique à 1 440 et 390 : accueil 20 requêtes / 8 JS, connexion 12 JS initiaux, démo 29 JS, Registre 17 JS),
// marge +2 requêtes / +1 morceau JS : tout morceau ajouté à une surface se voit et se décide ici. Le seuil du parcours à chaud (étape Registre :
// 0 JS réseau, ≤ 3 requêtes) vient du commit C2 (préchargement à l'inactivité depuis la page de connexion, D10 : mesuré 3 requêtes réseau —
// index.html, logo, manifeste, tous no-cache — et 0 JS) ; « 0 requête tierce » sera activé par le commit C4 (polices locales, −4 requêtes Google
// +3 .woff2 même origine sur l'accueil : le seuil de 22 requêtes tient).
const LIMITS = {
  accueil: { requêtes: 22, js: 9 },
  connexion: { jsInitiaux: 13 },
  'demo-cover': { js: 30 },
  registre: { js: 18 },
  'registre-items': { jsRéseau: 0, réseau: 3 },
};

// Anatomie statique de dist/assets : gzip et signature des morceaux d'icônes (unique import statique, vers ./createLucideIcon-*).
const NUMBERED_COPY = / \d+\.[^/]+$/;
const assetsDir = join(distDir, 'assets');
const anatomy = new Map();
for (const file of readdirSync(assetsDir)) {
  if (!/\.(js|css)$/.test(file) || NUMBERED_COPY.test(file)) continue;
  const buffer = readFileSync(join(assetsDir, file));
  const source = buffer.toString('utf8');
  const staticImports = [...source.matchAll(/import\s*(?:[^'"]*?from\s*)?["']\.\/([^"']+)["']/g)].map((match) => match[1]);
  const iconOnly = staticImports.length === 1 && /^createLucideIcon-/.test(staticImports[0]) && !/import\(/.test(source);
  anatomy.set(file, { raw: buffer.length, gzip: gzipSync(buffer, { level: 9 }).length, iconOnly });
}

// Serveur statique : fichiers de dist/, repli index.html pour les routes (réécriture Hosting « ** → /index.html »), sans compression ;
// en-têtes de cache de firebase.json (immuable sous /assets/, no-cache ailleurs) pour que le parcours à chaud ressemble à la production.
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json', '.pdf': 'application/pdf' };
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const candidate = resolve(distDir, `.${pathname}`);
  const file = candidate.startsWith(distDir) && existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(distDir, 'index.html');
  const immutable = pathname.startsWith('/assets/') && file === candidate;
  response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache, no-store, must-revalidate' });
  response.end(readFileSync(file));
});
await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
const base = `http://127.0.0.1:${server.address().port}`; // port éphémère : jamais écrit dans le relevé

// Chrome headless : port DevTools éphémère lu dans DevToolsActivePort ; toute résolution DNS échoue sauf 127.0.0.1 (et Google Fonts avec --fonts).
const resolverRules = ['MAP * ~NOTFOUND', 'EXCLUDE 127.0.0.1', ...(allowFonts ? ['EXCLUDE fonts.googleapis.com', 'EXCLUDE fonts.gstatic.com'] : [])].join(', ');
const profile = mkdtempSync(join(tmpdir(), 'cartularia-surfaces-'));
const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--disable-component-update', `--host-resolver-rules=${resolverRules}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function devtoolsPort() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { const port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); if (port > 0) return port; } catch { /* pas encore écrit */ }
    await sleep(250);
  }
  throw new Error('Chrome n’a pas ouvert son port DevTools.');
}
class Cdp {
  constructor(socket) { this.socket = socket; this.id = 0; this.pending = new Map(); this.listeners = new Map(); socket.onmessage = (event) => this.receive(JSON.parse(event.data)); }
  static async connect(url) { const socket = new WebSocket(url); await new Promise((open, fail) => { socket.onopen = open; socket.onerror = fail; }); return new Cdp(socket); }
  receive(message) {
    if (message.id) { const call = this.pending.get(message.id); if (!call) return; this.pending.delete(message.id); if (message.error) call.reject(new Error(message.error.message)); else call.resolve(message.result); return; }
    const handler = this.listeners.get(`${message.sessionId ?? ''}:${message.method}`); if (handler) handler(message.params);
  }
  send(method, params = {}, sessionId) { const id = ++this.id; this.socket.send(JSON.stringify({ id, method, params, sessionId })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  on(sessionId, method, handler) { this.listeners.set(`${sessionId}:${method}`, handler); }
}

const kindOf = (type, url, mime) => {
  if (type === 'Script' || /\.js(\?|$)/.test(url)) return 'js';
  if (type === 'Stylesheet' || /\.css(\?|$)/.test(url) || /fonts\.googleapis\.com\/css/.test(url)) return 'css';
  if (type === 'Font' || /\.(woff2?|ttf|otf)(\?|$)/.test(url) || /fonts\.gstatic\.com/.test(url)) return 'font';
  if (type === 'Image' || /^image\//.test(mime ?? '')) return 'image';
  if (type === 'Document') return 'html';
  return 'autre';
};
const isLocal = (url) => new URL(url).hostname === '127.0.0.1';
const fileOf = (url) => new URL(url).pathname.split('/').pop();
const shortName = (file) => file.replace(/-[A-Za-z0-9_-]{8}\.(js|css)$/, '.$1');
// Premier rendu utile : onglets d'un Cartulaire, coquille ou formulaire du Registre, ou page publique (main hors coquille applicative).
const READY = `!!document.querySelector('.page-tabs') || !!document.querySelector('.registry-app, .registry-shell, [class*="registry"] form, .registry-sign-in') || (!!document.querySelector('main') && !document.querySelector('.application-shell'))`;
const METRICS = `(() => new Promise((done) => {
  const nav = performance.getEntriesByType('navigation')[0];
  let lcp = null;
  // Les liens injectés par Vite portent l'origine du serveur local (port éphémère) : ramenés au chemin pour un relevé sans port (F4 de l'audit axe).
  const local = (href) => (href && href.startsWith(location.origin) ? href.slice(location.origin.length) : href);
  const finish = () => done({
    domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
    load: nav ? Math.round(nav.loadEventEnd) : null,
    lcp,
    title: document.title,
    modulepreload: Array.from(document.querySelectorAll('link[rel="modulepreload"]')).map((l) => local(l.getAttribute('href'))),
    preload: Array.from(document.querySelectorAll('link[rel="preload"],link[rel="prefetch"]')).map((l) => l.rel + ' ' + local(l.getAttribute('href'))),
    stylesheets: Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((l) => local(l.getAttribute('href'))),
    fontFaces: Array.from(document.fonts).map((f) => f.family + ' ' + f.weight + ' ' + f.status),
  });
  try {
    if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('largest-contentful-paint')) {
      const observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) lcp = Math.round(entry.startTime); });
      observer.observe({ type: 'largest-contentful-paint', buffered: true });
      setTimeout(() => { observer.disconnect(); finish(); }, 300);
    } else finish();
  } catch { finish(); }
}))()`;

const day = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10); // date locale : un relevé par jour
const report = { date: day, chrome: chromePath, fonts: allowFonts ? 'Google Fonts tolérées (--fonts)' : 'réseau coupé hors 127.0.0.1', cache: 'désactivé et vidé avant chaque surface', results: [], sequence: [] };

// Une page pilotée par CDP : requêtes observées (avec cache et échecs), rendu prêt, réseau au repos.
const openPage = async (browser, { cacheDisabled, viewport }) => {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => browser.send(method, params, sessionId);
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  const page = { requests: new Map(), lastActivity: Date.now(), navigatedAt: Date.now() };
  browser.on(sessionId, 'Network.requestWillBeSent', ({ requestId, request, type }) => { page.requests.set(requestId, { url: request.url, type, status: null, mime: null, bytes: 0, cached: false, failed: false, at: Date.now() - page.navigatedAt }); page.lastActivity = Date.now(); });
  browser.on(sessionId, 'Network.requestServedFromCache', ({ requestId }) => { const entry = page.requests.get(requestId); if (entry) entry.cached = true; });
  browser.on(sessionId, 'Network.responseReceived', ({ requestId, response, type }) => { const entry = page.requests.get(requestId); if (entry) { entry.status = response.status; entry.mime = response.mimeType; entry.type = type ?? entry.type; if (response.fromDiskCache || response.fromMemoryCache || response.fromPrefetchCache) entry.cached = true; } page.lastActivity = Date.now(); });
  browser.on(sessionId, 'Network.loadingFinished', ({ requestId, encodedDataLength }) => { const entry = page.requests.get(requestId); if (entry) entry.bytes = encodedDataLength; page.lastActivity = Date.now(); });
  browser.on(sessionId, 'Network.loadingFailed', ({ requestId, errorText }) => { const entry = page.requests.get(requestId); if (entry) { entry.failed = true; entry.error = errorText; } page.lastActivity = Date.now(); });
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled });
  await send('Network.clearBrowserCache');
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.scale, mobile: viewport.mobile });
  if (viewport.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  page.navigate = async (path, settleMs) => {
    page.requests = new Map();
    page.navigatedAt = Date.now();
    page.lastActivity = Date.now();
    await send('Page.navigate', { url: base + path });
    let ready = false;
    for (let attempt = 0; attempt < 80 && !ready; attempt += 1) { await sleep(250); ready = await evaluate(READY); }
    const readyAfterMs = Date.now() - page.navigatedAt;
    // Réseau au repos : settleMs sans nouvel événement (les canaux Firestore échouent immédiatement en DNS), plafond 20 s.
    for (let attempt = 0; attempt < 80; attempt += 1) { await sleep(250); if (Date.now() - page.lastActivity > settleMs) break; }
    const entries = [...page.requests.values()].filter((entry) => !entry.url.startsWith('data:') && !entry.url.startsWith('about:'));
    return { ready, readyAfterMs, entries };
  };
  page.evaluate = evaluate;
  page.close = () => browser.send('Target.closeTarget', { targetId });
  return page;
};

try {
  const port = await devtoolsPort();
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const browser = await Cdp.connect(webSocketDebuggerUrl);

  // 1. Surfaces à froid.
  for (const viewport of viewports) {
    for (const surface of surfaces) {
      const page = await openPage(browser, { cacheDisabled: true, viewport });
      const { ready, readyAfterMs, entries } = await page.navigate(surface.path, 2000);
      const metrics = await page.evaluate(METRICS);
      const byKind = {};
      const chunks = [];
      for (const entry of entries) {
        const local = isLocal(entry.url);
        const kind = kindOf(entry.type, entry.url, entry.mime);
        const file = fileOf(entry.url);
        const known = local ? anatomy.get(file) : null;
        const row = byKind[kind] ??= { requêtes: 0, échecs: 0, octets: 0, gzip: 0, distant: 0 };
        row.requêtes += 1; if (entry.failed) row.échecs += 1; row.octets += entry.bytes; row.gzip += known?.gzip ?? 0; if (!local) row.distant += 1;
        if (kind === 'js' && local) chunks.push({ file, raw: known?.raw ?? entry.bytes, gzip: known?.gzip ?? null, icône: known?.iconOnly ?? false, initial: entry.at <= readyAfterMs });
      }
      const icons = chunks.filter((chunk) => chunk.icône);
      const remote = entries.filter((entry) => !isLocal(entry.url)).map((entry) => ({ url: entry.url, status: entry.status, bytes: entry.bytes, failed: entry.failed, error: entry.error }));
      report.results.push({
        surface: surface.name, path: surface.path, viewport: viewport.name, ready, readyAfterMs, ...metrics,
        totals: { requêtes: entries.length, octets: entries.reduce((sum, entry) => sum + entry.bytes, 0), distant: remote.length },
        byKind,
        js: { morceaux: chunks.length, initiaux: chunks.filter((chunk) => chunk.initial).length, octetsBruts: chunks.reduce((sum, chunk) => sum + chunk.raw, 0), gzip: chunks.reduce((sum, chunk) => sum + (chunk.gzip ?? 0), 0), icônes: icons.length, octetsIcônesBruts: icons.reduce((sum, chunk) => sum + chunk.raw, 0) },
        chunks: chunks.sort((left, right) => right.raw - left.raw),
        remote,
      });
      process.stderr.write(`${viewport.name} ${surface.name} : ${entries.length} requêtes (${remote.length} distantes), ${chunks.length} morceaux JS dont ${icons.length} icône(s) seule(s), prêt en ${readyAfterMs} ms\n`);
      await page.close();
    }
  }

  // 2. Parcours à chaud (V-B2) : accueil → connexion (le préchargement du Registre, s'il existe, part à l'inactivité) → étape Registre.
  {
    const page = await openPage(browser, { cacheDisabled: false, viewport: viewports[0] });
    for (const step of [{ name: 'accueil', path: '/', settle: 2000 }, { name: 'connexion', path: '/account/sign-in', settle: 3500 }, { name: 'registre-items', path: REGISTRY_ITEMS, settle: 2000 }]) {
      const { ready, readyAfterMs, entries } = await page.navigate(step.path, step.settle);
      const network = entries.filter((entry) => !entry.cached && !entry.failed);
      const js = (list) => list.filter((entry) => kindOf(entry.type, entry.url, entry.mime) === 'js');
      const late = network.filter((entry) => entry.at > readyAfterMs);
      report.sequence.push({
        step: step.name, path: step.path, ready, readyAfterMs,
        requêtes: entries.length, servisParLeCache: entries.filter((entry) => entry.cached).length, réseau: network.length,
        octetsRéseau: network.reduce((sum, entry) => sum + entry.bytes, 0),
        jsRéseau: js(network).length, jsRéseauOctets: js(network).reduce((sum, entry) => sum + entry.bytes, 0),
        jsRéseauFichiers: js(network).map((entry) => fileOf(entry.url)),
        aprèsPrêt: { requêtes: late.length, octets: late.reduce((sum, entry) => sum + entry.bytes, 0), fichiers: late.map((entry) => `${fileOf(entry.url)} @${entry.at} ms`) },
        distants: entries.filter((entry) => !isLocal(entry.url)).map((entry) => `${new URL(entry.url).host} ${entry.failed ? 'refusé' : entry.cached ? 'cache' : `${entry.bytes} o`}`),
      });
      process.stderr.write(`à chaud ${step.name} : ${entries.length} requêtes, ${network.length} réseau (${js(network).length} JS, ${(network.reduce((sum, entry) => sum + entry.bytes, 0) / 1024).toFixed(1)} ko), ${entries.filter((entry) => entry.cached).length} cache, ${late.length} après prêt\n`);
    }
    await page.close();
  }
} finally {
  chrome.kill('SIGKILL');
  server.close();
  rmSync(profile, { recursive: true, force: true });
}

// Seuils : une ligne par dépassement ; la mesure est écrite dans tous les cas.
const violations = [];
if (check) {
  for (const result of report.results) {
    const limit = LIMITS[result.surface] ?? {};
    const where = `${result.viewport} ${result.surface}`;
    if (!result.ready) violations.push(`${where} : surface non rendue (premier rendu utile absent)`);
    if (result.js.icônes > 0) violations.push(`${where} : ${result.js.icônes} morceau(x) « icône seule » (attendu 0)`);
    if (limit.js !== undefined && result.js.morceaux > limit.js) violations.push(`${where} : ${result.js.morceaux} morceaux JS (seuil ${limit.js})`);
    if (limit.jsInitiaux !== undefined && result.js.initiaux > limit.jsInitiaux) violations.push(`${where} : ${result.js.initiaux} morceaux JS initiaux (seuil ${limit.jsInitiaux})`);
    if (limit.requêtes !== undefined && result.totals.requêtes > limit.requêtes) violations.push(`${where} : ${result.totals.requêtes} requêtes (seuil ${limit.requêtes})`);
  }
  for (const step of report.sequence) {
    const limit = LIMITS[step.step] ?? {};
    if (!step.ready) violations.push(`à chaud ${step.step} : surface non rendue`);
    if (limit.jsRéseau !== undefined && step.jsRéseau > limit.jsRéseau) violations.push(`à chaud ${step.step} : ${step.jsRéseau} morceau(x) JS demandé(s) au réseau (seuil ${limit.jsRéseau}) : ${step.jsRéseauFichiers.join(', ')}`);
    if (limit.réseau !== undefined && step.réseau > limit.réseau) violations.push(`à chaud ${step.step} : ${step.réseau} requêtes réseau (seuil ${limit.réseau})`);
  }
}
report.check = { enabled: check, limits: LIMITS, violations };

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} ko`;
const lines = [`# Mesure des surfaces sur le build — ${day}`, '', `Chrome headless (${chromePath}), ${report.fonts}, cache ${report.cache}, serveur node:http sans compression (gzip recalculé depuis dist/). ${surfaces.length} surfaces × ${viewports.length} fenêtres, puis un parcours à chaud.`, '',
  '| Fenêtre | Surface | Prêt (ms) | DCL | load | LCP | Requêtes | Distantes | Octets | JS morceaux | JS initiaux | JS brut | JS gzip | Icônes seules | CSS (req) | Polices (req / octets) |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
for (const result of report.results) {
  const fonts = result.byKind.font ?? { requêtes: 0, octets: 0 };
  const css = result.byKind.css ?? { requêtes: 0 };
  lines.push(`| ${result.viewport} | ${result.surface} | ${result.readyAfterMs} | ${result.domContentLoaded ?? '—'} | ${result.load ?? '—'} | ${result.lcp ?? '—'} | ${result.totals.requêtes} | ${result.totals.distant} | ${kb(result.totals.octets)} | ${result.js.morceaux} | ${result.js.initiaux} | ${kb(result.js.octetsBruts)} | ${kb(result.js.gzip)} | ${result.js.icônes} | ${css.requêtes} | ${fonts.requêtes} / ${kb(fonts.octets)} |`);
}
lines.push('', '## Parcours à chaud (un onglet, cache actif, en-têtes Hosting) : accueil → connexion → Registre démo', '', '| Étape | Requêtes | Cache | Réseau | Octets réseau | JS réseau | Fichiers JS réseau | Après prêt |', '|---|---|---|---|---|---|---|---|');
for (const step of report.sequence) lines.push(`| ${step.step} | ${step.requêtes} | ${step.servisParLeCache} | ${step.réseau} | ${kb(step.octetsRéseau)} | ${step.jsRéseau} (${kb(step.jsRéseauOctets)}) | ${step.jsRéseauFichiers.map(shortName).join(', ') || '—'} | ${step.aprèsPrêt.requêtes} |`);
lines.push('', '## Document (bureau)', '');
for (const result of report.results.filter((entry) => entry.viewport === 'desktop-1440')) {
  lines.push(`- ${result.surface} : titre « ${result.title} », modulepreload ${JSON.stringify(result.modulepreload)}, preload/prefetch ${JSON.stringify(result.preload)}, feuilles de style ${JSON.stringify(result.stylesheets)}, polices résolues ${result.fontFaces.length}.`);
}
lines.push('', '## Morceaux JS par surface (bureau)', '');
for (const result of report.results.filter((entry) => entry.viewport === 'desktop-1440')) {
  lines.push(`### ${result.surface}`, '', ...result.chunks.map((chunk) => `- ${chunk.file} — ${kb(chunk.raw)} brut, ${chunk.gzip === null ? '—' : kb(chunk.gzip)} gzip${chunk.initial ? '' : ' (après le premier rendu)'}${chunk.icône ? ' (icône seule)' : ''}`), '');
}
lines.push('## Seuils', '', check ? (violations.length ? violations.map((violation) => `- ${violation}`).join('\n') : '- Aucun dépassement.') : '- Non contrôlés (sans --check).');
writeFileSync(join(outDir, `${day}.json`), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(join(outDir, `${day}.md`), `${lines.join('\n')}\n`);
process.stdout.write(`${lines.join('\n')}\n`);
console.error(`Relevé : ${join(outDir, `${day}.json`)} — ${violations.length} dépassement(s)${check ? '' : ' (seuils non contrôlés)'}.`);
process.exit(violations.length === 0 ? 0 : 1);
