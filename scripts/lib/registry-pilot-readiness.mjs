import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256Digest } from './canonical-json.mjs';
import { evaluateProductionReadiness } from './production-readiness.mjs';

export const REGISTRY_PILOT_CHECK_IDS = Object.freeze([
  'session_and_context',
  'tenant_isolation',
  'catalog_projection',
  'operational_surfaces',
  'cartulary_authority',
  'route_contract',
  'keyboard_accessibility',
  'responsive_layout',
  'automated_validation',
  'operational_readiness',
]);

const read = (rootDirectory, relativePath) => readFileSync(join(rootDirectory, relativePath), 'utf8');
const hasAll = (content, markers) => markers.every((marker) => content.includes(marker));
const filesExist = (rootDirectory, paths) => paths.every((path) => existsSync(join(rootDirectory, path)));

export const collectRegistryPilotChecks = (rootDirectory) => {
  const packageDocument = JSON.parse(read(rootDirectory, 'package.json'));
  const rootPage = read(rootDirectory, 'src/RootPage.tsx');
  const interfaceState = read(rootDirectory, 'src/utils/interfaceState.ts');
  const registryApp = read(rootDirectory, 'src/features/registry/RegistryApp.tsx');
  const registryRouting = read(rootDirectory, 'src/features/registry/registryRouting.ts');
  const registryStyles = read(rootDirectory, 'src/features/registry/registry.css');
  const projectionService = read(rootDirectory, 'src/services/projections.ts');
  const firestoreRules = read(rootDirectory, 'firestore.rules');
  const productionPolicy = JSON.parse(read(rootDirectory, 'config/production-policy.json'));
  const registryFeatureSources = [
    'src/features/registry/RegistryOverview.tsx',
    'src/features/registry/RegistryItems.tsx',
    'src/features/registry/RegistryGallery.tsx',
    'src/features/registry/RegistryComparison.tsx',
    'src/features/registry/RegistryFollowUp.tsx',
    'src/features/registry/RegistryAccessCenter.tsx',
    'src/features/registry/RegistryIntegrity.tsx',
    'src/features/registry/RegistryAdministration.tsx',
    'src/services/registryGallery.ts',
    'src/services/registryIntegrity.ts',
  ].map((path) => read(rootDirectory, path)).join('\n');

  const expectedWaveFiles = Array.from({ length: 8 }, (_, index) => `docs/REGISTRY_WAVE_${index + 1}.md`);
  const expectedTestScripts = [
    'test:wave7',
    'test:registry-wave2',
    'test:registry-wave3',
    'test:registry-wave4',
    'test:registry-wave5',
    'test:registry-wave6',
    'test:registry-wave7',
    'test:registry-wave8',
    'test:corrective-wave1',
    'test:corrective-wave2',
    'test:corrective-wave3',
    'test:retention',
  ];
  const forbiddenRegistryDependencies = [
    'uploadBytes(',
    'deleteObject(',
    'setDoc(',
    'updateDoc(',
    'writeBatch(',
    'runTransaction(',
    "from '../../services/cartularies",
  ];

  return {
    session_and_context: {
      passed: hasAll(rootPage, ['applicationRouteFromPathname', "route === 'registry'"])
        && hasAll(interfaceState, ["normalized === '/registry'", "normalized.startsWith('/registry/')"])
        && hasAll(registryApp, ['observeCartulariaSession', 'loadAccountOrganizations', 'choices.length !== 1']),
      evidence: ['src/RootPage.tsx', 'src/utils/interfaceState.ts', 'src/features/registry/RegistryApp.tsx'],
    },
    tenant_isolation: {
      passed: hasAll(firestoreRules, [
        "hasPermission(organizationId, 'registry.read')",
        'registryIsInScope(organizationId, registryId)',
        'allow create, update, delete: if false;',
      ]),
      evidence: ['firestore.rules'],
    },
    catalog_projection: {
      passed: hasAll(projectionService, [
        "collection(db, 'registries', registryId, 'items')",
        "orderBy('updatedAt', 'desc')",
      ]),
      evidence: ['src/services/projections.ts'],
    },
    operational_surfaces: {
      passed: filesExist(rootDirectory, [
        'src/features/registry/RegistryOverview.tsx',
        'src/features/registry/RegistryItems.tsx',
        'src/features/registry/RegistryGallery.tsx',
        'src/features/registry/RegistryComparison.tsx',
        'src/features/registry/RegistryFollowUp.tsx',
        'src/features/registry/RegistryAccessCenter.tsx',
        'src/features/registry/RegistryIntegrity.tsx',
        'src/features/registry/RegistryAdministration.tsx',
      ]) && hasAll(registryApp, [
        "section === 'overview'",
        "section === 'items'",
        "section === 'gallery'",
        "section === 'compare'",
        "section === 'follow-up'",
        "section === 'access'",
        "section === 'integrity'",
        "section === 'admin'",
      ]),
      evidence: ['src/features/registry/RegistryApp.tsx'],
    },
    cartulary_authority: {
      passed: forbiddenRegistryDependencies.every((marker) => !registryFeatureSources.includes(marker))
        && hasAll(registryFeatureSources, ['sans dupliquer', 'Cartulaire']),
      evidence: ['src/features/registry'],
    },
    route_contract: {
      passed: hasAll(registryRouting, [
        "'overview'",
        "'items'",
        "'gallery'",
        "'compare'",
        "'follow-up'",
        "'access'",
        "'integrity'",
        "'admin'",
        'encodeURIComponent(registryId)',
        'decodeURIComponent(segments[1])',
      ]),
      evidence: ['src/features/registry/registryRouting.ts'],
    },
    keyboard_accessibility: {
      passed: hasAll(registryApp, [
        'className="registry-skip-link"',
        'href="#registry-main-content"',
        'aria-label={meta.label}',
        'id="registry-main-content"',
      ]) && hasAll(registryStyles, [
        '.registry-skip-link:focus',
        '.registry-app a:focus-visible',
        '@media (prefers-reduced-motion: reduce)',
      ]),
      evidence: ['src/features/registry/RegistryApp.tsx', 'src/features/registry/registry.css'],
    },
    responsive_layout: {
      passed: hasAll(registryStyles, [
        '@media (max-width: 960px)',
        '@media (max-width: 720px)',
        '.registry-comparison-table-wrap',
        'overflow-x: auto',
      ]),
      evidence: ['src/features/registry/registry.css'],
    },
    automated_validation: {
      passed: filesExist(rootDirectory, expectedWaveFiles)
        && expectedTestScripts.every((script) => typeof packageDocument.scripts?.[script] === 'string'),
      evidence: ['package.json', ...expectedWaveFiles],
    },
    operational_readiness: {
      passed: filesExist(rootDirectory, [
        'config/production-policy.json',
        'config/retention-matrix.json',
        'docs/runbooks/BACKUP_RESTORE.md',
        'docs/runbooks/INCIDENT_RESPONSE.md',
        'docs/runbooks/MONITORING_COSTS.md',
        'docs/runbooks/PRIVACY_RETENTION.md',
        'docs/runbooks/RELEASE_ROLLBACK.md',
        'docs/ADR-016-recette-pilote-et-gate-production.md',
      ]) && typeof productionPolicy.release?.remoteDeploymentAuthorized === 'boolean',
      evidence: ['config/production-policy.json', 'docs/runbooks'],
    },
  };
};

export const evaluateRegistryPilotReadiness = ({ checks, productionPolicy }) => {
  const normalizedChecks = Object.fromEntries(REGISTRY_PILOT_CHECK_IDS.map((id) => [
    id,
    {
      passed: checks[id]?.passed === true,
      evidence: Array.isArray(checks[id]?.evidence) ? checks[id].evidence : [],
    },
  ]));
  const pilotBlockers = REGISTRY_PILOT_CHECK_IDS.filter((id) => !normalizedChecks[id].passed);
  const pilotReady = pilotBlockers.length === 0;
  const production = evaluateProductionReadiness({
    policy: productionPolicy,
    checks: { registryPilot: { passed: pilotReady } },
  });
  const reportCore = {
    wave: 'registry-8',
    constructionStatus: pilotReady ? 'complete' : 'incomplete',
    pilotStatus: pilotReady ? 'ready' : 'blocked',
    goLiveAuthorization: production.goLiveAuthorization,
    pilotBlockers,
    productionBlockers: production.blockers,
    checks: normalizedChecks,
    productionPolicyVersion: productionPolicy.policyVersion,
  };
  return { ...reportCore, reportDigest: sha256Digest(reportCore) };
};
