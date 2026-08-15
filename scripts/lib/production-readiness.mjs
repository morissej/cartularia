import { readdir, readFile, stat } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { join, relative } from 'node:path';
import { listFirestoreDocuments } from './backup-command.mjs';
import { canonicalize, sha256Digest } from './canonical-json.mjs';

const PROJECTED_ROOTS = new Set([
  'publications',
  'seals',
  'communityPublications',
  'communityPosts',
  'communityProfiles',
]);

const FORBIDDEN_KEYS = [
  'accountHolderId',
  'legalOwnerRelationId',
  'ownerUid',
  'serialNumber',
  'acquisitionPrice',
  'purchasePrice',
  'privatePath',
  'downloadUrl',
  'documentUrl',
  'cover.owner',
  'cover.transmission',
  'cover.storage',
  'value.purchase',
];

const TEXT_FILE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.md', '.yml', '.yaml', '.env', '.example', '.rules', '.html', '.css',
]);
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', '.firebase', 'coverage']);
const CREDENTIAL_PATTERNS = [
  { code: 'private_key', expression: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
  { code: 'service_account_private_key', expression: /["']private_key["']\s*:/ },
  { code: 'service_account_identity', expression: /["']client_email["']\s*:\s*["'][^"']+gserviceaccount\.com/ },
  { code: 'github_token', expression: /\bgh[oprsu]_[A-Za-z0-9]{30,}\b/ },
  { code: 'live_secret_key', expression: /\bsk_live_[A-Za-z0-9]{16,}\b/ },
];

const extensionOf = (path) => {
  const index = path.lastIndexOf('.');
  return index === -1 ? '' : path.slice(index).toLowerCase();
};

const percentile = (values, ratio) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
};

export const runFirestoreLoadProbe = async ({
  firestore,
  documentPaths,
  iterations = 100,
  concurrency = 10,
  thresholds = { maxP95Ms: 1000, maxErrorRate: 0 },
}) => {
  if (!Array.isArray(documentPaths) || documentPaths.length === 0) throw new TypeError('documentPaths est requis.');
  const latencies = [];
  const errors = [];
  let cursor = 0;
  const startedAt = performance.now();
  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= iterations) return;
      const path = documentPaths[index % documentPaths.length];
      const started = performance.now();
      try {
        const snapshot = await firestore.doc(path).get();
        if (!snapshot.exists) throw new Error(`Document ${path} absent.`);
      } catch (error) {
        errors.push({ path, message: error.message });
      } finally {
        latencies.push(performance.now() - started);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, iterations) }, worker));
  const p95Ms = percentile(latencies, 0.95);
  const errorRate = errors.length / iterations;
  const result = {
    iterations,
    concurrency,
    durationMs: performance.now() - startedAt,
    p50Ms: percentile(latencies, 0.5),
    p95Ms,
    p99Ms: percentile(latencies, 0.99),
    errorCount: errors.length,
    errorRate,
    thresholds,
    errors: errors.slice(0, 10),
  };
  return { ...result, passed: p95Ms <= thresholds.maxP95Ms && errorRate <= thresholds.maxErrorRate };
};

export const measureFirestoreFootprint = async (firestore) => {
  const records = await listFirestoreDocuments(firestore);
  const collectionCounts = {};
  let estimatedJsonBytes = 0;
  for (const record of records) {
    const rootCollection = record.path.split('/')[0];
    collectionCounts[rootCollection] = (collectionCounts[rootCollection] ?? 0) + 1;
    estimatedJsonBytes += Buffer.byteLength(canonicalize(record.data), 'utf8');
  }
  return {
    documentCount: records.length,
    estimatedJsonBytes,
    collectionCounts: Object.fromEntries(Object.entries(collectionCounts).sort(([left], [right]) => left.localeCompare(right))),
    measurementScope: 'logical_json_without_index_overhead',
  };
};

export const estimateMonthlyCost = ({ workload, unitPrices }) => {
  const requiredPrices = ['readsPer100k', 'writesPer100k', 'deletesPer100k', 'storageGbMonth', 'egressGb'];
  if (!unitPrices || requiredPrices.some((key) => !Number.isFinite(unitPrices[key]))) {
    return { status: 'not_configured', currency: null, estimatedMonthlyCost: null };
  }
  const lineItems = {
    reads: (workload.reads / 100_000) * unitPrices.readsPer100k,
    writes: (workload.writes / 100_000) * unitPrices.writesPer100k,
    deletes: (workload.deletes / 100_000) * unitPrices.deletesPer100k,
    storage: workload.storageGb * unitPrices.storageGbMonth,
    egress: workload.egressGb * unitPrices.egressGb,
  };
  return {
    status: 'estimated',
    currency: unitPrices.currency ?? 'EUR',
    lineItems,
    estimatedMonthlyCost: Object.values(lineItems).reduce((sum, value) => sum + value, 0),
    caveat: 'Estimation paramétrique hors taxes, index, fonctions, Auth et remises contractuelles.',
  };
};

