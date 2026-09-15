// V6 — audit automatique d'accessibilité (D15 (a)) : axe-core injecté dans le Chrome installé, piloté par le protocole DevTools
// (WebSocket natif de Node ≥ 22, aucune autre dépendance). Sert un build statique avec node:http, coupe tout hôte sauf 127.0.0.1,
// parcourt les surfaces publiques et la démo (deux fenêtres, états ouverts), puis pose des assertions hors axe (V-D3, V-D4, V-D8, V-D9, V-D10,
// identité de la scène par son titre, page rendue sans écran d'erreur, déclencheur présent hors saut prévu).
// « Sans erreur » = 0 violation serious/critical hors scripts/audit-accessibility.allowlist.json (entrées datées, motif, échéance) et 0 assertion en échec.
// Le canal `incomplete` d'axe (nœuds à vérifier à la main, contraste sur dégradé surtout) est compté par scène et par règle dans le JSON et le .md ; il ne
// change pas le code de sortie, sauf `aria-prohibited-attr` (jamais légitime ici : assertion). Relevé stable au jour près (ni heure ni port : un fichier par jour).
// Usage : node scripts/audit-accessibility.mjs --serve dist [--out docs/audits/a11y]   (Chrome : CARTULARIA_CHROME, sinon l'application macOS).
// Sorties : <out>/<date>.json (relevé complet) et <out>/<date>.md (résumé). Codes : 0 sans erreur, 1 erreurs, 2 non exécuté (Chrome absent).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const distDir = resolve(option('--serve', 'dist'));
const outDir = resolve(option('--out', 'docs/audits/a11y'));
const chromePath = process.env.CARTULARIA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(chromePath)) { console.error(`Audit non exécuté : Chrome introuvable (${chromePath}). Définir CARTULARIA_CHROME.`); process.exit(2); }
if (!existsSync(join(distDir, 'index.html'))) { console.error(`Audit non exécuté : build absent (${distDir}/index.html). Lancer npm run build.`); process.exit(2); }
const axeSource = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const axeLocale = readFileSync(new URL('../node_modules/axe-core/locales/fr.json', import.meta.url), 'utf8');
const allowlist = JSON.parse(readFileSync(new URL('./audit-accessibility.allowlist.json', import.meta.url), 'utf8')).entries;
for (const entry of allowlist) {
  if (!entry.rule || !entry.reason || !/^\d{4}-\d{2}-\d{2}$/.test(entry.since) || !entry.until) throw new Error(`Exception incomplète (rule, reason, since AAAA-MM-JJ, until) : ${JSON.stringify(entry)}`);
}

