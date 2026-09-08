import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Garde-fou issu de la requalification du constat V-B6 (audit du 2026-09-08) :
// Chromium avertit « Deprecated API for given entry type. » quand
// performance.getEntriesByType() reçoit un type connu mais hors chronologie
// (largest-contentful-paint, layout-shift, longtask, event, element...). Les
// métriques web se collectent avec PerformanceObserver.observe({ type, buffered })
// par type, jamais avec observe({ entryTypes }) ni getEntriesByType() sur ces types.

const projectRoot = new URL('../', import.meta.url);
const SCANNED_DIRECTORIES = ['src', 'scripts'];
const SCANNED_ROOT_FILES = ['index.html'];
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|html)$/;
const HISTORICAL_COPY = / 2\./;

const NON_TIMELINE_ENTRY_TYPES = ['largest-contentful-paint', 'layout-shift', 'longtask', 'event', 'element'];
const FORBIDDEN_PATTERNS = [
  { label: 'observe({ entryTypes })', pattern: /\.observe\(\s*\{[^}]*\bentryTypes\b/ },
  {
    label: 'getEntriesByType() sur un type hors chronologie',
    pattern: new RegExp(`getEntriesByType\\(\\s*['"\`](?:${NON_TIMELINE_ENTRY_TYPES.join('|')})['"\`]`),
  },
];

const listSourceFiles = async () => {
  const files = [...SCANNED_ROOT_FILES];
  for (const directory of SCANNED_DIRECTORIES) {
    const entries = await readdir(new URL(`${directory}/`, projectRoot), { recursive: true });
    for (const entry of entries) {
      const relative = `${directory}/${entry}`;
      if (SOURCE_FILE.test(relative) && !HISTORICAL_COPY.test(relative)) files.push(relative);
    }
  }
  return files.sort();
};

const findViolations = (relativePath, source) => {
  const violations = [];
  const lines = source.split(/\r?\n/);
  for (const { label, pattern } of FORBIDDEN_PATTERNS) {
    lines.forEach((line, index) => {
      if (pattern.test(line)) violations.push(`${relativePath}:${index + 1} — ${label}`);
    });
  }
  return violations;
};

test('aucun observe({ entryTypes }) ni getEntriesByType() hors chronologie dans src/, scripts/ et index.html', async () => {
  const files = await listSourceFiles();
  assert.ok(files.length > 50, `le balayage doit couvrir le code applicatif (${files.length} fichiers trouvés)`);
  assert.ok(files.includes('scripts/lib/web-vitals-probe.mjs'), 'la sonde d’audit doit être balayée elle aussi');

  const violations = [];
  for (const relativePath of files) {
    const source = await readFile(fileURLToPath(new URL(relativePath, projectRoot)), 'utf8');
    violations.push(...findViolations(relativePath, source));
  }
  assert.deepEqual(violations, []);
});

test('les motifs interdits détectent bien les formes fautives', () => {
  const sample = [
    "new PerformanceObserver(() => {}).observe({ entryTypes: ['largest-contentful-paint'] });",
    "const lcp = performance.getEntriesByType('largest-contentful-paint');",
    'const shifts = performance.getEntriesByType("layout-shift");',
    "observer.observe({ type: 'largest-contentful-paint', buffered: true });",
    "performance.getEntriesByType('navigation');",
  ].join('\n');
  const violations = findViolations('exemple.js', sample);
  assert.deepEqual(violations.map((violation) => violation.split(' — ')[0]), ['exemple.js:1', 'exemple.js:2', 'exemple.js:3']);
});