const scanProjectedValue = (value, path, findings) => {
  if (Array.isArray(value)) {
    value.forEach((child, index) => scanProjectedValue(child, `${path}[${index}]`, findings));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase();
      const forbidden = FORBIDDEN_KEYS.find((candidate) => normalizedKey.includes(candidate.toLowerCase()));
      if (forbidden) findings.push({ code: 'forbidden_field', path: `${path}.${key}`, marker: forbidden });
      scanProjectedValue(child, `${path}.${key}`, findings);
    }
    return;
  }
  if (typeof value === 'string') {
    if (/\/private\//i.test(value)) findings.push({ code: 'private_path', path });
    if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)) findings.push({ code: 'email_value', path });
  }
};

export const auditProjectionPrivacy = async ({ firestore, records = null }) => {
  const allRecords = records ?? await listFirestoreDocuments(firestore);
  const projectedRecords = allRecords.filter((record) => PROJECTED_ROOTS.has(record.path.split('/')[0]));
  const findings = [];
  for (const record of projectedRecords) scanProjectedValue(record.data, record.path, findings);
  return {
    passed: findings.length === 0,
    scannedDocuments: projectedRecords.length,
    findings,
    policy: 'physical_absence_of_secret_fields-v1',
  };
};

const collectTextFiles = async (root, directory = root, files = []) => {
  for (const name of await readdir(directory)) {
    if (IGNORED_DIRECTORIES.has(name)) continue;
    const path = join(directory, name);
    const details = await stat(path);
    if (details.isDirectory()) await collectTextFiles(root, path, files);
    else if (details.size <= 2_000_000 && TEXT_FILE_EXTENSIONS.has(extensionOf(name))) files.push(path);
  }
  return files;
};

export const scanRepositoryForCredentials = async (root) => {
  const files = await collectTextFiles(root);
  const findings = [];
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    for (const pattern of CREDENTIAL_PATTERNS) {
      if (pattern.expression.test(content)) findings.push({ code: pattern.code, file: relative(root, file) });
    }
  }
  return { passed: findings.length === 0, scannedFiles: files.length, findings };
};

const decisionConfirmed = (decision, allowedModes = null) =>
  decision?.status === 'confirmed' && (!allowedModes || allowedModes.includes(decision.mode));

export const evaluateProductionReadiness = ({ policy, checks }) => {
  const blockers = [];
  if (policy.regions?.status !== 'confirmed' || !policy.regions.firestore || !policy.regions.storage) {
    blockers.push('D-01_region_firestore_storage');
  }
  if (!decisionConfirmed(policy.privacy?.personalDataPublication, ['forbid'])) blockers.push('D-03_publication_donnees_personnelles');
  if (!decisionConfirmed(policy.privacy?.serverWriteAuthority, ['server_only'])) blockers.push('D-04_autorite_ecriture_serveur');
  if (!decisionConfirmed(policy.privacy?.encryptionAssessment)) blockers.push('D-06_evaluation_chiffrement_applicatif');
  if (!decisionConfirmed(policy.privacy?.retentionMatrix)) blockers.push('D-07_conservation_suppression');
  if (policy.pricing?.status !== 'confirmed') blockers.push('grille_couts_regionale');
  if (policy.release?.remoteDeploymentAuthorized !== true) blockers.push('autorisation_deploiement_distant');
  for (const [name, check] of Object.entries(checks)) {
    if (check?.passed !== true) blockers.push(`controle_${name}`);
  }
  const reportCore = {
    policyVersion: policy.policyVersion,
    constructionStatus: 'complete',
    goLiveAuthorization: blockers.length === 0 ? 'authorized' : 'blocked',
    blockers: [...new Set(blockers)].sort(),
    checks: Object.fromEntries(Object.entries(checks).map(([name, check]) => [name, { passed: check?.passed === true }])),
  };
  return { ...reportCore, reportDigest: sha256Digest(reportCore) };
};