const DEMO = '/cartulary-demo?cartularyId=cart_demo_rolex_submariner_124060';
const DEMO_TITLE = 'Cartulaire Rolex Submariner · Cartularia';
// `title` : identité attendue de la scène (document.title exact) — une route cassée servirait la page 404 « Page introuvable » ou l'écran d'erreur, audités « sans erreur » sinon.
// `openAbsentOn` : seule fenêtre où le déclencheur peut manquer (menu mobile de l'accueil) ; ailleurs, un déclencheur absent est une assertion en échec.
const SERVICE_TITLES = { accessibilite: 'Accessibilité', conditions: 'Conditions d’utilisation du pilote', confidentialite: 'Confidentialité et données', service: 'Disponibilité et limites' };
const scenes = [
  { name: 'accueil', path: '/', title: 'Cartularia · Le dossier vivant de vos objets patrimoniaux & horlogers' },
  { name: 'accueil-menu', path: '/', title: 'Cartularia · Le dossier vivant de vos objets patrimoniaux & horlogers', open: '.public-menu-trigger', openAbsentOn: 'desktop-1440' },
  ...['cover', 'media', 'reference', 'condition', 'value', 'publication'].map((anchor) => ({ name: `demo-${anchor}`, path: `${DEMO}#${anchor}`, title: DEMO_TITLE, demo: true })),
  { name: 'demo-preuves', path: `${DEMO}#cover`, title: DEMO_TITLE, demo: true, open: '.page-tabs__audit' },
  { name: 'demo-a-faire', path: `${DEMO}#cover`, title: DEMO_TITLE, demo: true, open: '.todo-trigger' },
  ...['accessibilite', 'conditions', 'confidentialite', 'service'].map((page) => ({ name: page, path: `/${page}`, title: `${SERVICE_TITLES[page]} · Cartularia` })),
  { name: 'sign-in', path: '/account/sign-in', title: 'Connexion · Cartularia' },
  { name: 'not-found', path: '/page-inexistante', title: 'Page introuvable · Cartularia' },
];
const viewports = [
  { name: 'mobile-390', width: 390, height: 844, mobile: true, scale: 3 },
  { name: 'desktop-1440', width: 1440, height: 900, mobile: false, scale: 1 },
];
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'];
const BLOCKING = new Set(['serious', 'critical']);
// Règles dont un nœud « à vérifier » vaut échec : aria-label sur un div sans rôle porteur de texte (axe ne tranche pas quand l'élément a un contenu).
const NEVER_INCOMPLETE = new Set(['aria-prohibited-attr']);
// Motif construit par concaténation : la garde du contrat parcourt scripts/ et ne doit pas se lire elle-même (C4).
const FAULTY_TITLE = 'mini' + ' -site';

// Serveur statique : fichiers de dist/, repli index.html pour les routes de l'application (y compris la page 404 rendue par le client).
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json', '.pdf': 'application/pdf' };
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const candidate = resolve(distDir, `.${pathname}`);
  const file = candidate.startsWith(distDir) && existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(distDir, 'index.html');
  response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  response.end(readFileSync(file));
});
await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
const base = `http://127.0.0.1:${server.address().port}`; // port éphémère : jamais écrit dans le relevé

// Chrome headless : port DevTools éphémère lu dans DevToolsActivePort ; toute résolution DNS échoue sauf 127.0.0.1 (aucun appel distant, polices comprises).
const profile = mkdtempSync(join(tmpdir(), 'cartularia-a11y-'));
const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--disable-component-update', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function devtoolsPort() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { const port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); if (port > 0) return port; } catch { /* pas encore écrit */ }
    await sleep(250);
  }
  throw new Error('Chrome n’a pas ouvert son port DevTools.');
}
class Cdp {
  constructor(socket) { this.socket = socket; this.id = 0; this.pending = new Map(); socket.onmessage = (event) => this.receive(JSON.parse(event.data)); }
  static async connect(url) { const socket = new WebSocket(url); await new Promise((open, fail) => { socket.onopen = open; socket.onerror = fail; }); return new Cdp(socket); }
  receive(message) { const call = this.pending.get(message.id); if (!call) return; this.pending.delete(message.id); if (message.error) call.reject(new Error(message.error.message)); else call.resolve(message.result); }
  send(method, params = {}, sessionId) { const id = ++this.id; this.socket.send(JSON.stringify({ id, method, params, sessionId })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
}

// Assertions hors axe, évaluées dans la page : débordement, lien d'évitement au focus, h1 de couverture, onglet actif visible, langue, graphie, titre.
// Débordement mesuré contre documentElement.clientWidth : en émulation mobile, Chrome gonfle innerWidth jusqu'à la largeur du contenu (× 4 au plus),
// ce qui rendait « scrollWidth ≤ innerWidth » toujours vrai sous 1 560 px (relecture V6, F1) ; clientWidth reste la largeur émulée (390).
const CHECKS = `(() => {
  const round = (n) => Math.round(n * 10) / 10;
  const skip = document.querySelector('.skip-link');
  let skipLink = null;
  if (skip) { skip.focus(); const style = getComputedStyle(skip); const rect = skip.getBoundingClientRect(); skipLink = { focused: document.activeElement === skip, color: style.color, background: style.backgroundColor, top: round(rect.top), height: round(rect.height) }; skip.blur(); }
  const track = document.querySelector('.page-tabs__inner'); const active = track?.querySelector('[aria-current="page"]');
  const activeTab = track && active ? (() => { const t = track.getBoundingClientRect(); const a = active.getBoundingClientRect(); return { text: active.textContent, visible: a.left >= t.left - 0.5 && a.right <= t.right + 0.5, scrollLeft: track.scrollLeft }; })() : null;
  return { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, title: document.title, lang: document.documentElement.lang, languageToggles: document.querySelectorAll('.language-toggle').length,
    h1: Array.from(document.querySelectorAll('h1')).map((h) => h.textContent.replace(/\\s+/g, ' ').trim()), skipLink, activeTab, faultyTitle: document.body.textContent.includes(${JSON.stringify(FAULTY_TITLE)}) };
})()`;
const evaluateChecks = (scene, viewport, values, ready) => {
  const checks = [
    { name: 'page rendue (ni écran d’erreur ni attente épuisée)', ok: ready, detail: ready ? 'rendue' : 'non rendue après 20 s' },
    { name: 'titre attendu', ok: values.title === scene.title, detail: values.title },
    { name: 'scrollWidth ≤ clientWidth', ok: values.scrollWidth <= values.clientWidth, detail: `${values.scrollWidth}/${values.clientWidth}` },
    { name: 'lang="fr"', ok: values.lang === 'fr', detail: values.lang },
    { name: '0 .language-toggle', ok: values.languageToggles === 0, detail: String(values.languageToggles) },
    { name: 'aucune graphie fautive de « mini-site »', ok: !values.faultyTitle, detail: values.faultyTitle ? 'présente' : 'absente' },
  ];
  if (values.skipLink) checks.push({ name: 'lien d’évitement visible au focus', ok: values.skipLink.focused && values.skipLink.color !== values.skipLink.background && values.skipLink.height > 0 && values.skipLink.top >= 0, detail: JSON.stringify(values.skipLink) });
  if (scene.demo) {
    checks.push({ name: 'onglet aria-current visible dans la piste', ok: values.activeTab?.visible === true, detail: JSON.stringify(values.activeTab) });
    if (scene.path.endsWith('#cover')) checks.push({ name: 'h1 « Rolex Submariner »', ok: values.h1.some((text) => text.includes('Rolex Submariner')), detail: values.h1.join(' | ') });
  }
  return checks;
};
const matchesEntry = (entry, sceneName, violation, node) => entry.rule === violation.id
  && (!entry.scenes || entry.scenes.some((pattern) => new RegExp(`^${pattern.replace(/\*/g, '.*')}$`).test(sceneName)))
  && (!entry.target || node.target.join(' ').includes(entry.target));

const day = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10); // date locale : un relevé par jour, reproductible à l'octet
const report = { date: day, chrome: chromePath, axe: JSON.parse(readFileSync(new URL('../node_modules/axe-core/package.json', import.meta.url), 'utf8')).version, tags: TAGS, scenes: [] };
const usedEntries = new Set();
try {
  const port = await devtoolsPort();
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const browser = await Cdp.connect(webSocketDebuggerUrl);
  for (const viewport of viewports) {
    for (const scene of scenes) {
      const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
      const send = (method, params) => browser.send(method, params, sessionId);
      const evaluate = async (expression) => { const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text); return result.value; };
      await send('Page.enable'); await send('Runtime.enable');
      await send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.scale, mobile: viewport.mobile });
      if (viewport.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await send('Page.navigate', { url: base + scene.path });
      let ready = false;
      for (let attempt = 0; attempt < 80 && !ready; attempt += 1) { await sleep(250); ready = await evaluate(`!!document.querySelector('.page-tabs') || (!!document.querySelector('main') && !document.querySelector('.application-shell'))`); }
      await sleep(1000);
      let opened = null;
      if (scene.open) {
        opened = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(scene.open)}); if (!el || el.getBoundingClientRect().width === 0) return false; el.click(); return true; })()`);
        await sleep(1500);
      }
      const entry = { scene: scene.name, viewport: viewport.name, url: scene.path, ready, opened, violations: [], blocking: 0, allowed: 0, other: 0, toReview: 0, incomplete: [], checks: [] };
      if (scene.open && !opened) {
        if (scene.openAbsentOn === viewport.name) entry.skipped = 'déclencheur absent à cette largeur (prévu)';
        else entry.checks.push({ name: `déclencheur ${scene.open} présent`, ok: false, detail: 'absent : état ouvert non audité' });
        report.scenes.push(entry); await browser.send('Target.closeTarget', { targetId }); continue;
      }
      await evaluate(axeSource);
      // `incomplete` demandé explicitement : sans ce type, axe tronque chaque règle à un nœud et rien ne peut être compté.
      const results = await evaluate(`axe.configure({ locale: ${axeLocale} }); axe.run(document, { runOnly: { type: 'tag', values: ${JSON.stringify(TAGS)} }, resultTypes: ['violations', 'incomplete'] }).then((r) => ({ violations: r.violations, passes: r.passes.length,
        incomplete: r.incomplete.map((i) => ({ id: i.id, impact: i.impact, nodes: i.nodes.length, target: i.nodes[0]?.target.join(' '), reason: ((i.nodes[0]?.any ?? []).concat(i.nodes[0]?.all ?? []).find((c) => c.message)?.message ?? '').slice(0, 160) })) }))`);
      entry.passes = results.passes; entry.incomplete = results.incomplete; entry.toReview = results.incomplete.reduce((sum, rule) => sum + rule.nodes, 0);
      for (const violation of results.violations) {
        const nodes = violation.nodes.map((node) => {
          const allowedBy = allowlist.find((candidate) => matchesEntry(candidate, scene.name, violation, node));
          if (allowedBy) usedEntries.add(allowedBy);
          return { target: node.target, html: node.html.slice(0, 160), summary: node.failureSummary?.slice(0, 300), allowedBy: allowedBy?.reason };
        });
        entry.violations.push({ id: violation.id, impact: violation.impact, help: violation.help, nodes });
        if (!BLOCKING.has(violation.impact)) { entry.other += nodes.length; continue; }
        const allowed = nodes.filter((node) => node.allowedBy).length;
        entry.allowed += allowed; entry.blocking += nodes.length - allowed;
      }
      entry.checks = evaluateChecks(scene, viewport, await evaluate(CHECKS), ready);
      const neverIncomplete = results.incomplete.filter((rule) => NEVER_INCOMPLETE.has(rule.id));
      entry.checks.push({ name: 'aucun nœud à vérifier sur aria-prohibited-attr', ok: neverIncomplete.length === 0, detail: neverIncomplete.map((rule) => `${rule.id} × ${rule.nodes} (${rule.target})`).join(' ; ') || 'aucun' });
      report.scenes.push(entry);
      await browser.send('Target.closeTarget', { targetId });
      console.error(`${viewport.name} ${scene.name} : ${entry.blocking} bloquante(s), ${entry.allowed} tolérée(s), ${entry.other} mineure(s), ${entry.toReview} à vérifier, assertions ${entry.checks.filter((c) => !c.ok).length} en échec`);
    }
  }
} finally {
  chrome.kill('SIGTERM'); server.close(); await sleep(300); rmSync(profile, { recursive: true, force: true });
}

const failedChecks = report.scenes.flatMap((scene) => scene.checks.filter((check) => !check.ok).map((check) => `${scene.viewport} ${scene.scene} : ${check.name} (${check.detail})`));
const blockingTotal = report.scenes.reduce((sum, scene) => sum + scene.blocking, 0);
const toReviewTotal = report.scenes.reduce((sum, scene) => sum + scene.toReview, 0);
report.summary = { blocking: blockingTotal, toReview: toReviewTotal, failedChecks, unusedAllowlist: allowlist.filter((entry) => !usedEntries.has(entry)).map((entry) => `${entry.rule} ${entry.target ?? ''}`.trim()) };
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${day}.json`), `${JSON.stringify(report, null, 2)}\n`);
const rows = report.scenes.map((scene) => `| ${scene.scene} | ${scene.viewport} | ${scene.skipped ? '—' : scene.blocking} | ${scene.skipped ? '—' : scene.allowed} | ${scene.skipped ? '—' : scene.other} | ${scene.skipped ? '—' : scene.toReview} | ${scene.skipped ? scene.skipped : scene.checks.filter((check) => !check.ok).length} |`);
// Nœuds à vérifier (canal incomplete d'axe) : une ligne par scène et par règle, effectif, premier sélecteur et motif d'axe.
const toReview = report.scenes.flatMap((scene) => scene.incomplete.map((rule) => `- ${scene.viewport} ${scene.scene} · \`${rule.id}\` (${rule.impact}) × ${rule.nodes} · \`${rule.target}\` · ${rule.reason}`));
// Une ligne par règle et par motif de tolérance (nœuds regroupés, premier sélecteur cité) : le JSON garde le détail nœud par nœud.
const details = report.scenes.flatMap((scene) => scene.violations.flatMap((violation) => {
  const groups = new Map();
  for (const node of violation.nodes) { const key = node.allowedBy ?? ''; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(node); }
  return [...groups].map(([reason, nodes]) => `- ${scene.viewport} ${scene.scene} · \`${violation.id}\` (${violation.impact}) × ${nodes.length} · \`${nodes[0].target.join(' ')}\`${reason ? ` · tolérée : ${reason}` : BLOCKING.has(violation.impact) ? ' · **bloquante**' : ''}`);
}));
writeFileSync(join(outDir, `${day}.md`), [`# Audit d'accessibilité — ${day}`, '', `axe-core ${report.axe}, étiquettes ${TAGS.join(', ')} ; Chrome headless (${chromePath}), réseau coupé hors 127.0.0.1 ; ${scenes.length} scènes × ${viewports.length} fenêtres.`, '',
  `**Résultat : ${blockingTotal === 0 && failedChecks.length === 0 ? 'sans erreur' : `${blockingTotal} violation(s) bloquante(s), ${failedChecks.length} assertion(s) en échec`}** — ${toReviewTotal} nœud(s) à vérifier à la main (canal \`incomplete\` d'axe, hors décision : contraste indéterminé sur dégradé, pseudo-élément ou glyphe hors plan de base ; liste en § « Nœuds à vérifier »).`, '',
  '| Scène | Fenêtre | Bloquantes (serious/critical) | Tolérées (liste d’exceptions) | Mineures (moderate/minor) | À vérifier (incomplete) | Assertions en échec |', '|---|---|---|---|---|---|---|', ...rows, '',
  '## Violations relevées', '', ...(details.length ? details : ['Aucune.']), '', '## Assertions en échec', '', ...(failedChecks.length ? failedChecks.map((line) => `- ${line}`) : ['Aucune.']), '',
  '## Nœuds à vérifier', '', ...(toReview.length ? toReview : ['Aucun.']), '',
  '## Exceptions inutilisées', '', ...(report.summary.unusedAllowlist.length ? report.summary.unusedAllowlist.map((line) => `- ${line}`) : ['Aucune.']), ''].join('\n'));
console.error(`Relevé : ${join(outDir, `${day}.json`)} — ${blockingTotal} violation(s) bloquante(s), ${failedChecks.length} assertion(s) en échec, ${toReviewTotal} nœud(s) à vérifier.`);
process.exit(blockingTotal === 0 && failedChecks.length === 0 ? 0 : 1);
